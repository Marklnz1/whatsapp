const axios = require("axios");
const Groq = require("groq-sdk");
const Client = require("../models/Client");
const Message = require("../models/Message");
const util = require("util");
const https = require("https");
const { response } = require("express");
const MessageStatus = require("../models/MessageStatus");
const {
  sendWhatsappMessage,
  saveMediaClient,
  sendConfirmationMessage,
  sendReaction,
} = require("../utils/server");
const { v7: uuidv7 } = require("uuid");

require("dotenv").config();
const MY_TOKEN = process.env.MY_TOKEN;
const META_TOKEN = process.env.META_TOKEN;
const GROQ_TOKEN = process.env.GROQ_TOKEN;
const GROQ_MODEL = process.env.GROQ_MODEL;
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT;
const BUSINESS_INFO = process.env.BUSINESS_INFO;
const PHONE_ID = process.env.PHONE_ID;
const SERVER_SAVE = process.env.SERVER_SAVE;
const SERVER_SAVE_TOKEN = process.env.SERVER_SAVE_TOKEN;
const agent = new https.Agent({
  rejectUnauthorized: false,
});
const groqClient = new Groq({
  apiKey: GROQ_TOKEN,
});

module.exports.verifyToken = (req, res) => {
  try {
    let token = req.query["hub.verify_token"];
    var challenge = req.query["hub.challenge"];
    if (challenge != null && token != null && token == MY_TOKEN) {
      res.send(challenge);
      return;
    }
  } catch (e) {
    res.sendStatus(404);
  }
};
const getPriorityStatus = (state) => {
  switch (state) {
    case "not_sent":
      return 0;
    case "send_requested":
      return 1;
    case "sent":
      return 2;
    case "delivered":
      return 3;
    case "read":
      return 4;
    case "failed":
      return 5;
    default:
      return -1;
  }
};
module.exports.receiveMessage = async (req, res) => {
  try {
    const io = res.locals.io;
    console.log("INSPECIONANDOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO");
    console.log(util.inspect(req.body, true, 99));
    let data = extractClientMessageData(req.body);
    if (data != null) {
      const clientMapData = await createClientMapData(data.contacts);

      for (const message of data.messages) {
        await receiveMessageClient(
          message,
          clientMapData,
          data.recipientData,
          io
        );
      }

      res.sendStatus(200);
      return;
    }
    data = extractMessageStatusData(req.body);

    if (data != null) {
      console.log("ENTRANDO STATUSES " + data.statuses.length);
      for (const statusData of data.statuses) {
        const biz_opaque_callback_data = statusData.biz_opaque_callback_data;
        const message = await Message.findById(biz_opaque_callback_data);

        if (message) {
          const currentStatus = message.sentStatus;
          const futureStatus = statusData.status;
          if (
            getPriorityStatus(currentStatus) < getPriorityStatus(futureStatus)
          ) {
            message.sentStatus = statusData.status;
          }

          io.emit(
            "newStatus",
            JSON.stringify({
              uuid: message.uuid,
              status: statusData.status,
              clientId: message.client,
            })
          );

          await message.save();
        }
        const newState = new MessageStatus({
          message: message?.id,
          status: statusData.status,
          time: new Date(statusData.timestamp * 1000),
        });
        await newState.save();
      }
      res.sendStatus(200);
      return;
    } else {
      console.log("no estatus");
    }
    res.sendStatus(404);
  } catch (e) {
    console.log(e);
    res.sendStatus(404);
  }
};
const createClientMapData = async (contacts) => {
  const clientMapDB = {};

  for (const contact of contacts) {
    const profile = contact.profile;

    const username = profile.name;
    const wid = contact.wa_id;
    let clientDB = await Client.findOne({ wid });
    if (clientDB == null) {
      clientDB = new Client({ wid, username, chatbot: true });
      await clientDB.save();
    }
    clientMapDB[wid] = clientDB;
  }

  return clientMapDB;
};
const messageTypeIsMedia = (type) => {
  return (
    type == "video" ||
    type == "image" ||
    type == "document" ||
    type == "audio" ||
    type == "sticker"
  );
};
async function generateChatBotMessage(system, text, json) {
  const dataConfig = {
    messages: [
      {
        role: "system",
        content: system,
      },
      {
        role: "user",
        content: text,
      },
    ],

    model: GROQ_MODEL,
    temperature: 0,
  };
  if (json) {
    dataConfig.stream = false;
    dataConfig.response_format = { type: "json_object" };
  }
  const chatCompletion = await groqClient.chat.completions.create(dataConfig);
  return chatCompletion.choices[0].message.content;
}
async function generateChatbotMessageWithSystemPrompt(text) {
  const system = SYSTEM_PROMPT + BUSINESS_INFO;
  return await generateChatBotMessage(system, text);
}

async function sendMessageChatbot(
  clientDB,
  clientMessage,
  clientMessageId,
  businessPhone,
  businessPhoneId
) {
  const mensajes = await Message.find(
    { client: clientDB._id },
    { sent: 1, text: 1 }
  )
    .sort({ time: -1 })
    .limit(10)
    .exec();
  console.log(mensajes);
  const emojiResponse = await generateChatBotMessage(
    "*Eres un asistente que atiende a un cliente de un negocio y respondes en JSON, tienes la siguiente informacion del negocio:\n" +
      BUSINESS_INFO,
    `*El mensaje del cliente es:
      ${clientMessage}
      *EL esquema de JSON debe incluir":
      {
        "message":"string(respuesta al mensaje segun la información del negocio)",
        "emoji_message":"string emoji unicode(ejemplo:😄,🤚,😠, poner un emoji de acuerdo al mensaje del cliente, para expresar alguna emocion, solo si lo amerita, para que el cliente tenga mejor compresion del sentimiento de la respuesta, no responder por ejemplo siempre una cara feliz para cualquier mensaje porque no es necesario",

      }
      `,
    true
  );
  const responseBot = JSON.parse(emojiResponse);
  const emoji = responseBot.emoji_message;
  const chatbotMessage = responseBot.message;
  console.log("LA RESPUESTA ES=> ", JSON.parse(emojiResponse));

  if (emoji) {
    sendReaction(
      META_TOKEN,
      businessPhoneId,
      clientDB.wid,
      clientMessageId,
      emoji
    );
  }
  const newMessage = new Message({
    client: clientDB._id,
    wid: null,
    uuid: uuidv7(),
    text: chatbotMessage,
    sent: true,
    read: false,
    time: new Date(),
    category: "text",
    businessPhone,
    sentStatus: "not_sent",
  });
  await newMessage.save();
  const messageId = await sendWhatsappMessage(
    META_TOKEN,
    businessPhoneId,
    clientDB.wid,
    "text",
    {
      body: chatbotMessage,
    },
    newMessage._id
  );
  newMessage.wid = messageId;
  newMessage.sentStatus = "send_requested";
  await newMessage.save();
  return newMessage;
}
// async function sendMessageChatbot2(
//   clientDB,
//   text,
//   businessPhone,
//   businessPhoneId
// ) {
//   const chatbotMessage = await generateChatbotMessageWithSystemPrompt(text);
//   const newMessage = new Message({
//     client: clientDB._id,
//     wid: null,
//     uuid: uuidv7(),
//     text: chatbotMessage,
//     sent: true,
//     read: false,
//     time: new Date(),
//     category: "text",
//     businessPhone,
//     sentStatus: "not_sent",
//   });
//   await newMessage.save();
//   const messageId = await sendWhatsappMessage(
//     META_TOKEN,
//     businessPhoneId,
//     clientDB.wid,
//     "text",
//     {
//       body: chatbotMessage,
//     },
//     newMessage._id
//   );
//   newMessage.wid = messageId;
//   newMessage.sentStatus = "send_requested";
//   await newMessage.save();
//   return newMessage;
// }

const receiveMessageClient = async (
  message,
  clientMapData,
  recipientData,
  io
) => {
  const clientDB = clientMapData[message.from];
  const category = message.type;
  const messageData = message[category];
  // console.log("MAPA " + util.inspect(clientMapData) + "  from " + message.from);
  const newMessageData = {
    client: clientDB._id,
    wid: message.id,
    uuid: uuidv7(),
    sent: false,
    read: false,
    time: new Date(message.timestamp * 1000),
    category,
    businessPhone: recipientData.phoneNumber,
  };
  let finalMessageData;
  if (category == "text") {
    finalMessageData = { text: messageData.body };
  } else if (messageTypeIsMedia(category)) {
    const metaFileName = messageData.filename;
    const metadata = await saveMediaClient(messageData.id, category);

    finalMessageData = {
      text: messageData.caption,
      metaFileName,
      ...metadata,
    };
  }
  sendConfirmationMessage(META_TOKEN, recipientData.phoneNumberId, message.id);

  const newMessage = new Message({
    ...newMessageData,
    ...finalMessageData,
  });
  await newMessage.save();
  io.emit(
    "newMessage",
    JSON.stringify({
      client: clientDB,
      message: newMessage,
    })
  );

  if (clientDB.chatbot && newMessage.text) {
    // const intencionData = await generateChatBotMessage(
    //   "*Eres un asistente que atiende a un cliente de un negocio y respondes en JSON, tienes la siguiente informacion del negocio:\n" +
    //     BUSINESS_INFO,
    //   `*El mensaje del cliente es:
    //   ${newMessage.text}
    //   *EL esquema de JSON debe incluir":
    //   {
    //     "respuesta":"string(respuesta para el cliente)",
    //     "guardar_dni":"string(dni extraido del mensaje del cliente)",
    //     "guardar_plan_internet":"string(plan de internet extraido del mensaje del cliente)"
    //   }
    //   `,
    //   true
    // );
    // const intencion = JSON.parse(intencionData).intencion;
    // console.log("LA RESPUESTA ES %" + intencionData + "%");

    const newBotMessage = await sendMessageChatbot(
      clientDB,
      newMessage.text,
      newMessage.wid,
      recipientData.phoneNumber,
      recipientData.phoneNumberId
    );
    io.emit(
      "newMessage",
      JSON.stringify({
        client: clientDB,
        message: newBotMessage,
      })
    );
  }
};

const extractRecipientData = (value) => {
  try {
    const phoneNumber = value.metadata.display_phone_number;
    const phoneNumberId = value.metadata.phone_number_id;
    return { phoneNumber, phoneNumberId };
  } catch (error) {
    return null;
  }
};
const extractClientMessageData = (body_param) => {
  try {
    const value = body_param.entry[0].changes[0].value;
    const recipientData = extractRecipientData(value);
    const messages = value.messages;
    const contacts = value.contacts;
    if (messages.length > 0 && contacts.length > 0) {
      return { messages, contacts, recipientData };
    }
    return null;
  } catch (error) {
    return null;
  }
};
const extractMessageStatusData = (body_param) => {
  try {
    const value = body_param.entry[0].changes[0].value;
    const recipientData = extractRecipientData(value);
    const statuses = value.statuses;
    if (statuses.length > 0) {
      return { statuses, recipientData };
    }
    return null;
  } catch (error) {
    return null;
  }
};

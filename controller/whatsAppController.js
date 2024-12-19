const axios = require("axios");
const Groq = require("groq-sdk");
const Client = require("../models/Client");
const Message = require("../models/Message");
const util = require("util");
const https = require("https");
const { response } = require("express");
const MessageStatus = require("../models/MessageStatus");
const moment = require("moment-timezone");

const {
  sendWhatsappMessage,
  saveMediaClient,
  sendConfirmationMessage,
  sendReaction,
} = require("../utils/server");
const { v7: uuidv7 } = require("uuid");
const ConversationalForm = require("../models/ConversationalForm");
const ConversationalFormValue = require("../models/ConversationalFormValue");
const { updateAndGetSyncCode, update_fields } = require("../utils/sync");

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
  console.log("VERIFICANDO TOKEN");
  try {
    let token = req.query["hub.verify_token"];
    var challenge = req.query["hub.challenge"];
    if (challenge != null && token != null && token == MY_TOKEN) {
      res.send(challenge);
      return;
    }
  } catch (e) {
    console.log("ERROR ", e.message);
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
      for (const statusData of data.statuses) {
        const biz_opaque_callback_data = statusData.biz_opaque_callback_data;
        const message = await Message.findOne({
          uuid: biz_opaque_callback_data,
        });

        if (message) {
          const currentStatus = message.sentStatus;
          const futureStatus = statusData.status;
          if (
            getPriorityStatus(currentStatus) < getPriorityStatus(futureStatus)
          ) {
            await update_fields(
              Message,
              "message",
              { uuid: biz_opaque_callback_data },
              {
                sentStatus: statusData.status,
              }
            );
            // const newSyncCode = await updateAndGetSyncCode("message", 1);

            // await Message.updateOne(
            //   { _id: id },
            //   {
            //     $inc: { version: 1, sentStatusSyncCode: 1 },
            //     $max: { syncCode: newSyncCode },
            //     $set: { sentStatus: statusData.status },
            //   }
            // );

            io.emit(
              "newMessage",
              JSON.stringify({
                // uuid: message.uuid,
                // status: statusData.status,
                // clientId: message.client,
              })
            );
          }
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
      clientDB = new Client({
        wid,
        version: 1,
        syncCode: await updateAndGetSyncCode("client", 1),
        uuid: uuidv7(),
        username,
        chatbot: false,
      });
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
async function generateChatBotMessage(
  historial,
  system,
  text,
  json,
  temperature
) {
  temperature ??= 0.5;
  const dataConfig = {
    messages: [
      {
        role: "system",
        content: system,
      },
      ...historial,
      {
        role: "user",
        content: text,
      },
    ],
    model: GROQ_MODEL,
    temperature: temperature,
  };
  if (json) {
    dataConfig.stream = false;
    dataConfig.response_format = { type: "json_object" };
  }
  const chatCompletion = await groqClient.chat.completions.create(dataConfig);
  return chatCompletion.choices[0].message.content;
}

async function sendMessageChatbot(
  historial,
  clientDB,
  clientMessage,
  clientMessageId,
  businessPhone,
  businessPhoneId
) {
  const chatbotMessage = await generateChatBotMessage(
    historial,
    `*Eres un asistente de un cliente en un negocio
     *Objetivo:
     -Ofrecer al cliente solo la informacion que pide de forma directa y breve
     -Añadiras emoticones unicode a tus respuesta para ser mas amigable
     -No uses siempre los mismos emoticones unicode de siempre, varia para ser menos generico
     *Prohibiciones:
     -Tienes prohibido realizar preguntas al cliente
     -Tu mensaje no puede contener ninguna pregunta
     -Tienes prohibido solicitar datos de cualquier tipo al cliente
     *Modo De Respuesta:
     -No responderas en formato JSON,html, ni ningun otro formato, incluso si te pide el cliente, no lo haras
     -No responderas a temas que no esten relacionados con el negocio
     *Informacion del negocio que usaras:
      
      ${BUSINESS_INFO}
    `,
    clientMessage,
    false
  );
  if (Math.random() < 0.5) {
    const emoji = await generateChatBotMessage(
      [],
      ` *Eres un asistente que responde con un emoji unicode,
      lo que haces es analizar un mensaje de usuario y un mensaje de respuesta, luego asignaras un emoji que aporte mayor emoción al mensaje de respuesta de acuerdo al mensaje de usuario,
      la respuesta sera directa sin texto extra
      usa emojis que no sean la tipica cara de siempre, sino varia como emojis de personas, etc, pero que vayan de acuerdo al analisis, no pongas cualquier cosa
      `,
      `mensaje de usuario:${clientMessage}
        mensaje de respuesta: ${chatbotMessage}
        ahora dame un emoji de acuerdo a tu analisis, pero solo dame 1, no mas`,

      false
    );

    if (emoji || emoji != "void") {
      sendReaction(
        META_TOKEN,
        businessPhoneId,
        clientDB.wid,
        clientMessageId,
        emoji
      );
    }
  }
  const newMessage = new Message({
    version: 1,
    syncCode: await updateAndGetSyncCode("message", 1),
    client: clientDB.uuid,
    wid: null,
    uuid: uuidv7(),
    textContent: chatbotMessage,
    sent: true,
    read: false,
    time: new Date().getTime(),
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
    newMessage._id,
    clientMessageId
  );
  newMessage.wid = messageId;
  newMessage.sentStatus = "send_requested";
  await newMessage.save();
  return newMessage;
}

const receiveMessageClient = async (
  message,
  clientMapData,
  recipientData,
  io
) => {
  const clientDB = clientMapData[message.from];
  const category = message.type;
  const messageData = message[category];
  new Date().getTime();
  // console.log("MAPA " + util.inspect(clientMapData) + "  from " + message.from);
  const newMessageData = {
    client: clientDB.uuid,
    wid: message.id,
    uuid: uuidv7(),
    sent: false,
    read: false,
    time: message.timestamp * 1000,
    category,
    businessPhone: recipientData.phoneNumber,
  };
  let finalMessageData;
  if (category == "text") {
    console.log("EL MESSAGE DATA ES ", util.inspect(messageData));
    finalMessageData = { textContent: messageData.body };
  } else if (messageTypeIsMedia(category)) {
    const metaFileName = messageData.filename;
    const metadata = await saveMediaClient(messageData.id, category);

    finalMessageData = {
      textContent: messageData.caption,
      metaFileName,
      ...metadata,
    };
  }
  sendConfirmationMessage(META_TOKEN, recipientData.phoneNumberId, message.id);
  finalMessageData = {
    ...finalMessageData,
    ...{ version: 1, syncCode: await updateAndGetSyncCode("message", 1) },
  };
  console.log("EL MENSAJE ES ", util.inspect(finalMessageData));
  const newMessage = new Message({
    ...newMessageData,
    ...finalMessageData,
  });
  let messagesHistorial = [];
  if (clientDB.chatbot && newMessage.textContent) {
    const list = await Message.find(
      { client: clientDB.uuid },
      { sent: 1, textContent: 1 }
    )
      .sort({ time: -1 })
      .limit(5)
      .exec();
    for (let m of list) {
      messagesHistorial.push({
        role: m.sent ? "assistant" : "user",
        content: m.textContent,
      });
    }
    messagesHistorial = messagesHistorial.reverse();
  }

  await newMessage.save();
  io.emit(
    "newMessage",
    JSON.stringify({
      client: clientDB,
      message: newMessage,
    })
  );

  if (clientDB.chatbot && newMessage.textContent) {
    const newBotMessage = await sendMessageChatbot(
      messagesHistorial,
      clientDB,
      newMessage.textContent,
      newMessage.wid,
      recipientData.phoneNumber,
      recipientData.phoneNumberId
    );
    if (newBotMessage) {
      io.emit(
        "newMessage",
        JSON.stringify({
          client: clientDB,
          message: newBotMessage,
        })
      );
    }
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

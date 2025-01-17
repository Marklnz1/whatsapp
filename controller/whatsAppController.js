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
const WhatsappAccount = require("../models/WhatsappAccount");
const Chat = require("../models/Chat");
const { SyncServer } = require("../synchronization/SyncServer");
const MediaContent = require("../models/MediaContent");
const MediaPrompt = require("../models/MediaPrompt");

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
    console.log(
      "SE RECIBIO EL SIGUIENTE MESSAGE " + util.inspect(req.body, true, 99)
    );
    let data = extractClientMessageData(req.body);
    if (data != null) {
      const chatClientMapData = await createChatClientMapData(
        data.contacts,
        data.recipientData
      );

      for (const message of data.messages) {
        await receiveMessageClient(
          message,
          chatClientMapData,
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
          if (currentStatus == "sent") {
            await SyncServer.updateFields(
              Message,
              "message",
              biz_opaque_callback_data,
              {
                time: statusData.timestamp * 1000,
              }
            );
          }
          if (
            getPriorityStatus(currentStatus) < getPriorityStatus(futureStatus)
          ) {
            await SyncServer.updateFields(
              Message,
              "message",
              biz_opaque_callback_data,
              {
                sentStatus: statusData.status,
              }
            );
            io.emit("serverChanged");
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
    console.log(util.inspect(e));
    res.sendStatus(404);
  }
};
const createChatClientMapData = async (contacts, recipientData) => {
  const chatClientMapDB = {};

  for (const contact of contacts) {
    const profile = contact.profile;

    const username = profile.name;
    const wid = contact.wa_id;
    let clientDB = await SyncServer.createOrGet(Client, "client", wid, {
      wid,
      username,
    });

    let chatDB = await SyncServer.createOrGet(
      Chat,
      "chat",
      `${clientDB.wid}_${recipientData.phoneNumber}`,
      {
        clientWid: clientDB.wid,
        businessPhone: recipientData.phoneNumber,
        lastSeen: 0,
        chatbot: true,
      }
    );
    chatClientMapDB[wid] = { client: clientDB, chat: chatDB };
  }

  return chatClientMapDB;
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
  chat,
  clientDB,
  clientMessage,
  clientMessageId,
  businessPhoneId,
  historial,
  mediaPrompts
) {
  const account = await WhatsappAccount.findOne({ businessPhoneId });
  if (account == null || account.prompt.trim() == "") {
    return false;
  }
  const chatbotMessage = await generateChatBotMessage(
    historial,
    `*Eres un asistente virtual de un negocio, diseñado para brindar una experiencia amigable y cercana.
*Objetivo:
  - Ofrecer al cliente la información que solicita de manera clara y concisa.
  - Incluir emoticones variados en tus respuestas para crear un ambiente amigable y cálido 😊✨.
  - Sorprender al cliente con respuestas naturales, como lo haría un amigo.
*Prohibiciones:
  - No puedes hacer preguntas al cliente en ninguna circunstancia.
  - Evita pedir cualquier tipo de datos personales al cliente.
*Modo de Respuesta:
  - Responde de forma sencilla, evitando formatos como JSON o HTML, incluso si el cliente lo solicita.
  - Mantente enfocado en temas relacionados exclusivamente con el negocio.
*Información sobre el negocio que utilizarás:
  ${account.prompt}
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
  if (mediaPrompts.length != 0) {
    const mediaDescriptionJson = await generateChatBotMessage(
      [],
      ` *Eres una analizador de mensaje y devuelves en formato JSON
        Se te proveera un mensaje y una lista de oraciones
        Analizaras el mensaje y identificaras si el mensaje hace referencia a algun elemento de la lista
        Solo podras devolver un elemento el que mas se adecue
        No es obligatorio devolver un elemento
        El formato de salida sera:

        {
          name:(String o null, elemento de la lista)
        }
      `,
      `
        *El mensaje es:
         ${clientMessage}
        *La lista de elementos es :
        ${mediaPrompts.map((item) => `${item.description}`).join("\n")}
      `,

      true
    );
    console.log(`LA RESPUESTA ES ${mediaDescriptionJson}`);
  }
  const messageUuid = uuidv7();
  await SyncServer.createOrGet(Message, "message", messageUuid, {
    chat: chat.uuid,
    wid: null,
    textContent: chatbotMessage,
    sent: true,
    read: false,
    time: new Date().getTime(),
    category: "text",
    sentStatus: "not_sent",
  });
  const messageId = await sendWhatsappMessage(
    META_TOKEN,
    businessPhoneId,
    clientDB.wid,
    "text",
    {
      body: chatbotMessage,
    },
    messageUuid,
    clientMessageId
  );
  await SyncServer.updateFields(Message, "message", messageUuid, {
    wid: messageId,
    sentStatus: "send_requested",
  });
  return true;
}

const receiveMessageClient = async (
  message,
  chatClientMapData,
  recipientData,
  io
) => {
  const { client, chat } = chatClientMapData[message.from];
  console.log(`EL MAPA ES ${util.inspect(chatClientMapData)}`);
  const category = message.type;
  const messageData = message[category];
  // new Date().getTime();
  // console.log("MAPA " + util.inspect(clientMapData) + "  from " + message.from);
  const newMessageData = {
    chat: chat.uuid,
    wid: message.id,
    sent: false,
    read: false,
    time: message.timestamp * 1000,
  };
  let mediaContent;
  if (category == "text") {
    console.log("EL MESSAGE DATA ES ", util.inspect(messageData));
    newMessageData.textContent = messageData.body;
  } else if (messageTypeIsMedia(category)) {
    const metaFileName = messageData.filename;
    const metadata = await saveMediaClient(messageData.id, category);
    newMessageData.textContent = messageData.caption;
    mediaContent = {
      category,
      metaFileName,
      ...metadata,
    };
    const mediaContentUuid = uuidv7();
    await SyncServer.createOrGet(
      MediaContent,
      "mediaContent",
      mediaContentUuid,
      mediaContent
    );
    newMessageData.mediaContent = mediaContentUuid;
  }
  sendConfirmationMessage(META_TOKEN, recipientData.phoneNumberId, message.id);

  console.log("EL MENSAJE ES ", util.inspect(mediaContent));

  let messagesHistorial = [];
  if (chat.chatbot && newMessageData.textContent) {
    const list = await Message.find(
      { chat: chat.uuid },
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
  await SyncServer.createOrGet(Message, "message", uuidv7(), newMessageData);
  io.emit("serverChanged");

  if (chat.chatbot && newMessageData.textContent) {
    const mediaPrompts = await MediaPrompt.find();
    const newBotMessage = await sendMessageChatbot(
      chat,
      client,
      newMessageData.textContent,
      newMessageData.wid,
      recipientData.phoneNumberId,
      messagesHistorial,
      mediaPrompts
    );
    if (newBotMessage) {
      io.emit("serverChanged");
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

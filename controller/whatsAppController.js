const axios = require("axios");
const Groq = require("groq-sdk");
const Client = require("../models/Client");
const Message = require("../models/Message");
const util = require("util");
const https = require("https");
const mime = require("mime-types");
const { response } = require("express");
const MessageStatus = require("../models/MessageStatus");
const { sendWhatsappMessage } = require("../utils/server");
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

module.exports.receiveMessage = async (req, res) => {
  try {
    const io = res.locals.io;
    console.log("INSPECIONANDOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO");
    console.log(util.inspect(req.body, true, 99));
    let data = extractClientMessageData(req.body);
    if (data != null) {
      await receiveListMessagesClient(
        data.messages,
        data.contacts,
        data.recipientData,
        io
      );
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
          message.sentStatus = statusData.status;

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
      clientDB = new Client({ wid, username, chatbot: false });
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
async function generateChatbotMessage(text) {
  const system = SYSTEM_PROMPT + BUSINESS_INFO;
  const chatCompletion = await groqClient.chat.completions.create({
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
  });
  const responseText = chatCompletion.choices[0].message.content;
  return responseText;
}
async function sendMessageChatbot(
  clientDB,
  text,
  businessPhone,
  businessPhoneId
) {
  const chatbotMessage = await generateChatbotMessage(text);
  const newMessage = new Message({
    client: clientDB._id,
    wid: null,
    uuid: uuidv7(),
    text,
    sent: true,
    time: new Date(),
    type: "text",
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
    }
  );
  newMessage.wid = messageId;
  newMessage.sentStatus = "send_requested";
  await newMessage.save();
  return newMessage;
}
async function saveMedia(media_id, category) {
  const response = await axios({
    method: "POST",
    url: `https://${SERVER_SAVE}"/api/client/media/${category}/${media_id}`,
    headers: {
      Authorization: `Bearer ${SERVER_SAVE_TOKEN}`,
    },
    httpsAgent: agent,
  });
  return response.data;
}

const receiveMessageClient = async (
  message,
  clientMapData,
  recipientData,
  io
) => {
  const clientDB = clientMapData[message.from];
  const messageType = message.type;
  const messageData = message[messageType];
  console.log("MAPA " + util.inspect(clientMapData) + "  from " + message.from);
  const newMessageData = {
    client: clientDB._id,
    wid: message.id,
    uuid: uuidv7(),
    sent: false,
    time: new Date(message.timestamp * 1000),
    type: messageType,
    businessPhone: recipientData.phoneNumber,
  };
  let finalMessageData;
  if (messageType == "text") {
    finalMessageData = { text: messageData.body };
  } else if (messageTypeIsMedia(messageType)) {
    const metaFileName = messageData.filename;
    const metadata = await saveMedia(messageData.id, messageType);

    finalMessageData = {
      text: messageData.caption,
      metaFileName,
      ...metadata,
    };
  }

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
    const newMessage = await sendMessageChatbot(
      clientDB,
      newMessage.text,
      recipientData.phoneNumber,
      recipientData.phoneNumberId
    );
    io.emit(
      "newMessage",
      JSON.stringify({
        client: clientDB,
        message: newMessage,
      })
    );
  }
};
const receiveListMessagesClient = async (
  messages,
  contacts,
  recipientData,
  io
) => {
  const clientMapData = await createClientMapData(contacts);

  for (const message of messages) {
    await receiveMessageClient(message, clientMapData, recipientData, io);
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

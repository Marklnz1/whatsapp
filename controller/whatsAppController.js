const axios = require("axios");
const Groq = require("groq-sdk");
const Client = require("../models/Client");
const Message = require("../models/Message");
const util = require("util");
const https = require("https");
const mime = require("mime-types");
const { response } = require("express");
const MessageStatus = require("../models/MessageStatus");
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
async function sendWhatsappMessage(
  businessPhoneId,
  dstPhone,
  type,
  messageData
) {
  const sendData = {
    messaging_product: "whatsapp",
    to: dstPhone,
    type,
  };
  sendData.type = messageData;
  const response = await axios({
    method: "POST",
    url: `https://graph.facebook.com/v20.0/${businessPhoneId}/messages`,
    data: sendData,
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  const messageId = response.data.messages[0].id;
  return messageId;
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
    messageId: null,
    text,
    sent: true,
    time: new Date(),
    type: "text",
    businessPhone,
    sentStatus: "not_sent",
  });
  await newMessage.save();
  const messageId = await sendWhatsappMessage(
    businessPhoneId,
    clientDB.wid,
    "text",
    {
      body: chatbotMessage,
    }
  );
  newMessage.messageId = messageId;
  newMessage.sentStatus = "send_requested";
  await newMessage.save();
  return newMessage;
}
/*
  {
    id
    timestamp

  }
*/
const receiveMessageClient = async (
  message,
  clientMapData,
  recipientData,
  io
) => {
  const clientDB = clientMapData[message.from];
  const messageType = message.type;
  const messageData = message[messageType];
  const newMessageData = {
    client: clientDB._id,
    messageId: message.id,
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
  const clientMapData = createClientMapData(contacts);

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
    if (statuses.length > 0 && contacts.length > 0) {
      return { statuses, recipientData };
    }
    return null;
  } catch (error) {
    return null;
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
      for (const statusData of data.statuses) {
        const message = await Message.findOne({ wid: statusData.id });
        message.sentStatus = statusData.status;
        await message.save();
        const newState = new MessageStatus({
          message: message.id,
          status: statusData.status,
          time: new Date(statusData.timestamp * 1000),
        });
        await newState.save();
      }
      res.sendStatus(200);
      return;
    }
  } catch (e) {
    console.log(e);
    res.sendStatus(404);
  }
};

async function saveMedia(media_id, mediaType) {
  const response = await axios({
    method: "POST",
    url: `https://${SERVER_SAVE}/media/${media_id}`,
    params: {
      mediaType,
    },
    headers: {
      Authorization: `Bearer ${SERVER_SAVE_TOKEN}`,
    },
    httpsAgent: agent,
  });
  return response.data;
}
async function getMediaUrl(mediaId) {
  const response = await axios({
    method: "GET",
    url: "https://graph.facebook.com/" + mediaId,
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
    },
  });

  const url = response.data.url;
  return url;
}

async function getMediaToURL(url) {
  console.log("Obteniendo de la url " + url);
  const response = await axios({
    method: "GET",
    url,
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
    },
  });
  return response.data;
}

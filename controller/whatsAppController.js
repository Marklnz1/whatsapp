const axios = require("axios");
const Groq = require("groq-sdk");
const Client = require("../models/Client");
require("dotenv").config();

const MY_TOKEN = process.env.MY_TOKEN;
const META_TOKEN = process.env.META_TOKEN;
const GROQ_TOKEN = process.env.GROQ_TOKEN;
const GROQ_MODEL = process.env.GROQ_MODEL;
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT;
const BUSINESS_INFO = process.env.BUSINESS_INFO;
const PHONE_ID = process.env.PHONE_ID;

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
    console.log(e);
  }
  res.sendStatus(404);
};

module.exports.receiveMessage = async (req, res) => {
  try {
    const io = res.locals.io;
    let body_param = req.body;

    if (
      !(
        body_param.object &&
        body_param.entry &&
        body_param.entry[0].changes &&
        body_param.entry[0].changes[0].value.messages &&
        body_param.entry[0].changes[0].value.messages[0] &&
        body_param.entry[0].changes[0].value.contacts &&
        body_param.entry[0].changes[0].value.contacts[0]
      )
    ) {
      res.sendStatus(404);
      return;
    }
    const value = body_param.entry[0].changes[0].value;
    // let phon_no_id = value.metadata.phone_number_id;
    // console.log(phon_no_id + "  otro " + PHONE_ID);
    console.log(value.messages.length);
    let from = value.messages[0].from;
    let contact = value.contacts[0].profile.name;

    let msg_body = value.messages[0].text.body;
    //===============================================================
    let client = await Client.findOne({ wid: from });
    let newClient;
    if (client == null) {
      client = new Client({ wid: from, contact, chatbot: true });
      newClient = client;
    }
    client.messages.push({
      msg: msg_body,
      time: new Date(),
      sent: false,
      read: false,
    });
    await client.save();
    let savedMessage = client.messages[client.messages.length - 1];
    // console.log("MENSAJE RECIBIDO " + msg_body);
    io.emit(
      "newMessage",
      JSON.stringify({
        newClient,
        clientId: client._id,
        message: savedMessage,
      })
    );
    //==================================================
    if (client.chatbot) {
      sendMessageChatbot(client, from, msg_body, io);
    }
    res.sendStatus(200);
    return;
  } catch (e) {
    console.log(e);
  }
};

async function sendMessageChatbot(client, from, msg, io) {
  const system = SYSTEM_PROMPT + BUSINESS_INFO;
  const chatCompletion = await groqClient.chat.completions.create({
    messages: [
      {
        role: "system",
        content: system,
      },
      {
        role: "user",
        content: msg,
      },
    ],
    model: GROQ_MODEL,
    temperature: 0,
  });
  const chatbotMsg = chatCompletion.choices[0].message.content;
  axios({
    method: "POST",
    url: "https://graph.facebook.com/v20.0/" + PHONE_ID + "/messages",
    data: {
      messaging_product: "whatsapp",
      to: from,
      text: {
        body: chatbotMsg,
      },
    },
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  client.messages.push({
    msg: chatbotMsg,
    time: new Date(),
    sent: true,
    read: false,
  });
  await client.save();
  savedMessage = client.messages[client.messages.length - 1];
  io.emit(
    "newMessage",
    JSON.stringify({
      clientId: client._id,
      message: savedMessage,
    })
  );
}

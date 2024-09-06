const axios = require("axios");
const Groq = require("groq-sdk");
require("dotenv").config();

const MY_TOKEN = process.env.MY_TOKEN;
const META_TOKEN = process.env.META_TOKEN;
const GROQ_TOKEN = process.env.GROQ_TOKEN;
const GROQ_MODEL = process.env.GROQ_MODEL;
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT;
const BUSINESS_INFO = process.env.BUSINESS_INFO;

const client = new Groq({
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
    let body_param = req.body;
    if (body_param.object) {
      if (
        body_param.entry &&
        body_param.entry[0].changes &&
        body_param.entry[0].changes[0].value.messages &&
        body_param.entry[0].changes[0].value.messages[0]
      ) {
        let phon_no_id =
          body_param.entry[0].changes[0].value.metadata.phone_number_id;
        let from = body_param.entry[0].changes[0].value.messages[0].from;
        let msg_body =
          body_param.entry[0].changes[0].value.messages[0].text.body;

        const system = SYSTEM_PROMPT + BUSINESS_INFO;
        const chatCompletion = await client.chat.completions.create({
          messages: [
            {
              role: "system",
              content: system,
            },
            {
              role: "user",
              content: msg_body,
            },
          ],
          model: GROQ_MODEL,
          temperature: 0,
        });

        axios({
          method: "POST",
          url: "https://graph.facebook.com/v20.0/" + phon_no_id + "/messages",
          data: {
            messaging_product: "whatsapp",
            to: from,
            text: {
              body: chatCompletion.choices[0].message.content,
            },
          },
          headers: {
            Authorization: `Bearer ${META_TOKEN}`,
            "Content-Type": "application/json",
          },
        });
        res.sendStatus(200);
        return;
      }
    }
  } catch (e) {
    console.log(e);
  }
  res.sendStatus(404);
};

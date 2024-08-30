/*
const fs = require("fs");
const myConsole= new console.Console(fs.createWriteStream("./logs.txt"));
const VerificarToken= (req,res)=>{
}
const Recibirmessaje = (req,res)=>{
    try{
        var entry =(req.body["entry"])[0]
        var changes=(entry["changes"])[0]
        var value= changes["value"];
        var messageObject = value["messages"]
        myConsole.log(messageObject)                                                                                                                                                                                                                                                                
        res.send("EVENT_RECEIVED")
    }catch(e){
        res.send("EVENT_RECIEVED");
    }
}
module.exports = {
    VerificarToken,
    Recibirmessaje
}*/
const axios = require("axios");
const Groq = require("groq-sdk");
const client = new Groq({
  apiKey: "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", // This is the default and can be omitted
});

const token =
  "EAAQfxuImFUsBO2SbPxbFcAtIKtkrLjBHtps0TrKDnYt7aUOK3CV9lqnrUCAJy8DKAmfhPo91RPZCnjSb09Q9hyrXkZAFqhlxFu0FbTa4sbtM8W4LNZC5Q4scyDAi4u6e9xRHBBG3ZA36S4Pg5FDeBBZBiIa9SXmgz4RK3CVDpZC52x4Ky8hAC5FuUnQtdgnZBs6SpFIWZAcRqEGqspZA9CBotRLVV6WsZD";
const myToken = "ASDADASOPKFOASFAM2314332";
const VerificarToken = (req, res) => {
  console.log("Verificando token");
  try {
    var accessToken = "ASDADASOPKFOASFAM2314332";
    let token = req.query["hub.verify_token"];
    var challenge = req.query["hub.challenge"];
    if (challenge != null && token != null && token == accessToken) {
      res.send(challenge);
      return;
    } else {
      res.status(400).send();
      return;
    }
  } catch (e) {
    res.status(400).send();
  }
};

const Recibirmessaje = async (req, res) => {
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
      let msg_body = body_param.entry[0].changes[0].value.messages[0].text.body;
      console.log(msg_body + "  " + phon_no_id + body_param);
      //   res.sendStatus(200);
      //   return;
      const chatCompletion = await client.chat.completions.create({
        messages: [
          {
            role: "user",
            content:
              "el mensaje es:" +
              msg_body +
              ", responde como si fueras el administrador de una tienda de ropas",
          },
        ],
        model: "llama3-8b-8192",
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
          Authorization:
            "Bearer EAAQfxuImFUsBO6owsHGXA2K1AuX1jwGPpctYjmKzmp0f0H58CaI6YQXZCeuwFvlgYs20H8ozzhwZA7ZBJJ0bwxzMtGWystVFx0UrdfXFllPZCMZAMZCx7V6CoJbs1VZCEaYBreoFrj6FLG6XV828ZAKZBjjruWibGDTyZAycMdb2XrZCbqevbPRhRc2RuVKNE9zRKxVENeOquBTMZCZBETHiv0BLWFLigDQkb",
          "Content-Type": "application/json",
        },
      });
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  }
};
module.exports = {
  VerificarToken,
  Recibirmessaje,
};

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
import axios from "axios";

const token =
  "EAAQfxuImFUsBO2SbPxbFcAtIKtkrLjBHtps0TrKDnYt7aUOK3CV9lqnrUCAJy8DKAmfhPo91RPZCnjSb09Q9hyrXkZAFqhlxFu0FbTa4sbtM8W4LNZC5Q4scyDAi4u6e9xRHBBG3ZA36S4Pg5FDeBBZBiIa9SXmgz4RK3CVDpZC52x4Ky8hAC5FuUnQtdgnZBs6SpFIWZAcRqEGqspZA9CBotRLVV6WsZD";
const myToken = "ASDADASOPKFOASFAM2314332";
const VerificarToken = (req, res) => {
  try {
    var accessToken = "ASDADASOPKFOASFAM2314332";
    let token = req.query["hub.verify_token"];
    var challenge = req.query["hub.challenge"];
    if (challenge != null && token != null && token == accessToken) {
      res.send(challenge);
    } else {
      res.status(400).send();
    }
  } catch (e) {
    res.status(400).send();
  }
  res.send("Hola verificarToken");
};

const Recibirmessaje = (req, res) => {
  let body_param = req.body;
  if (body_param.object) {
    if (
      body_param.entry &&
      body_param.entry[0].changes &&
      body_param.entry[0].changes[0].value.messages &&
      body_param.entry[0].changes[0].value.messages[0]
    ) {
      let phon_no_id =
        body_param.entry[0].challenge[0].value.metadata.phone_number_id;
      let from = body_param.entry[0].changes[0].value.messages[0].from;
      let msg_body = body_param.entry[0].changes[0].value.messages[0].text.body;
      console.log(msg_body);
      axios({
        method: "POST",
        url:
          "https://graph.facebook.com/v20.0/" +
          phon_no_id +
          "/message?access_token" +
          token,
        data: {
          messaging_product: "whatsapp",
          to: from,
          text: {
            body: "holaaaaaaaI1234",
          },
        },
        headers: {
          "Content-Type": "application/json",
        },
      });
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  }
};
export default {
  VerificarToken,
  Recibirmessaje,
};

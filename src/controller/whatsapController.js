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
      const info = `cuando el cliente menciona planes que tienes es sobre informacion del servicio,Para la Ciudad de Tingo María
se ofrece internet ilimitado 100% Fibra Optica
Descargas ilimitadas
Soporte técnico 
los planes son:
- 80 mbps a 50 soles
-100 mbps a 80 soles
-200 mbps a 110 soles
-250 mbps a 140 soles
Informacion sobre la instalacion:
1.la instalación es completamente Gratis 100 metros, pasando de los 100 se cobrará 1 sol por metro 
*2.Una vez contratado el plan, los técnicos se comunicarán para la instalación.
3.pago por adelantado del primer mes de servicio* del plan contratado.
4.Los pagos mensuales podrán realizar en JR Ucayali 1133.y tambien por yape ,plin ,bancos    .agentes  
5.estar atento a la llamada del técnico
6.Si el personal técnico no hace la respectiva llamada, comunicar al área de VENTAS 989552818 wintv tingo maria
Es importante mencionar que los equipos de instalación están en calidad de préstamo.
Para una instalación exitosa, verifique:
1.Sus conectores de enchufe estén en buen estado
2.Sus cables de energía estén seguros y funcionando correctamente

La instalación se da en un plazo de 24 a 48 horas hábiles, pero puede variar dependiendo de la disponibilidad del equipo de trabajo y la complejidad de instalación
Los datos que se brinden por el cliente estarán protegidos y utilizados solo para fines legítimos. Nuestro equipo de instalación se comunicará con usted para confirmar los detalles

No hay descuentos, precios fijos
Es importante que envie su ubicacion en tiempo real para la instalación
Los equipos y accesorios se entregan en calidad de préstamo durante el servicio brindado
El horario de atención para un asistente humano es de 8:00 am a 1:00 pm y de 3:00pm a 6:30 pm, los feriados solo hasta el medio dia`;
      const mensaje =
        'responde el siguiente mensaje como un asistente: "' +
        msg_body +
        '", la informacion de la empresa es: "' +
        info +
        '" ';
      const chatCompletion = await client.chat.completions.create({
        messages: [
          {
            role: "user",
            content: mensaje,
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
            // "Bearer EAB4n17rdZBRsBOxFbRoTtAnZAZByQjp0ckHZAPXfnhOmMnFvgbtnWAm0Nz6g0D5KKh7DbMM0pTgcBOEWGIXVpNPc0juZA8JHFp6aL0DR9VSiU4QloZBUCOEYMZBx5leXvb3ZC7WfOIXfs7s1Ntko3riCrI5CZB1CCXqd2ZAa5zcLJZC3lNHeglxmpBai8wUUDg1jZAE0",
            "Bearer EAAQfxuImFUsBO7xR3hBXwjBvhcK1Es9Dyk7QAAmZChEKp1d9XBTD58em2biZBLLs7MyhxO8PNQp73mfGC2eni7L9OcgcVEPmwCKJNrtTaGguiYRhQcOBZCYIYVFvcYfWmDfCk8cWddZCVA4E0F10qm1DHZBFfauit9prs0DNOAlFnAYmY1c3rZCqvtw31Q0tuxpXBCT5wfhcFYILZAMSxOy8j8GVq8ZD",
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

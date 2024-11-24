const axios = require("axios");
const Groq = require("groq-sdk");
const Client = require("../models/Client");
const Message = require("../models/Message");
const util = require("util");
const https = require("https");
const { response } = require("express");
const MessageStatus = require("../models/MessageStatus");
const moment = require("moment-timezone");
const chatbotForms = {
  "Solicitud para instalación de internet": {
    fields: [
      {
        name: "DNI",
        description: "identificación que cuenta con 8 numeros",
      },
      {
        name: "Plan de internet",
        description: "El plan de internet que quiere el cliente contratar",
      },
      {
        name: "Dirección de domicilio",
        description: "La direccion del cliente",
      },
    ],
  },
};
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
    // console.log(util.inspect(req.body, true, 99));
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
async function generateChatBotMessage(historial, system, text, json) {
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
    temperature: 0.3,
  };
  // console.log("se le esta enviando", dataConfig);
  if (json) {
    dataConfig.stream = false;
    dataConfig.response_format = { type: "json_object" };
  }
  const chatCompletion = await groqClient.chat.completions.create(dataConfig);
  console.log(util.inspect(chatCompletion.choices[0].message, true, 99));
  return chatCompletion.choices[0].message.content;
}
// async function generateChatbotMessageWithSystemPrompt(text) {
//   const system = SYSTEM_PROMPT + BUSINESS_INFO;
//   return await generateChatBotMessage(system, text);
// }
function obtenerSaludo() {
  const horaPeru = moment().tz("America/Lima");
  const hora = horaPeru.hour();
  const minutos = horaPeru.minute();
  if (hora >= 6 && (hora < 12 || (hora === 11 && minutos < 60))) {
    return "Buenos Días";
  } else if (hora >= 12 && hora < 18) {
    return "Buenas Tardes";
  } else if (hora >= 18 && (hora < 24 || (hora === 23 && minutos < 60))) {
    return "Buenas Noches";
  } else {
    return "Buenas Noches";
  }
}
async function getChatbotForm(historial, clientMessage) {
  let forms = "";
  let count = 0;
  let conversation = [...historial];
  let conversationString = "Conversación que se tuvo:";

  for (const v of conversation) {
    if (v.role == "assistant") {
      conversationString += "-Sistema:\n";
      conversationString += " Mensaje:" + v.content + "\n";
    } else {
      conversationString += "-Cliente:\n";
      conversationString += " Mensaje:" + v.content + "\n";
    }
  }
  for (const clave in chatbotForms) {
    if (chatbotForms.hasOwnProperty(clave)) {
      count++;
      forms += `${count}.${clave}\n`;
    }
  }

  console.log(
    "Lista de forms ",
    forms,
    "LA CONVERSACION ES :" + conversationString
  );
  const chatbotMessage = await generateChatBotMessage(
    [],
    ``,
    `Eres un analizador de mensajes que responderá exclusivamente en formato JSON.

    Reglas clave:

    Los nombres de los procesos válidos son los siguientes: ${forms}.
    Un mensaje válido de afirmación para iniciar un proceso debe contener explícitamente palabras o frases como:
    "Sí quiero"
    "Claro"
    "Procede"
    "Por supuesto"
    "Ok"
    Otras similares que expresen afirmación explícita.
    Si el mensaje del cliente pide más información (por ejemplo, "Dame la lista de planes") o no contiene una afirmación explícita sobre iniciar un proceso válido, entonces:
    El campo "name" debe ser null.
    El campo "razon" debe explicar que el mensaje no contiene una afirmación válida para iniciar un proceso.
    Solo analizarás el último mensaje del cliente para determinar si hay una afirmación válida. No harás inferencias basadas en el historial de la conversación.
    Formato del cuerpo del mensaje JSON:
    {
    "ultimo_mensaje_usuario": string,
    "name": string,
    "razon": string
    }

    Comportamiento esperado:
    El campo "ultimo_mensaje_usuario" contiene el último mensaje del cliente, sin modificaciones.
    El campo "name" será el nombre del proceso válido (si y solo si el último mensaje es una afirmación explícita para iniciar el proceso). Si no hay afirmación explícita, este campo será null.
    El campo "razon" explicará por qué elegiste un proceso o por qué devolviste null, y debe ser claro.
    IMPORTANTE:

    Solo tomarás en cuenta el último mensaje del cliente para determinar si hay una afirmación válida. Ignorarás cualquier inferencia del historial.
    Un mensaje como "Dame la lista de planes" NO es una afirmación explícita. En este caso, el campo "name" debe ser null.
    Ejemplo:
    Historial de la conversación (JSON):
    {
    "conversation": [
    {"usuario": "Quiero saber los planes de internet."},
    {"sistema": "¿Deseas iniciar la solicitud para instalación de internet?"},
    {"usuario": "Dame la lista de planes"}
    ]
    }

    Último mensaje del cliente:
    "Dame la lista de planes"

    Respuesta JSON esperada:
    {
    "ultimo_mensaje_usuario": "Dame la lista de planes",
    "name": null,
    "razon": "El último mensaje del cliente ('Dame la lista de planes') no contiene una afirmación explícita para iniciar un proceso válido, sino que solicita más información."
    }

    Ahora analiza la siguiente conversación:
    Historial de la conversación (JSON):
    ${conversationString}

    Último mensaje del cliente:
    ${clientMessage}
   `,
    true
  );
  return chatbotMessage.name;
}
async function sendMessageChatbot(
  historial,
  clientDB,
  clientMessage,
  clientMessageId,
  businessPhone,
  businessPhoneId
) {
  const currentHour = moment().tz("America/Lima").format("hh:mm A");
  const currentDate = moment().tz("America/Lima").format("DD/MM/YYYY");
  // console.log("ES ", obtenerSaludo(), " español");
  let forms = "";
  let count = 0;
  for (const clave in chatbotForms) {
    if (chatbotForms.hasOwnProperty(clave)) {
      count++;
      forms += `${count}.${clave}\n`;
    }
  }
  const formName = await getChatbotForm(historial, clientMessage);
  if (formName) {
    clientDB.formProcess = formName;
    console.log("GUARDANDO A ", formName);
    await clientDB.save();
    console.log("se guardo al cliente");
    const currentForm = chatbotForms[formName];

    const chatbotMessage = await generateChatBotMessage(
      historial,
      ` *Eres un asistente que a pesar que te hablen en otro idioma o pidan otro idioma, responderas en español, cada respuesta tuya sera en español,
      atiende a un cliente de un negocio y respondes educadamente, si no hay nada para responder al cliente, solo finaliza la conversacion cordialmente
      *Responderas de forma breve y concisa, para no abrumar de información al cliente
      *Responderas solo en español
      *Responderas solo en un formato de texto plano normal, nada de JSON,html u otros formatos.
      *No respondas en formato tipo canciones,etc, que sea un mensaje de texto normal
      *No respondas temas que estan fuera a la información del negocio, corta dichos temas de forma educada
      *Que el cliente no te haga dudar de la información que tienes, ya que tu tienes la verdad
      *Tienes la siguiente informacion extra:
      Hora actual:${currentHour}
      Fecha actual:${currentDate}
      *IMPORTANTE:actualmente estas en un proceso de solicitud, en el cual pediras cordialmente la siguiente informacion:
      nombre de campo: ${currentForm[0].name}
      descripción: ${currentForm[0].description}
      *Tienes la siguiente informacion del negocio:   
        ` + BUSINESS_INFO,
      clientMessage,
      false
    );
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
      newMessage._id,
      clientMessageId
    );
    newMessage.wid = messageId;
    newMessage.sentStatus = "send_requested";
    await newMessage.save();
    return newMessage;
  } else {
    const chatbotMessage = await generateChatBotMessage(
      historial,
      ` *Eres un asistente que a pesar que te hablen en otro idioma o pidan otro idioma, responderas en español, cada respuesta tuya sera en español,
      atiende a un cliente de un negocio y respondes educadamente, si no hay nada para responder al cliente, solo finaliza la conversacion cordialmente
      *Responderas de forma breve y concisa, para no abrumar de información al cliente
      *Responderas solo en español
      *Responderas solo en un formato de texto plano normal, nada de JSON,html u otros formatos.
      *No respondas en formato tipo canciones,etc, que sea un mensaje de texto normal
      *No respondas temas que estan fuera a la información del negocio, corta dichos temas de forma educada
      *Que el cliente no te haga dudar de la información que tienes, ya que tu tienes la verdad
      *Tienes la siguiente informacion extra:
      Hora actual:${currentHour}
      Fecha actual:${currentDate}
      *IMPORTANTE:Si el cliente tiene intencion de iniciar algun proceso, pregunta si quiere realizarlo mencionando el nombre formal del proceso, no te inventes un nombre, ya que los nombres se especifican mas adelante, o solo quiere informacion nomas, siempre mencionando el nombre del proceso que esta en la siguiente lista. 
      *LOS NOMBRES DE LOS PROCESOS VALIDOS SON LOS SIGUIENTES:  
      ${forms}
      *IMPORTANTE: Recharzar el inicio de cualquiero proceso que no este en la lista de procesos validos
      *Tienes la siguiente informacion del negocio:   
        ` + BUSINESS_INFO,
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
      newMessage._id,
      clientMessageId
    );
    newMessage.wid = messageId;
    newMessage.sentStatus = "send_requested";
    await newMessage.save();
    return newMessage;
  }
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
  let messagesHistorial = [];
  if (clientDB.chatbot && newMessage.text) {
    const list = await Message.find(
      { client: clientDB._id },
      { sent: 1, text: 1 }
    )
      .sort({ time: -1 })
      .limit(5)
      .exec();
    for (let m of list) {
      messagesHistorial.push({
        role: m.sent ? "assistant" : "user",
        content: m.text,
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
      messagesHistorial,
      clientDB,
      newMessage.text,
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

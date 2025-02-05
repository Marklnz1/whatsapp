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
const SyncServer = require("../synchronization/SyncServer");
const MediaContent = require("../models/MediaContent");
const MediaPrompt = require("../models/MediaPrompt");

require("dotenv").config();
const DOMAIN = process.env.DOMAIN;

const WEBHOOK_VERIFICATION_TOKEN = process.env.WEBHOOK_VERIFICATION_TOKEN;
const CLOUD_API_ACCESS_TOKEN = process.env.CLOUD_API_ACCESS_TOKEN;
const GROQ_TOKEN = process.env.GROQ_TOKEN;
const GROQ_MODEL = process.env.GROQ_MODEL;

// const PHONE_ID = process.env.PHONE_ID;
const agent = new https.Agent({
  rejectUnauthorized: false,
});
const groqClient = new Groq({
  apiKey: GROQ_TOKEN,
});

module.exports.verifyToken = (req, res) => {
  // console.log("VERIFICANDO TOKEN");
  try {
    let token = req.query["hub.verify_token"];
    var challenge = req.query["hub.challenge"];
    if (
      challenge != null &&
      token != null &&
      token == WEBHOOK_VERIFICATION_TOKEN
    ) {
      res.send(challenge);
      return;
    }
  } catch (e) {
    console.log("ERROR ", e.message);
    res.sendStatus(404);
  }
};

const extractChanges = (body) => {
  try {
    return body.entry[0].changes;
  } catch (error) {
    return null;
  }
};
const topStatuses = [
  "not_sent",
  "send_requested",
  "sent",
  "delivered",
  "read",
  "failed",
];

function getStatusesAfter(value) {
  const index = topStatuses.indexOf(value);
  // Si el status no existe, devolver array vacío
  if (index === -1) {
    return topStatuses;
  }
  // Si es el último estado, devolver array vacío
  if (index === topStatuses.length - 1) {
    return [];
  }
  // Devolver todos los estados después del índice encontrado
  return topStatuses.slice(index + 1);
}
function getStatusError(statusData) {
  try {
    return {
      errorCode: statusData.errors[0].code,
      errorTitle: statusData.errors[0].title,
      errorMessage: statusData.errors[0].message,
      errorDetails: statusData.errors[0].error_data.details,
    };
  } catch (error) {
    return {};
  }
}
module.exports.receiveMessage = async (req, res) => {
  // try {
  const io = res.locals.io;
  console.log(
    "SE RECIBIO EL SIGUIENTE MESSAGE " + util.inspect(req.body, true, 99)
  );
  let changes = extractChanges(req.body);

  if (changes == null) {
    return res.sendStatus(404);
  }
  for (const change of changes) {
    let data = extractClientMessageData(change);
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
      continue;
    }
    data = extractMessageStatusData(change);

    if (data != null) {
      for (const statusData of data.statuses) {
        const messageUuid = statusData.biz_opaque_callback_data;

        await SyncServer.updateFields(
          "message",
          messageUuid,
          {
            sentStatus: statusData.status,
          },
          { sentStatus: { $nin: getStatusesAfter(statusData.status) } }
        );
        if (statusData.status == "sent") {
          await SyncServer.updateFields("message", messageUuid, {
            time: statusData.timestamp * 1000,
          });
        }
        if (statusData.status == "failed") {
          await SyncServer.updateFields("message", messageUuid, {
            time: statusData.timestamp * 1000,
            errorDetails: getStatusError(statusData).errorDetails,
          });
        }
        await SyncServer.createOrGet("messageStatus", uuidv7(), {
          message: messageUuid,
          msgStatus: statusData.status,
          time: statusData.timestamp * 1000,
          ...getStatusError(statusData),
        });
      }
      continue;
    }

    data = extractTemplateStatusData(change);
    console.log("EMITIENDO POR ENTRADA", data);

    if (data != null) {
      io.emit("templateChanged");
    }
  }

  res.sendStatus(200);
  // } catch (e) {
  //   // console.log(util.inspect(e));
  //   res.sendStatus(404);
  // }
};
const createChatClientMapData = async (contacts, recipientData) => {
  const chatClientMapDB = {};

  for (const contact of contacts) {
    const profile = contact.profile;

    const username = profile.name;
    const wid = contact.wa_id;
    console.log("CREANDO CUENTAAAAAAAAAAAAAAAAAAAA");
    let whatsappAccountDB = await SyncServer.createOrGet(
      "whatsappAccount",
      recipientData.phoneNumberId,
      {
        name: `+${recipientData.phoneNumber}`,
        businessPhone: recipientData.phoneNumber,
        businessPhoneId: recipientData.phoneNumberId,
      }
    );
    console.log("termino CREACION DE  CUENTAAAAAAAAAAAAAAAAAAAA");

    let clientDB = await SyncServer.createOrGet("client", wid, {
      wid,
      username,
    });
    if (clientDB.username != username) {
      await SyncServer.updateFields("client", wid, { username });
    }

    let chatDB = await SyncServer.createOrGet(
      "chat",
      `${clientDB.uuid}_${whatsappAccountDB.uuid}`,
      {
        client: clientDB.uuid,
        whatsappAccount: whatsappAccountDB.uuid,
        lastSeen: 0,
        chatbot: false,
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
function extractNumberAndContent(input) {
  // Regex para cualquier corchete con número en cualquier parte del texto
  const regexWithNumber = /\[([^\]]*?(\d+)[^\]]*?)]/g;
  // Regex para cualquier tipo de corchetes
  const regexEmptyBrackets = /\[[^\]]*]/g;

  const numbers = [];
  let match;

  // Buscamos todos los números en corchetes
  while ((match = regexWithNumber.exec(input)) !== null) {
    const numberMatch = match[0].match(/\d+/);
    if (numberMatch) {
      numbers.push(parseInt(numberMatch[0]));
    }
  }

  // Limpiamos el contenido de todos los corchetes (con o sin números)
  const content = input.replace(regexEmptyBrackets, "").trim();

  return { numbers: numbers, content: content };
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
  // if (mediaPrompts.length != 0) {
  //   const responseJson = await generateChatBotMessage(
  //     [],
  //     ` *Eres una analizador de mensaje y devuelves en formato JSON
  //       Se te proveera un mensaje y una lista de oraciones
  //       Analizaras el mensaje y identificaras si el mensaje hace referencia a algun elemento de la lista
  //       Solo podras devolver un elemento el que mas se adecue
  //       No es obligatorio devolver un elemento
  //       El formato de salida sera:

  //       {
  //         name:(String o null, elemento de la lista)
  //       }
  //     `,
  //     `
  //       *El mensaje es:
  //        ${clientMessage}
  //       *La lista de elementos es :
  //       ${mediaPrompts.map((item) => `${item.description}`).join("\n")}
  //     `,

  //     true
  //   );
  //   const response = JSON.parse(responseJson);
  //   if (response.name != null) {
  //     for (const m of mediaPrompts) {
  //       if (response.name.trim() == m.description.trim()) {
  //         mediaContent = await MediaContent.findOne({ uuid: m.mediaContent });
  //         break;
  //       }
  //     }
  //   }
  // }
  let indexes = [];
  for (const h of historial) {
    indexes.push(...extractNumberAndContent(h.content).numbers);
  }
  let chatbotMessage = await generateChatBotMessage(
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
${
  mediaPrompts.length &&
  `Formato de respuesta:

Lista de multimedia disponible:
A continuación, tienes una lista de opciones de multimedia que puedes utilizar. Cada elemento está identificado por su índice ([index]): ${mediaPrompts
    .map((item, index) => ` [${index}] ${item.description}`)
    .join("\n")}
Reglas para incluir multimedia:
No es obligatorio incluir multimedia en tu respuesta.
Usa multimedia únicamente si enriquece el contenido de tu respuesta y es relevante para el contexto.
Si decides incluir una multimedia, insértala en este formato:
[index]
(Ejemplo: Si seleccionas la multimedia con índice 2, añade [2] al comienzo de tu respuesta).
La multimedia, si se incluye, debe ir siempre al inicio del mensaje de respuesta.
Solo puedes incluir una multimedia por respuesta.
Restricciones internas (no visibles para el usuario):
Evita repetir índices de multimedia que ya hayas utilizado anteriormente, a menos que el usuario lo solicite explícitamente.
La selección de multimedia debe ser variada para no cansar al usuario, pero el usuario no debe saber que estás evitando repeticiones. Esto es una lógica interna.
Formato de tu respuesta:
Escribe tu respuesta en texto plano.
Si decides incluir multimedia, esta debe ir al inicio de tu mensaje, en el formato [index].
Asegúrate de que tu respuesta sea clara, coherente y que la multimedia (si la incluyes) esté en contexto con lo expresado.`
}

*Información sobre el negocio que utilizarás:
  ${account.prompt}
`,
    clientMessage,
    false
  );
  // console.log(
  //   `INDICES MOSTRADOS ${indexes.length} ${indexes
  //     .map((item) => `${item}`)
  //     .join(",")}`
  // );
  let mediaContent = null;
  const { numbers, content } = extractNumberAndContent(chatbotMessage);
  // console.log(
  //   `SE TOMARA EL NUMERO ${numbers} de la respuesta ${chatbotMessage} ${
  //     mediaPrompts.length - 1
  //   }`
  // );

  if (numbers.length != 0) {
    const number = numbers[0];
    if (number > -1 && number < mediaPrompts.length) {
      // console.log("content ", mediaPrompts[number].mediaContent);
      mediaContent = await MediaContent.findOne({
        uuid: mediaPrompts[number].mediaContent,
      });
    }
  }
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
        CLOUD_API_ACCESS_TOKEN,
        businessPhoneId,
        clientDB.wid,
        clientMessageId,
        emoji
      );
    }
  }

  const messageUuid = uuidv7();
  await SyncServer.createOrGet("message", messageUuid, {
    chat: chat.uuid,
    wid: null,
    textContent: chatbotMessage,
    mediaContent: mediaContent?.uuid ?? "",
    sent: true,
    category: "text",
    sentStatus: "send_requested",
  });
  let sendContentData = {
    body: content,
  };
  if (mediaContent?.category == "video" || mediaContent?.category == "image") {
    sendContentData = {
      link: `https://${DOMAIN}/api/temp/media/${mediaContent.savedFileName}` /* Only if linking to your media */,
      caption: content,
    };
    // console.log(`se intentara enviar con el link ${sendContentData.link}`);
  }
  const messageId = await sendWhatsappMessage(
    CLOUD_API_ACCESS_TOKEN,
    businessPhoneId,
    clientDB.wid,
    mediaContent?.category ?? "text",
    sendContentData,
    messageUuid,
    clientMessageId
  );
  await SyncServer.updateFields("message", messageUuid, {
    wid: messageId,
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
  // console.log(`EL MAPA ES ${util.inspect(chatClientMapData)}`);
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
    // console.log("EL MESSAGE DATA ES ", util.inspect(messageData));
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
      "mediaContent",
      mediaContentUuid,
      mediaContent
    );
    newMessageData.mediaContent = mediaContentUuid;
  }

  // console.log("EL MENSAJE ES ", util.inspect(mediaContent));

  let messagesHistorial = [];
  if (chat.chatbot && newMessageData.textContent) {
    sendConfirmationMessage(
      CLOUD_API_ACCESS_TOKEN,
      recipientData.phoneNumberId,
      message.id
    );
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
  await SyncServer.createOrGet("message", uuidv7(), newMessageData);
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
const extractClientMessageData = (change) => {
  try {
    if (change.field != "messages") {
      return null;
    }
    const value = change.value;
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
const extractMessageStatusData = (change) => {
  try {
    if (change.field != "messages") {
      return null;
    }
    const value = change.value;
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

const extractTemplateStatusData = (change) => {
  if (change.field != "message_template_status_update") {
    return null;
  }
  return change.value;
};

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
  if (json) {
    dataConfig.stream = false;
    dataConfig.response_format = { type: "json_object" };
  }
  const chatCompletion = await groqClient.chat.completions.create(dataConfig);
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
async function getChatbotForm(conversationString, clientMessage, formNames) {
  const responseFormName = await generateChatBotMessage(
    [],
    ``,
    `Eres un analizador de mensajes que responderá exclusivamente en formato JSON.

Reglas clave para validar un proceso:
Un mensaje del cliente será válido para iniciar un proceso si:
Es una respuesta directa y afirmativa a una pregunta del sistema relacionada con el inicio de un proceso específico en la lista ${formNames}. Por ejemplo, "Sí" o "Claro" en respuesta directa a "¿Quieres iniciar el proceso de registro?".
El mensaje incluye una declaración explícita o implícita que indique claramente la intención del cliente de iniciar un proceso dentro de la lista ${formNames}. Ejemplo: "Quiero registrarme" o "Necesito abrir una cuenta bancaria".
Un mensaje afirmativo genérico (como "Sí", "Claro", "Ok") será considerado inválido si:
No responde directamente a una pregunta del sistema relacionada con un proceso específico.
El cliente no detalla explícitamente el proceso que desea iniciar.
Validación estricta de los procesos disponibles:
Solo se considerarán válidos los procesos que se encuentren en la lista ${formNames}.
Si el mensaje del cliente no puede asociarse de manera inequívoca a un proceso en la lista ${formNames}, el campo "name" será null.
Si el mensaje no cumple con las condiciones anteriores:
El proceso no será válido.
El campo "name" será null.
El campo "razon" debe explicar por qué el mensaje no es válido: ambiguo, no relacionado con un proceso, o fuera de la lista ${formNames}.
Formato de respuesta JSON:
{
  "ultimo_mensaje_usuario": string,
  "name": string | null,
  "razon": string
}
Casos de uso cubiertos:
Caso 1: Respuesta directa a una pregunta sobre un proceso (válido)
Lista de procesos válidos:
["Apertura de cuenta bancaria", "Solicitud de crédito hipotecario"]

Historial de la conversación:
{
  "conversation": [
    {"sistema": "¿Quieres realizar la apertura de una cuenta bancaria?"},
    {"cliente": "Sí"}
  ]
}
Respuesta esperada:
{
  "ultimo_mensaje_usuario": "Sí",
  "name": "Apertura de cuenta bancaria",
  "razon": "El último mensaje del cliente ('Sí') es una respuesta afirmativa directa a la pregunta del sistema sobre iniciar el proceso de apertura de cuenta bancaria."
}
Caso 2: Declaración explícita independiente del cliente (válido)
Lista de procesos válidos:
["Apertura de cuenta bancaria", "Solicitud de crédito hipotecario"]

Historial de la conversación:
{
  "conversation": [
    {"sistema": "¿En qué puedo ayudarte hoy?"},
    {"cliente": "Quiero solicitar un crédito hipotecario"}
  ]
}
Respuesta esperada:
{
  "ultimo_mensaje_usuario": "Quiero solicitar un crédito hipotecario",
  "name": "Solicitud de crédito hipotecario",
  "razon": "El último mensaje del cliente ('Quiero solicitar un crédito hipotecario') es una declaración explícita de intención para iniciar el proceso de solicitud de crédito hipotecario."
}
Caso 3: Mensaje afirmativo genérico, pero no relacionado con un proceso (inválido)
Lista de procesos válidos:
["Inscripción al curso de cocina", "Asesoría nutricional"]

Historial de la conversación:
{
  "conversation": [
    {"sistema": "¿En qué puedo ayudarte hoy?"},
    {"cliente": "Sí"}
  ]
}
Respuesta esperada:
{
  "ultimo_mensaje_usuario": "Sí",
  "name": null,
  "razon": "El último mensaje del cliente ('Sí') no es una respuesta directa a una pregunta sobre un proceso específico y no detalla explícitamente qué proceso quiere iniciar."
}
Caso 4: Mensaje genérico que responde a una pregunta irrelevante (inválido)
Lista de procesos válidos:
["Inscripción al curso de cocina", "Asesoría nutricional"]

Historial de la conversación:
{
  "conversation": [
    {"sistema": "¿Solo quiere información sobre el curso?"},
    {"cliente": "Sí"}
  ]
}
Respuesta esperada:
{
  "ultimo_mensaje_usuario": "Sí",
  "name": null,
  "razon": "El último mensaje del cliente ('Sí') responde a una pregunta del sistema sobre información, no sobre iniciar un proceso. Por lo tanto, no es válido para iniciar ningún proceso."
}
Caso 5: Declaración explícita después de un cambio de contexto (válido)
Lista de procesos válidos:
["Inscripción al curso de cocina", "Asesoría nutricional"]

Historial de la conversación:
{
  "conversation": [
    {"sistema": "¿Quieres inscribirte al curso de cocina?"},
    {"cliente": "¿Cuándo inicia el curso?"},
    {"sistema": "El curso inicia el 5 de diciembre. ¿En qué más te puedo ayudar?"},
    {"cliente": "Quiero inscribirme al curso de cocina"}
  ]
}
Respuesta esperada:
{
  "ultimo_mensaje_usuario": "Quiero inscribirme al curso de cocina",
  "name": "Inscripción al curso de cocina",
  "razon": "El último mensaje del cliente ('Quiero inscribirme al curso de cocina') es una declaración explícita de intención para iniciar el proceso de inscripción al curso de cocina, lo que lo hace válido."
}
Caso 6: Mensaje implícito válido con palabras clave reconocidas (válido)
Lista de procesos válidos:
["Registro en el sistema de salud", "Actualización de datos médicos"]

Historial de la conversación:
{
  "conversation": [
    {"sistema": "¿En qué puedo ayudarte hoy?"},
    {"cliente": "Necesito registrarme en el sistema de salud, mi número es 12345678"}
  ]
}
Respuesta esperada:
{
  "ultimo_mensaje_usuario": "Necesito registrarme en el sistema de salud, mi número es 12345678",
  "name": "Registro en el sistema de salud",
  "razon": "El último mensaje del cliente ('Necesito registrarme en el sistema de salud, mi número es 12345678') indica de forma implícita su intención de iniciar el proceso de registro en el sistema de salud."
}
Instrucciones finales:
Ahora analiza la siguiente conversación:
Historial de la conversación:
${conversationString}
Último mensaje del cliente:
${clientMessage}
Lista de procesos válidos:
${formNames}

Responde exclusivamente en el siguiente formato JSON:
{
  "ultimo_mensaje_usuario": string,
  "name": string | null,
  "razon": string
}

    Ahora analiza la siguiente conversación:
    Historial de la conversación:
    ${conversationString}
    Último mensaje del cliente:
    ${clientMessage}
    Lista de procesos válidos:
    ${formNames}
   `,
    true
  );
  return JSON.parse(responseFormName);
}
async function isEndCurrentForm(conversationString, clientMessage) {
  const responseFormName = await generateChatBotMessage(
    [],
    ``,
    `Eres un analizador de mensajes que responderá exclusivamente en formato JSON. Tu objetivo principal es determinar si el mensaje del usuario indica que desea terminar el proceso actual. Analiza el mensaje del usuario en el contexto de la conversación y responde en el formato especificado.

      Reglas clave para determinar si el proceso debe terminar:
      Un mensaje del cliente indicará intención de terminar el proceso actual si:
      Contiene frases explícitas como: "Todo está bien", "Sí, terminemos", "Está correcto", "Eso es todo", "Gracias, ya terminé", "No quiero", "No deseo seguir", u otras declaraciones similares que confirmen o indiquen el cierre del proceso o rechazo a continuar.
      Es una respuesta afirmativa directa o implícita, incluso con dudas, como: "Creo que sí", "No estoy seguro, pero supongo que sí". Estos mensajes, aunque denoten incertidumbre, serán interpretados como intención válida de finalizar.
      Expresa rechazo o negativa de continuar con el proceso, como: "No quiero", "No deseo seguir", "No pienso hacerlo", etc. Estos mensajes serán considerados como intención de terminar, ya que indican que el cliente no desea continuar participando.
      Un mensaje ambiguo o irrelevante no indicará intención de terminar el proceso.
      Ejemplos: "Hola", "No sé", "Explícame más", "Tengo dudas", etc. En estos casos, el campo "terminar" será false.
      Mensajes que no se relacionen con el contexto del proceso tampoco indicarán intención de finalizar.
      Ejemplo: Si el cliente cambia de tema o habla de algo no relacionado, se considerará que no desea finalizar el proceso.
      Formato de respuesta JSON:
      Responde exclusivamente en el siguiente formato:
      {
        "ultimo_mensaje_usuario": string,
        "terminar": boolean,
        "razon": string
      }
      ultimo_mensaje_usuario: El último mensaje enviado por el cliente.
      terminar: true si el mensaje indica intención de finalizar el proceso, false en caso contrario.
      razon: Explicación breve que justifique el valor de "terminar", indicando por qué el mensaje es válido para finalizar el proceso o no.
      Casos de uso cubiertos:
      Caso 1: Mensaje explícito que indica intención de finalizar (válido)
      Historial de la conversación:
      {
        "conversation": [
          {"sistema": "¿Está todo correcto con los datos ingresados?"},
          {"cliente": "Sí, todo está bien"}
        ]
      }
      Respuesta esperada:

      {
        "ultimo_mensaje_usuario": "Sí, todo está bien",
        "terminar": true,
        "razon": "El mensaje del cliente ('Sí, todo está bien') indica explícitamente que desea finalizar el proceso actual."
      }
      Caso 2: Mensaje afirmativo con duda implícita (válido)
      Historial de la conversación:

      {
        "conversation": [
          {"sistema": "¿Está todo correcto con los datos ingresados?"},
          {"cliente": "No sé, creo que sí"}
        ]
      }
      Respuesta esperada:

      {
        "ultimo_mensaje_usuario": "No sé, creo que sí",
        "terminar": true,
        "razon": "El mensaje del cliente ('No sé, creo que sí') implica una afirmación implícita, por lo que se interpreta como intención de finalizar el proceso actual."
      }
      Caso 3: Mensaje de negativa o rechazo a continuar (válido)
      Historial de la conversación:

      {
        "conversation": [
          {"sistema": "¿Puedes confirmar este dato?"},
          {"cliente": "No quiero"}
        ]
      }
      Respuesta esperada:
      {
        "ultimo_mensaje_usuario": "No quiero",
        "terminar": true,
        "razon": "El mensaje del cliente ('No quiero') expresa una negativa clara a continuar, lo que se interpreta como intención de finalizar el proceso actual."
      }
      Caso 4: Mensaje que cambia de contexto o tema (inválido)
      Historial de la conversación:
      {
        "conversation": [
          {"sistema": "¿Está todo correcto con los datos ingresados?"},
          {"cliente": "Por cierto, ¿tienen promociones en otros servicios?"}
        ]
      }
      Respuesta esperada:
      {
        "ultimo_mensaje_usuario": "Por cierto, ¿tienen promociones en otros servicios?",
        "terminar": false,
        "razon": "El mensaje del cliente ('Por cierto, ¿tienen promociones en otros servicios?') no está relacionado con el proceso actual y no indica intención de finalizarlo."
      }
      Caso 5: Mensaje ambiguo o trivial (inválido)
      Historial de la conversación:

      {
        "conversation": [
          {"sistema": "¿Está todo correcto con los datos ingresados?"},
          {"cliente": "Hola"}
        ]
      }
      Respuesta esperada:
      {
        "ultimo_mensaje_usuario": "Hola",
        "terminar": false,
        "razon": "El mensaje del cliente ('Hola') no está relacionado con el proceso actual ni indica intención de finalizarlo."
      }
      Caso 6: Mensaje implícito que confirma el cierre del proceso (válido)
      Historial de la conversación:

      {
        "conversation": [
          {"sistema": "¿Hay algo más en lo que pueda ayudarte?"},
          {"cliente": "No, eso sería todo"}
        ]
      }
      Respuesta esperada:
      {
        "ultimo_mensaje_usuario": "No, eso sería todo",
        "terminar": true,
        "razon": "El mensaje del cliente ('No, eso sería todo') implica de manera clara que desea finalizar el proceso actual."
      }
      Instrucciones finales:
      Ahora analiza la siguiente conversación:

      Historial de la conversación:
      ${conversationString}
      Último mensaje del cliente:
      ${clientMessage}
      Responde exclusivamente en el siguiente formato JSON:
      {
        "ultimo_mensaje_usuario": string,
        "terminar": boolean,
        "razon": string
      }
   `,
    true
  );
  return JSON.parse(responseFormName);
}
async function sendMessageChatbot(
  historial,
  clientDB,
  clientMessage,
  clientMessageId,
  businessPhone,
  businessPhoneId
) {
  console.log("=============COMIENZO DE RESPUESTA===================");
  const currentHour = moment().tz("America/Lima").format("hh:mm A");
  const currentDate = moment().tz("America/Lima").format("DD/MM/YYYY");
  let formNames = "";
  let count = 0;
  const conversationalForms = await ConversationalForm.find();
  const conversationalFormMap = {};
  for (const form of conversationalForms) {
    formNames += `${form.name}\n`;
    conversationalFormMap[form.name] = form;
  }
  let conversationString = "Conversación que se tuvo:";
  let conversation = [...historial];
  conversation.push({ role: "user", content: clientMessage });
  for (const v of conversation) {
    if (v.role == "assistant") {
      conversationString += "-Sistema:\n";
      conversationString += " Mensaje:" + v.content + "\n";
    } else {
      conversationString += "-Cliente:\n";
      conversationString += " Mensaje:" + v.content + "\n";
    }
  }

  if (clientDB.formProcess == null) {
    console.log("- El proceso actual es null");
    const { ultimo_mensaje_usuario, razon, name } = await getChatbotForm(
      conversationString,
      clientMessage,
      formNames
    );
    clientDB.formProcess = name;
    console.log("- Se obtuvo el nuevo proceso actual ", clientDB.formProcess);
    console.log("- Razon de la decision:'", razon, "'");
    console.log(
      "- Ultimo mensaje que se tomo en cuenta:'",
      ultimo_mensaje_usuario,
      "'"
    );
    await clientDB.save();
  } else {
    console.log("- El proceso actual tiene valor", clientDB.formProcess);
    const { terminar, razon, ultimo_mensaje_usuario } = await isEndCurrentForm(
      conversationString,
      clientMessage
    );
    console.log("- Se terminara el proceso actual?", terminar);
    console.log("- Razon de la decision:'", razon, "'");
    console.log(
      "- Ultimo mensaje que se tomo en cuenta:'",
      ultimo_mensaje_usuario,
      "'"
    );

    if (terminar) {
      clientDB.formProcess = null;
      await clientDB.save();
    }
  }
  console.log("***SIGUIENTE ETAPA***");

  if (clientDB.formProcess != null) {
    console.log("-El proceso actual tiene valor ", clientDB.formProcess);
    const currentForm = conversationalFormMap[clientDB.formProcess];
    let currentFormValueDB = await ConversationalFormValue.findOne({
      conversationalForm: currentForm._id,
    });
    if (currentFormValueDB == null) {
      currentFormValueDB = new ConversationalFormValue({
        conversationalForm: currentForm._id,
        fields: [...currentForm.fields],
      });
    }
    let fieldsAllFirst = "[";

    for (const field of currentFormValueDB.fields) {
      fieldsAllFirst += JSON.stringify(field) + "\n";
    }
    fieldsAllFirst += "]";
    console.log("-Todos los campos antes de ser modificados\n", fieldsAllFirst);
    const responseFormName = await generateChatBotMessage(
      [],
      ``,
      `Eres un analizador de conversaciones especializado en extraer información proporcionada por el cliente a partir de un historial de conversación. Responderás exclusivamente en formato JSON.

      Objetivo principal
      A partir de una lista única de campos y un historial de conversación, extraer los valores más recientes proporcionados por el cliente para cada campo. La lista única de campos contiene objetos con las siguientes propiedades:

      name: Nombre único del campo (clave para el JSON de salida).
      description: Descripción del campo que orienta sobre el tipo de dato esperado.
      value (opcional): Valor inicial del campo, si ya tiene uno asignado.
      El objetivo es devolver un JSON con el formato:
      {
        "field_name1": "nuevo_valor_o_valor_existente",
        "field_name2": null,
        "field_name3": "valor_modificado"
      }
      Para cada campo:

      Si el historial contiene un valor relevante, actualiza el campo con el valor más reciente proporcionado.
      Si no se encuentra un valor para el campo en el historial, asigna null.
      Instrucciones
      Procesamiento de la lista única de campos
      Estructura de la lista única de campos:
      La lista tiene objetos con la estructura:
      { "name": "nombre", "description": "Tu nombre completo", "value": "Ana" }
      La propiedad value es opcional. Si no está presente, significa que el campo aún no tiene un valor asignado.
      Claves del JSON de salida:
      Utiliza el valor de name como clave para el JSON de salida.
      Actualización de valores:
      Si el cliente proporciona un nuevo valor para un campo, actualiza el valor.
      Si no hay menciones relevantes en el historial para un campo, su valor será null (incluso si previamente no tenía valor).
      Análisis del historial de conversación
      Extracción explícita:
      Busca menciones directas al nombre o descripción del campo.
      Ejemplo: Si el cliente dice "Mi correo es ana@example.com", el valor de correo será "ana@example.com".
      Extracción implícita:
      Identifica datos que pueden asociarse claramente a un campo basado en el contexto, aunque el cliente no mencione explícitamente el nombre del campo.
      Ejemplo: Si el cliente dice "Hola, soy Ana", puedes inferir que el valor del campo nombre es "Ana".
      Modificaciones:
      Si un cliente menciona un cambio para un campo, como "Modifica mi teléfono a 555123456", actualiza el valor con el más reciente.
      Prioridad del dato más reciente:
      Si un mismo campo tiene múltiples valores proporcionados en diferentes momentos, selecciona el valor más reciente.
      Campos sin valor
      Si no se encuentra un valor asociado a un campo en el historial, asígnale el valor null en el JSON.

      Formato de salida
      La respuesta será un JSON con las claves correspondientes al name de los campos.
      Cada clave tendrá como valor el dato más reciente proporcionado en el historial, el valor inicial (si no fue modificado), o null si no se encuentra información para el campo.

      Ejemplo 1: Caso completo
      Lista única de campos:
      [
        { "name": "nombre", "description": "Tu nombre completo", "value": null },
        { "name": "correo", "description": "Tu correo electrónico", "value": null },
        { "name": "teléfono", "description": "Tu número de teléfono", "value": "918284124" }
      ]
      Historial de la conversación:
      [
        { "cliente": "Hola, soy Ana." },
        { "sistema": "¿Podrías proporcionarnos tu correo electrónico?" },
        { "cliente": "Claro, mi correo es ana@example.com." },
        { "sistema": "Gracias, Ana. ¿Algo más en lo que pueda ayudarte?" },
        { "cliente": "Modifica mi teléfono a 555123456." },
        { "sistema": "Listo, hemos actualizado tu teléfono." }
      ]
      Salida esperada:
      {
        "nombre": "Ana",
        "correo": "ana@example.com",
        "teléfono": "555123456"
      }
      Ejemplo 2: Valores faltantes
      Lista única de campos:
      [
        { "name": "DNI", "description": "Tu número de identificación personal", "value": null },
        { "name": "dirección", "description": "Tu dirección de residencia", "value": null },
        { "name": "teléfono", "description": "Tu número de teléfono", "value": "918284124" }
      ]
      Historial de la conversación:
      [
        { "cliente": "Mi DNI es 12345678." },
        { "sistema": "¿Podrías proporcionarnos tu dirección?" },
        { "cliente": "No la tengo a la mano en este momento." }
      ]
      Salida esperada:
      {
        "DNI": "12345678",
        "dirección": null,
        "teléfono": "918284124"
      }
      Ejemplo 3: Campo irrelevante ignorado
      Lista única de campos:
      [
        { "name": "nombre", "description": "Tu nombre completo", "value": null },
        { "name": "correo", "description": "Tu correo electrónico", "value": null },
        { "name": "teléfono", "description": "Tu número de teléfono", "value": "918284124" }
      ]
      Historial de la conversación:
      [
        { "cliente": "Mi nombre es Pedro." },
        { "cliente": "Por cierto, ¿pueden ayudarme con algo más? Mi coche está fallando." },
        { "sistema": "Claro, ¿podrías darnos tu correo electrónico?" },
        { "cliente": "Sí, es pedro@example.com." }
      ]
      Salida esperada:
      {
        "nombre": "Pedro",
        "correo": "pedro@example.com",
        "teléfono": "918284124"
      }
      Ejemplo 4: Todos los valores son null
      Lista única de campos:
      [
        { "name": "nombre", "description": "Tu nombre completo", "value": null },
        { "name": "correo", "description": "Tu correo electrónico", "value": null },
        { "name": "teléfono", "description": "Tu número de teléfono", "value": null }
      ]
      Historial de la conversación:
      [
        { "cliente": "Hola, ¿pueden ayudarme con algo?" },
        { "sistema": "Claro, ¿podrías proporcionarnos tu información?" },
        { "cliente": "Prefiero no compartirla ahora." }
      ]
      Salida esperada:
      {
        "nombre": null,
        "correo": null,
        "teléfono": null
      }
      Ahora analiza la siguiente conversación:
      Historial de la conversación:
      ${conversationString}
      Lista única de campos:
      ${fieldsAllFirst}
     `,
      true
    );
    const extractFields = JSON.parse(responseFormName);
    console.log(
      "-Se extrajo los siguientes datos\n",
      util.inspect(extractFields, true, 99)
    );

    for (const key in extractFields) {
      let fieldDB = null;
      for (const field of currentFormValueDB.fields) {
        if (field.name == key) {
          fieldDB = field;
        }
      }
      if (fieldDB) {
        if (extractFields[key]) {
          fieldDB.value = extractFields[key];
        }
      } else {
        currentFormValueDB.push({ name: key, value: extractFields[key] });
      }
    }
    await currentFormValueDB.save();

    let fieldsAll = "[";
    for (const field of currentFormValueDB.fields) {
      fieldsAll += JSON.stringify(field) + "\n";
    }
    fieldsAll += "]";
    console.log("-Todos los campos despues de ser modificados\n", fieldsAll);
    let currentField = null;
    for (const field of currentFormValueDB.fields) {
      if (field.value == null) {
        currentField = field;
      }
    }
    console.log(
      "-El actual field vacio es \n",
      util.inspect(currentField, true, 99)
    );
    if (currentField != null) {
      const chatbotMessage = await generateChatBotMessage(
        historial,
        `Eres un asistente diseñado para recopilar información de un cliente para un negocio. Siempre responderás educadamente en español, enfocándote exclusivamente en obtener los datos necesarios. Adaptarás tus respuestas al contexto y a la información proporcionada, evitando redundancias o confusiones.
          Contexto actual:

          Hora actual: ${currentHour}
          Fecha actual: ${currentDate}
          Información del negocio: ${BUSINESS_INFO}
          Nombre del proceso actual: ${clientDB.formProcess}
          Lista de procesos admitidos: ${fieldsAll}
          Campo actual a analizar:

          Nombre del campo: ${currentField.name}
          Descripción del campo: ${currentField.description}
          Valor actual del campo: ${currentField.value}
          Reglas estrictas que debes seguir:
          Prioridad en los campos vacíos:
          Enfócate únicamente en el campo vacío actual, definido como el primer campo con value: null dentro de la lista de campos admitidos.
          Si todos los campos están completos, no solicitarás información adicional. En este caso, solo responderás si el cliente menciona explícitamente que desea modificar algún dato.
          Si hay más de un campo vacío, administra uno a la vez y avanza al siguiente únicamente después de que el cliente proporcione la información solicitada.
          Manejo de campos existentes:
          Si el cliente menciona un campo ya completado (es decir, con un value definido), aceptarás amablemente modificaciones. Antes de actualizarlo, confirmarás el valor actual con el cliente.
          Una vez que el cliente proporcione un valor para el campo vacío actual, confirmarás la actualización y procederás al siguiente campo vacío (si lo hay).
          Tono profesional y educado:
          Mantendrás un tono amable, profesional y claro en todas tus respuestas.
          Evitarás respuestas casuales o irrelevantes. Cada mensaje debe aportar valor a la conversación y avanzar en la recopilación de los datos.
          Gestión de flujos irrelevantes o desviaciones:
          Si el cliente responde de forma trivial o desvía la conversación (por ejemplo: "Hola", "Gracias", "Ok"), redirigirás la conversación al campo vacío actual.
          Si el cliente aborda un tema no relacionado con el negocio, redirigirás educadamente la conversación hacia los datos necesarios.
          Evitar redundancias:
          No volverás a pedir información sobre campos ya completados, a menos que el cliente indique que desea modificarlos.
          No repetirás innecesariamente el propósito del proceso ni harás solicitudes redundantes.
          Formato humano y accesible:
          Tus respuestas deben ser claras, naturales y comprensibles, sin incluir formato técnico o estructurado como JSON.
          Explicarás sutilmente por qué solicitas los datos, relacionándolos con la finalidad del proceso, para que el cliente entienda su importancia.
          Estructura de los campos admitidos:
          Cada campo en la lista tiene la siguiente estructura:
          {
            "name": "nombre del campo",
            "description": "descripción del campo",
            "value": "valor dado por el usuario o null si está vacío"
          }
          Por ejemplo:
          [
            {"name": "Producto", "description": "El producto que deseas comprar", "value": "Laptop"},
            {"name": "Presupuesto", "description": "Tu presupuesto estimado", "value": null},
            {"name": "Fecha de compra", "description": "La fecha aproximada en la que deseas realizar tu compra", "value": null}
          ]
          En este caso, el campo vacío actual es el primero con value: null ("Presupuesto").

          Ejemplos prácticos:
          Escenario 1: Solicitar un campo vacío
          Contexto:

          Lista de campos admitidos:
          [
            {"name": "Destino del viaje", "description": "El destino al que deseas viajar", "value": "Tokio"},
            {"name": "Número de acompañantes", "description": "Cuántas personas viajarán contigo", "value": null},
            {"name": "Fecha de salida", "description": "La fecha en la que deseas salir", "value": null}
          ]
          Campo vacío actual:

          {"name": "Número de acompañantes", "description": "Cuántas personas viajarán contigo", "value": null}
          Respuesta:
          Hola, para continuar con la planificación de tu viaje a Tokio, necesitamos saber cuántas personas viajarán contigo. Este dato es importante para ajustar las reservas y los detalles del itinerario. ¿Podrías confirmármelo, por favor?

          Escenario 2: El cliente menciona un campo ya rellenado para modificar
          Contexto:

          Lista de campos admitidos:
          [
            {"name": "ID del producto", "description": "El identificador único del producto que deseas adquirir", "value": "PROD-12345"},
            {"name": "Cantidad", "description": "La cantidad del producto que deseas comprar", "value": null},
            {"name": "Método de pago", "description": "El método de pago que prefieres usar", "value": "Tarjeta de crédito"}
          ]
          Campo vacío actual:
          {"name": "Cantidad", "description": "La cantidad del producto que deseas comprar", "value": null}
          Cliente dice: "Quiero cambiar el método de pago."

          Respuesta:
          Por supuesto, actualmente tienes registrado como método de pago: Tarjeta de crédito. ¿Podrías indicarme el nuevo método que prefieres usar para actualizarlo? Además, seguimos pendientes de la cantidad del producto que deseas adquirir. ¿Me podrías confirmar este dato también?

          Escenario 3: Todos los campos están completos
          Contexto:

          Lista de campos admitidos:
          [
            {"name": "Nombre del proyecto", "description": "El título del proyecto que estás registrando", "value": "Rediseño de la página web"},
            {"name": "Fecha de inicio", "description": "La fecha aproximada en la que comenzará el proyecto", "value": "01/01/2025"},
            {"name": "Presupuesto inicial", "description": "El presupuesto inicial asignado para el proyecto", "value": "10,000 USD"}
          ]
          Respuesta:
          Perfecto, ya contamos con toda la información necesaria para registrar tu proyecto. Si necesitas realizar algún cambio en los datos proporcionados, no dudes en avisarme. ¡Gracias por tu tiempo!`,
        clientMessage,
        false
      );
      console.log(
        "- Respuesta del bot basado en el actual field\n",
        chatbotMessage
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
        `Eres un asistente enfocado en la confirmación y verificación de datos previamente recopilados para un cliente de un negocio. Siempre responderás educadamente y en español, con el objetivo de confirmar los datos existentes, permitir modificaciones si son necesarias y avanzar en el proceso.

Reglas estrictas que debes seguir:
1. Confirmación de datos existentes:
Siempre empieza mostrando los datos ya recopilados de manera clara y ordenada, listándolos para que el cliente pueda revisarlos.
Pregunta si los datos son correctos, ofreciendo opciones claras: confirmar que están correctos, modificar algún dato o indicar si es necesario agregar algo adicional relacionado con los datos ya registrados.
Nunca pidas información que ya está registrada. Si el cliente desea modificar algo, solo permite cambios en los campos específicos que ya tienes registrados (en ${fieldsAll}).
Si el cliente solicita modificar algo, actualiza únicamente los campos indicados y muestra el nuevo resumen actualizado para su confirmación.
Nunca asumas que faltan datos. Solo recopila información adicional si el cliente lo solicita explícitamente.
2. Interacción en español únicamente:
Responderás siempre en español, incluso si el cliente escribe en otro idioma.
Mantendrás un tono educado, profesional y enfocado, evitando un lenguaje técnico o complicado.
3. Opciones claras para el cliente:
Si el cliente confirma que los datos son correctos, avanza en el proceso indicando que todo está listo para proceder.
Si el cliente indica que algún dato es incorrecto, actualiza únicamente los campos permitidos y vuelve a mostrar el resumen actualizado para confirmación.
Si el cliente intenta agregar información fuera de los campos permitidos en ${fieldsAll}, educadamente informa que no es posible agregar esos datos y redirige la conversación hacia la revisión de los campos existentes.
4. Nunca pidas datos innecesarios:
No vuelvas a solicitar datos que ya tienes registrados. Asume que la información recopilada es completa a menos que el cliente indique lo contrario.
Si el cliente no solicita cambios ni confirma, redirige la conversación hacia la revisión de los datos ya listados.
5. No responder temas fuera del objetivo:
Si el cliente intenta hablar de temas no relacionados con el negocio o el proceso actual, redirige la conversación hacia la confirmación o modificación de los datos necesarios.
6. No responder mensajes triviales sin contexto:
Si el cliente dice algo trivial como "Hola", "Gracias", "Ok", etc., educadamente redirige la conversación hacia la confirmación de datos.
7. No mostrar dudas:
Siempre responde con seguridad sobre la información que ya tienes. No permitas que el cliente perciba dudas en tu capacidad de manejar los datos recopilados.
Información adicional que debes usar en tus respuestas:
Datos ya recopilados: ${fieldsAll} (los campos permitidos y sus valores actuales).
Hora actual: ${currentHour}.
Fecha actual: ${currentDate}.
Información del negocio: ${BUSINESS_INFO}.
Nombre del proceso actual: ${clientDB.formProcess}.
IMPORTANTE:
En tu primera respuesta, asegúrate de:
Mostrar el propósito de la confirmación de datos utilizando el nombre del proceso actual (${clientDB.formProcess}).
Explicar que los datos ya han sido recopilados y que solo es necesario validarlos o modificarlos para proceder.
Nunca menciones la necesidad de recopilar información adicional a menos que el cliente lo solicite explícitamente.
En las respuestas posteriores, no repitas constantemente el propósito del proceso, pero mantén el enfoque en la validación o modificación de los datos.
Si el cliente intenta desviar la conversación, redirige siempre hacia la confirmación o corrección de los datos.
Ejemplo de conversación corregido:
Primera interacción:
Asistente:
Gracias por tu tiempo. A continuación, te muestro los datos que tenemos registrados para tu solicitud de instalación de internet. Por favor, revísalos y confírmame si son correctos, o indícame si necesitas modificar algún dato:

Nombre completo: Juan Pérez
Número de teléfono: +34 612 345 678
Correo electrónico: juan.perez@email.com
Dirección de instalación: Calle Falsa 123, Madrid
Plan contratado: 80 Mbps
Fecha preferida para instalación: 30 de noviembre de 2024
¿Son correctos estos datos? Si necesitas modificar algo, por favor indícalo. Si todo está bien, confírmamelo para que podamos proceder con la instalación.

Cliente solicita cambios:
Cliente:
"Quiero cambiar la fecha de instalación."

Asistente:
Por supuesto, puedo actualizar la fecha de instalación. Por favor, indícame la nueva fecha que prefieras para realizar el cambio.

Cliente:
"Que sea el 2 de diciembre de 2024."

Asistente:
Perfecto, he actualizado la fecha de instalación a: 2 de diciembre de 2024. Aquí tienes el resumen actualizado para tu confirmación:

Nombre completo: Juan Pérez
Número de teléfono: +34 612 345 678
Correo electrónico: juan.perez@email.com
Dirección de instalación: Calle Falsa 123, Madrid
Plan contratado: 80 Mbps
Fecha preferida para instalación: 2 de diciembre de 2024
Por favor, confirma si todo está correcto para proceder.

Cliente confirma que todo está bien:
Cliente:
"Sí, todo está bien."

Asistente:
¡Perfecto! Gracias por confirmar. Procederemos con la instalación según los datos registrados. Si necesitas algo más, no dudes en decírmelo.
`,
        clientMessage,
        false
      );
      console.log(
        "- Respuesta del bot basado que no existe un field actual, osea todos llenos\n",
        chatbotMessage
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
    }
  } else {
    const chatbotMessage = await generateChatBotMessage(
      historial,
      `Eres un asistente que, a pesar de que el cliente hable en otro idioma o pida otro idioma, responderás siempre en español, de manera educada y profesional. Cumples las siguientes reglas estrictas:

        Reglas generales:
        Responde siempre en español.
        Incluso si el cliente escribe o solicita otro idioma, tu respuesta será exclusivamente en español.
        Responde de forma breve y concisa.
        Evita abrumar al cliente con demasiada información en una sola respuesta.
        Responde solo en formato de texto plano.
        No utilices JSON, HTML, canciones, ni ningún otro formato que no sea texto plano normal.
        No respondas temas fuera de la información del negocio.
        Si el cliente plantea temas ajenos, corta el tema de forma educada y redirige la conversación al propósito del negocio.
        No permitas que el cliente te haga dudar.
        Responde con seguridad y no inventes información. La información que tienes es correcta y debes mantener la confianza.
        Reglas específicas para procesos:
        Procesos válidos:
        Solo puedes trabajar con los procesos especificados en la lista de procesos válidos: ${formNames}.
        Rechaza educadamente cualquier solicitud de inicio o consulta sobre un proceso que no esté en esta lista.
        Identificación de intención:
        Si el cliente tiene intención de iniciar un proceso, pregúntale si quiere realizarlo mencionando el nombre exacto del proceso de la lista ${formNames}.
        Nunca inventes nombres de procesos.
        Modificación de datos registrados:
        Si el cliente indica que quiere modificar los datos que dio al sistema, analiza el contexto:
        Si el proceso relacionado está claro y es válido, inicia el proceso directamente mencionando su nombre formal.
        Si no encuentras el proceso relacionado, pregunta al cliente a cuál proceso se refiere.
        Confirmación de datos:
        Si ya tienes información registrada, muéstrala al cliente de forma clara y ordenada para que pueda revisarla.
        Nunca pidas datos que ya tienes registrados.
        Si el cliente solicita modificar algún dato, actualiza solo los campos necesarios y confirma los cambios.
        Interacción educada y enfocada:
        Si el cliente no tiene más consultas o confirma que todo está correcto, finaliza la conversación de forma cordial.
        Información adicional que debes usar en tus respuestas:
        Hora actual: ${currentHour}.
        Fecha actual: ${currentDate}.
        Información del negocio: ${BUSINESS_INFO}.
        Lista de procesos válidos: ${formNames}.
        IMPORTANTE:
        Inicio de procesos:
        Si el cliente tiene intención de iniciar un proceso, pregunta si quiere realizarlo mencionando su nombre formal según ${formNames}.
        Si el cliente solo quiere información, proporciona detalles según el proceso solicitado.
        Revisión de datos:
        Si ya tienes datos registrados del cliente, no vuelvas a solicitarlos.
        Confirma los datos existentes y permite al cliente corregir o agregar información si es necesario.
        Desconexión del contexto:
        Si el cliente menciona datos o procesos fuera del contexto del negocio o de ${formNames}, redirige la conversación de manera educada hacia los procesos válidos o la confirmación/modificación de datos.
        Cierre de la conversación:
        Si no hay más preguntas o solicitudes, cierra la conversación de forma educada y profesional.
        Ejemplo de conversación mejorado:
        Caso 1: El cliente quiere modificar datos registrados y el proceso está claro.
        Cliente:
        "Quiero modificar los datos que ya registré para la instalación de internet."

        Asistente:
        Entendido. Actualmente tenemos los siguientes datos registrados para tu solicitud de instalación de internet:

        Nombre completo: Juan Pérez
        Número de teléfono: +34 612 345 678
        Correo electrónico: juan.perez@email.com
        Dirección de instalación: Calle Falsa 123, Madrid
        Plan contratado: 80 Mbps
        Fecha preferida para instalación: 30 de noviembre de 2024
        Por favor, indícame qué dato deseas modificar para proceder con el cambio.

        Caso 2: El cliente quiere modificar datos, pero no especifica el proceso.
        Cliente:
        "Quiero modificar los datos que di antes."

        Asistente:
        Claro, puedo ayudarte a modificar tus datos. Sin embargo, necesito que me indiques a qué proceso te refieres. Los procesos disponibles son:

        Instalación de internet
        Actualización de datos personales
        Por favor, dime cuál de estos procesos deseas modificar para continuar.

        Caso 3: El cliente solicita un proceso fuera de la lista.
        Cliente:
        "Quiero iniciar un trámite de reparación de equipos."

        Asistente:
        Lo siento, pero el proceso de "reparación de equipos" no está disponible en este momento. Los procesos válidos que puedo gestionar son los siguientes:

        Instalación de internet
        Actualización de datos personales
        Por favor, indícame si deseas continuar con alguno de estos procesos.

        Caso 4: El cliente confirma que todo está bien.
        Cliente:
        "Todo está correcto, gracias."

        Asistente:
        Perfecto, gracias por confirmar. Procederemos con el proceso según los datos registrados. Si necesitas algo más, no dudes en decírmelo. Que tengas un excelente día.
                `,
      clientMessage,
      false
    );
    console.log(
      "- Respuesta del bot basado en que no tiene proceso actual\n",
      chatbotMessage
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

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
const { updateAndGetSyncCode } = require("../utils/sync");

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
  console.log("VERIFICANDO TOKEN");
  try {
    let token = req.query["hub.verify_token"];
    var challenge = req.query["hub.challenge"];
    if (challenge != null && token != null && token == MY_TOKEN) {
      res.send(challenge);
      return;
    }
  } catch (e) {
    console.log("ERROR ", e.message);
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
      clientDB = new Client({
        wid,
        version: 1,
        syncCode: await updateAndGetSyncCode("client", 1),
        uuid: uuidv7(),
        username,
        chatbot: false,
      });
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
async function getChatbotForm(
  conversationString,
  clientMessage,
  formNames,
  lastMessageAssistant
) {
  const responseFormName = await generateChatBotMessage(
    [],
    `Eres un experto analizando mensajes y respondes estrictamente en formato JSON.

REGLAS:

1. FORMATO DEL MENSAJE DEL SISTEMA:
   - Solo es válido si contiene EXACTAMENTE una pregunta con este formato:
   "¿Desea comenzar el formulario [nombre]?"
   - La pregunta debe estar completa, sin variaciones
   - Los corchetes deben ser reemplazados por un nombre válido
   - Cualquier otra variación invalida el mensaje

2. RESPUESTAS VÁLIDAS DEL USUARIO:
   - Solo se consideran afirmativas las siguientes respuestas que sean variantes de:
     * "si"
     * "sí"
     * "ok"
     * "vale"
     * "adelante"
     * "por supuesto"
   - No son válidas respuestas parciales o con texto adicional
   - No distingue mayúsculas/minúsculas

3. FORMATO DE RESPUESTA JSON:
{
    "formName": string | null,
    "reason": string
}

REGLAS DE RESPUESTA:
- formName: 
  * Si el mensaje del sistema y la respuesta son válidos: nombre del formulario
  * En cualquier otro caso: null

- reason:
  * Si formName no es null: "El usuario respondió afirmativamente a la pregunta del sistema que empieza con ¿Desea comenzar el formulario [nombre]?"
  * Si el mensaje del sistema es inválido: "El mensaje del sistema no contiene una pregunta válida de inicio de formulario"
  * Si la respuesta no es afirmativa: "El usuario no respondió afirmativamente"

EJEMPLOS:

Mensaje sistema: "¿Desea comenzar el formulario registro?"
Respuesta: "si"
{
    "formName": "registro",
    "reason": "El usuario respondió afirmativamente a la pregunta del sistema que empieza con ¿Desea comenzar el formulario registro?"
}

Mensaje sistema: "¿Quieres iniciar el formulario?"
Respuesta: "si"
{
    "formName": null,
    "reason": "El mensaje del sistema no contiene una pregunta válida de inicio de formulario"
}
    `,
    `Analiza la siguiente información:
    Lista de nombres de formularios validos:
    ${formNames}
    Mensaje del sistema:
    ${lastMessageAssistant}
    Mensaje del usuario:
    ${clientMessage}
   `,
    true
  );
  return JSON.parse(responseFormName);
}
async function isEndCurrentForm(conversationString, currentForm) {
  //AVECES FALLA LA GENERACION DE UN MENSAJE JSON POR PARTE DE GROQ
  const responseFormName = await generateChatBotMessage(
    [],
    `*Eres un experto analizando conversaciones y devuelves los resultados en formato JSON
    *Tu tarea es analizar una conversación y verificar si el usuario quiere finalizar el formulario actual
    *De acuerdo al contexto de la conversación, determinaras si el ultimo mensaje del usuario, tiene intenciones de finalizar el formulario actual
    *La conversación es para dar contexto, se le da mucho mas valor al ultimo mensaje del usuario
    *IMPORTANTE*: las unicas 3 razones en las que se finalizara el usuario:
     - Si el usuario responde afirmativamente cuando el assistant le pregunta si los campos que relleno son correctos y esta satisfecho
     - Si el usuario indica que quiere finalizar el formulario actual o tiene esa intención
     - Si el usuario no quiere brindar un campo que el assistant le solicita, negandose
      *IMPORTANTE*:no finalizar cuando:
     - Si anteriormente nego dar un dato, solo importa el ultimo mensaje, si en el ultimo mensaje esta dando los datos, no hay problema
     - Si el usuario proporcion un campo solicitado
  
     *Formato de respuesta JSON:
          {
            "finish": boolean
            "reason": string(razón de la decision de finalizar o no el formulario actual)
          }
    *Ejemplo 1:
    Nombre del formulario:
      Solicitud de registro de vehiculo
    Conversación:
      [
        {"assistant":"gracias por confiar en nosotros, necesito que me brinde su nombre completo"},
        {"user":"Marco Gomez Duran"},
        {"assistant":"Ok, ahora como ultimo dato, necesito la placa de su vehiculo"},
        {"user":"la placa es, 2H182H"}    
        {"assistant":"Esta bien, registre todos los datos, los cuales son:
                  - Nombre completo: Marco Gomez Duran
                  - Placa de vehiculo: 2H182H
                  - Precio del vehiculo: 20 000 soles
                  ¿Los datos son correctos? o desea modificar alguno"},
        {"user":"esta bien"}    


      ]
    Respuesta esperada:
    {
        "finish":true
        "reason":"Según su ultimo mensaje (esta bien),el usuario afirma a la pregunta del assistant que sus datos son correctos"
    }
    
    *Ejemplo 2:
    Nombre del formulario:
      Solicitud de prestamo
    Conversación:
      [
        {"assistant":"cual es el monto que requiere para el prestamo?"},
        {"user":"deseo, 10 000 soles"},
        {"assistant":"ok, ahora necesito su nombre completo"},
        {"user":"deseo finalizar, ya no me preguntes mas"},
      ]
    Respuesta esperada:
     {
        "finish":true
        "reason":"Según su ultimo mensaje (deseo finalizar, ya no me preguntes mas), el usuario indica que quiere finalizar el formulario actual y muestra rechazo a responder"
    }
      
    *Ejemplo 3:
    Nombre del formulario:
      Eliminación de cuenta
    Conversación:
      [
       {"assistant":"cual es el monto que requiere para el prestamo?"},
        {"user":"deseo, 10 000 soles"},
        {"assistant":"ok, ahora necesito su nombre completo"},
        {"user":"no quiero"},

      ]
     Respuesta esperada:
        {
        "finish":true
        "reason":"Según su ultimo mensaje (no quiero), el usuario indica que quiere no quiere proporcionar el dato que se le solicita"
    }
    
    *Ejemplo 4:
    Nombre del formulario:
      Eliminación de cuenta
    Conversación:
      [
       {"assistant":"cual es el monto que requiere para el prestamo?"},
        {"user":"deseo, 10 000 soles"},
        {"assistant":"ok, ahora necesito su nombre completo"},
        {"user":"Marcos salas"},

      ]
     Respuesta esperada:
        {
        "finish":false
        "reason":"Según su ultimo mensaje (Marcos salas), el usuario dio el campo solicitado, no muestra rechazo a responder, asi que no se finaliza el proceso"
        }
    *Ejemplo 5:
    Nombre del formulario:
      Eliminación de cuenta
    Conversación:
      [
       {"assistant":"cual es el monto que requiere para el prestamo?"},
        {"user":"deseo, 10 000 soles"},
        {"assistant":"ok, ahora necesito su nombre completo"},
        {"user":"No quiero"},
        {"assistant":"Se finalizo la eliminación de cuenta"},
        {"user":"Ahora si quiero"},
        {"assistant":"Entiendo que cambio de opinion, ahora necesito su nombre completo para finalizar la eliminación de cuenta"},
        {"user":"Jorge Duran Santos"},


      ]
     Respuesta esperada:
        {
        "finish":false
        "reason":"Según su ultimo mensaje (Jorge Duran Santos), el usuario dio el campo solicitado, incluso si anteriormente se negó a proporcionarlo, asi que no se finaliza el proceso"
        }
        `,
    `Analiza la siguiente información:
    Nombre del formulario:
    ${currentForm}

    Conversación:
    ${conversationString}
   `,
    true
  );
  return JSON.parse(responseFormName);
}
async function extraerInformacionNegocioDeMensaje(message) {
  const info = await generateChatBotMessage(
    [],
    `Eres un asistente especializado en extraer información específica de negocios.

FUNCIONAMIENTO:
1. Recibirás la información completa del negocio
2. Luego recibirás un mensaje
3. Tu tarea es ÚNICAMENTE extraer información del negocio cuando el mensaje tenga alguna relación directa o indirecta con algún aspecto del negocio

IMPORTANTE:
- Si el mensaje no menciona o se relaciona con ningún aspecto del negocio, responde: "No se detecta consulta sobre información del negocio"
- NO extraigas información si el mensaje es un saludo o no tiene relación con datos del negocio
- NO asumas que debes mostrar información si el mensaje no la requiere
- NO muestres categorías completas si solo se menciona un aspecto específico

FORMATO DE ENTRADA:
*Mensaje:
[Usuario proporcionará el texto a analizar]

*Información del negocio:
[Usuario proporcionará los datos]



FORMATO DE SALIDA:
[Solo si el mensaje se relaciona con algún aspecto del negocio]:
[Categoría]: [Información específica relacionada]
  `,
    `*Analiza el siguiente informacion:
    *Mensaje:
    ${message}

    *Información del negocio:
    ${BUSINESS_INFO}
   `,
    false
  );
  return info;
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
  let lastMessageAssistant = null;
  for (const form of conversationalForms) {
    formNames += `${form.name}\n`;
    conversationalFormMap[form.name] = form;
  }
  let conversation = [...historial];
  conversation.push({ role: "user", content: clientMessage });
  let conversationString = "[\n";
  for (const v of conversation) {
    if (v.role == "assistant") {
      lastMessageAssistant = v.content;
    }
    conversationString += `{"${v.role}":"${v.content}"}\n`;
  }
  conversationString += "]";
  if (clientDB.formProcess == null) {
    console.log("- El proceso actual es:\nnull");
    const { reason, formName } = await getChatbotForm(
      conversationString,
      clientMessage,
      formNames,
      lastMessageAssistant
    );
    clientDB.formProcess = formName;
    console.log("- Se obtuvo el nuevo proceso actual:\n", clientDB.formProcess);
    console.log("- Razon de la decision:\n", reason);
    console.log("- Lista de procesos analizados:\n", formNames);
    console.log("- Conversación analizada:\n", conversationString);

    await clientDB.save();
  } else {
    console.log("- El proceso actual es:\n", clientDB.formProcess);
    const { finish, reason } = await isEndCurrentForm(
      conversationString,
      clientDB.formProcess
    );
    // const finish = false;
    // const reason = "PRUEBA NO FINALIZAR NUNCA";
    console.log("- Se terminara el proceso actual?\n", finish);
    console.log("- Razon de la decision:\n", reason);

    if (finish) {
      let chatbotMessage = `Se finalizo el registro de ${clientDB.formProcess}`;
      clientDB.formProcess = null;
      await clientDB.save();
      const newMessage = new Message({
        version: 1,
        syncCode: await updateAndGetSyncCode("message", 1),
        client: clientDB.uuid,
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
        fields: currentForm.fields,
      });
    }
    let fieldsAllFirst = "[\n";

    for (const field of currentFormValueDB.fields) {
      fieldsAllFirst += `{"name":"${field.name}","description":"${field.description}", "value":"${field.value}"\n`;
    }
    fieldsAllFirst += "]";
    console.log(
      "-Todos los campos antes de ser modificados:\n",
      fieldsAllFirst
    );
    const responseFormName = await generateChatBotMessage(
      [],
      `*Eres un experto analizando conversaciones y devuelves los resultados en formato JSON
    *Tu tarea es analizar un mensaje y una lista de campos de un formulario
    *Extraeras valores del mensaje que sirvan para completar los campos de tu formulario
    *Si en el mensaje existen varios datos que pueden ser validos para un campo del formulario, se toma el ultimo
    *Solo trabajaras con los campos del formulario, no extraeras otro dato
    *IMPORTANTE: cuando realices el analisis y extraigas los datos, siempre toma en cuenta lo siguiente:
      - La descripcion de cada campo es importante, ya que tiene información mas detallada sobre el campo
      - En la conversación, se tiene que tomar en cuenta tambien al assistant, y analizar si este acepta el dato como valido, para que asi puedas extraer dicho dato
      - En la conversación, es probable que el usuario proporcione un dato que reemplace a un dato anterior para un campo, siempre toma el mensaje que este mas al ultimo o mas reciente como dato para extraer  
    *Formato de respuesta JSON:
      {
        "fieldName1": string(valor extraido para el fieldName1),
        "fieldName2": string(valor extraido para el fieldName2),
        "fieldName3": string(valor extraido para el fieldName3),
        "fieldName4": string(valor extraido para el fieldName4),
      }
    `,
      `Analiza la siguiente información:
      Nombre del formulario:
      ${clientDB.formProcess}

      Lista de campos del formulario:
      ${fieldsAllFirst}

      Mensaje que usaras para la extraccion de datos:
      ${clientMessage}
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
      }
    }
    await currentFormValueDB.save();

    let fieldsAll = "[\n";
    for (const field of currentFormValueDB.fields) {
      fieldsAll += `{"name":"${field.name}","description":"${field.description}", "value":"${field.value}"\n`;
    }
    fieldsAll += "]";
    console.log("-Todos los campos despues de ser modificados:\n", fieldsAll);
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
    console.log("-Los fields actualizados:\n", fieldsAll);

    if (currentField != null) {
      let chatbotMessage = await generateChatBotMessage(
        [],
        `*Eres un experto analizando conversaciones y me daras el resultado en formato JSON
    *Tu tarea es analizar una conversación y una lista de campos de un formulario
    *Crearas una respuesta que se centrara exclusivamente en preguntar al usuario sobre un campo del formulario que se te especificara
    *Si el mensaje final del usuario contiene datos de otros campos pero que pertenezcan a la lista de campos del formulario, le diras que guardaste dichos datos pero seguiras insistiendo en tomar el campo que te especificaron
    *En tu respuesta es obligatorio que solicites el campo que se te especifico, pero de forma sutil y humana
    *IMPORTANTE: cuando crees tu respuesta en base al campo especificado ten en cuenta lo siguiente:
      - La descripcion de cada campo es importante, ya que tiene información mas detallada sobre el campo
      - Si el campo en el que te enfocas, de acuerdo a la lista de campos del formulario, es el ultimo, informa al usuario sobre la casi finalizacion del formulario
      - Nunca le digas al usuario que su dato es repetido o que ya lo tenia registrado
      - Nunca menciones un dato anterior que fue registrado por el usuario, solo responde de forma directa que guardaste el dato y solicita el campo especificado
      *Ejemplo 1:
    Nombre del formulario:
      Solicitud de registro de vehiculo
    Lista de campos del formulario:
     [
      {"name":"placa del vehiculo","description":"la placa que identifica al vehiculo","value":null},
      {"name":"nombre completo","description":"nombre completo del usuario","value":"Marco Gomez Duran"},
      {"name":"precio del vehiculo","description":"precio estimado del vehiculo según el usuario","value":null}
     ]
    Campo vacio que te enfocaras:
      {"name":"placa de vehiculo","description":"la placa que identifica al vehiculo"}
    Conversación:
      [
        {"assistant":"gracias por confiar en nosotros, necesito que me brinde su nombre completo"},
        {"user":"Marcos Salas Duran"},
        {"assistant":"Ok, ahora necesito la placa de su vehiculo"},
        {"user":"disculpa, era Marco Gomez Duran"}    
      ]
    Respuesta esperada:
     {
        "response":"Ok, actualice su nombre, ahora como le decia, requiero la placa de su vehiculo"
     }
    
    *Ejemplo 2:
    Nombre del formulario:
      Solicitud de prestamo
    Lista de campos del formulario:
     [
      {"name":"nombre completo","description":"nombre completo del usuario","value":null}
      {"name":"monto","description":"monto del prestamo que el usuario pide","value":"10 000 soles"}
     ]
  Campo vacio que te enfocaras:
      {"name":"nombre completo","description":"nombre completo del usuario"}
    Conversación:
      [
        {"assistant":"cual es el monto que requiere para el prestamo?"},
        {"user":"deseo, 10 000 soles"},
        {"assistant":"ok, ahora necesito su nombre completo"},
        {"user":"bueno, mi hermano se llama Jorge Santivan Salas"},
      ]
    Respuesta esperada:
     {
        "response":"necesito el nombre de quien solicitara el prestamo, osea usted"
     }
    *Ejemplo 3:
    Nombre del formulario:
      Eliminación de cuenta
    Lista de campos del formulario:
     [
      {"name":"nombre completo","description":"nombre completo del usuario","value":null}
      {"name":"razon","description":"razon por la cual eliminara su cuenta","value":"ya no usa la cuenta"}
     ]
    Campo vacio que te enfocaras:
      {"name":"nombre completo","description":"nombre completo del usuario"}
    Conversación:
      [
        {"assistant":"ok, ya registre su nombre, ahora digame porque quiere eliminar su cuenta?"},
        {"user":"es que ya no la uso"},
      ]
    Respuesta esperada:
     {
        "response":"esta bien, solo necesito su nombre para finalizar la eliminacion de cuenta"
     } 
`,
        `Analiza la siguiente información:
      Nombre del formulario:
      ${clientDB.formProcess}

      Lista de campos del formulario:
      ${fieldsAll}
      
      Campo vacio que te enfocaras:
      {"name":"${currentField.name}","description":"${currentField.description}"}

      Conversación:
      ${conversationString}
     `,
        true
      );
      chatbotMessage = JSON.parse(chatbotMessage).response;
      console.log(
        "- Respuesta del bot basado en el actual field\n",
        chatbotMessage
      );
      const newMessage = new Message({
        version: 1,
        syncCode: await updateAndGetSyncCode("message", 1),
        client: clientDB.uuid,
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
      let parte_media = "\n";
      for (const field of currentFormValueDB.fields) {
        parte_media += `- *${field.name}*: ${field.value}\n`;
      }
      const parte_final = "¿Esta conforme y quiere finalizar?";
      const info_negocio_resumida = await extraerInformacionNegocioDeMensaje(
        clientMessage
      );
      console.log(
        `LA INFORMACION DEL NEGOCIO RELACIONADA AL MENSAJE(${clientMessage}) ES \n`,
        info_negocio_resumida,
        "\n",
        "FINNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN"
      );
      let chatbotMessage = await generateChatBotMessage(
        [],
        `ERES EXPERTO CREANDO MENSAJES DE ENTRADA, RESPONDERAS EN FORMATO JSON

FUNCIONAMIENTO:
1. Recibirás un mensaje de un cliente
2. Generarás una respuesta breve y directa
3. Incluirás información del negocio SOLO si el mensaje lo requiere
4. SIEMPRE finalizarás con: "Te muestro la información guardada:"

REGLAS ESTRICTAS:
- Responde únicamente lo consultado
- No agregues información extra
- Sé conciso y directo
- La frase final es OBLIGATORIA en TODOS los mensajes
- Mantén el formato JSON especificado

INFORMACIÓN DEL NEGOCIO:
${info_negocio_resumida}

FORMATO DE RESPUESTA JSON:
{
  "mensaje_respuesta": "string (Tu respuesta directa + 'Te muestro la información guardada:')",
  "reason": "string (Explicación breve de por qué generaste ese mensaje)"
}

EJEMPLOS DE FORMATO:

Para un saludo:
{
  "mensaje_respuesta": "Hola, bienvenido. Te muestro la información guardada:",
  "reason": "El cliente solo saludó, respondo cortésmente y agrego la frase obligatoria"
}

Para una consulta:
{
  "mensaje_respuesta": "El horario es de 9 AM a 6 PM. Te muestro la información guardada:",
  "reason": "El cliente preguntó por el horario, respondí específicamente y agregué la frase obligatoria"
}
        `,
        `Analiza la siguiente información:
    -Mensaje del cliente que analizaras para tu respuesta:
    ${clientMessage} 
 
    `,
        true
      );
      const data = chatbotMessage;
      chatbotMessage = JSON.parse(data).mensaje_respuesta;
      const reason = JSON.parse(data).reason;
      console.log(
        "- Respuesta del bot\n",
        JSON.parse(data),
        "\n- Recopilacion:\n",
        parte_media,
        "\nConversacion\n",
        conversationString
      );
      const parte_inicial = `${chatbotMessage}`;

      // let messageMejoradoResponse = await generateChatBotMessage(
      //   [],
      //   `Eres un experto mejorando un mensaje especifico que te mandaran en 2 partes, parte_inicial,parte_media, y responderas en formato JSON
      //   *Objetivos:
      //   -Mejorar parte_inicial, parte_media del mensaje para que en conjunto sean coherentes
      //   -Añadir emoticones unicode al mensaje para que sea mas humano, pero emojis diferentes, no repetitivos ni genericos
      //   -En tu mensaje mejorado, sera mostrado al usuario, asi que no pongas explicaciones de las correcciones que realizaste
      //   -Toma en cuenta la conversacion que te daran para mejorar tu respuesta
      //   *OBLIGATORIO*:
      //   -En la parte_inicial que mejoraras, incluye una referencia a una frase en la que indiques que le mostras la informacion que tienes hasta ahora del usuario, de forma sutil y amigable, y forma breve y corta
      //   *Formato de entrada:
      //   {
      //     parte_inicial:string(parte inicial del mensaje)
      //     parte_media:string(la parte media del mensaje)
      //   }
      //   *Procedimiento:

      //   Tomaras un historial de conversación, lo analizaras y mejoras cada parte del mensaje, pero de tal forma que en conjunto formen un mensaje coherente
      //   *Formato de respuesta:
      //     {
      //      parte_inicial:string(parte inicial mejorada del mensaje, que incluye una frase que indique que le mostras la informacion que tienes hasta ahora del usuario, de forma breve y corta)
      //      parte_media:string(parte media mejorada del mensaje )
      //     }
      //   `,
      //   `Analiza la siguiente información:

      // Conversación:
      // ${conversationString}

      // Partes del mensaje que mejoraras:
      // {
      //   parte_inicial:${parte_inicial}
      //   parte_media:${parte_media}
      // }

      // `,
      //   true,
      //   0.5
      // );

      // const datamejorada = JSON.parse(messageMejoradoResponse);
      // const parte_inicial_mejorada = datamejorada.parte_inicial;
      // const parte_media_mejorada = datamejorada.parte_media;
      // const parte_final_mejorada = datamejorada.parte_final;
      // console.log(
      //   "PARTES ANTES DE LA MEJORA:\nparte_inicial\n",
      //   parte_inicial,
      //   "\nparte_media:\n",
      //   parte_media,
      //   "\nparte_final\n",
      //   parte_final
      // );
      // console.log(
      //   "PARTES DESPUES DE LA MEJORA:\nparte_inicial\n",
      //   parte_inicial_mejorada,
      //   "\nparte_media:\n",
      //   parte_media_mejorada,
      //   "\nparte_final\n",
      //   parte_final_mejorada
      // );
      chatbotMessage = `*\`${clientDB.formProcess}\`*\n\n${parte_inicial}\n${parte_media}\n${parte_final}`;
      const newMessage = new Message({
        version: 1,
        syncCode: await updateAndGetSyncCode("message", 1),
        client: clientDB.uuid,
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
      `*Eres un asistente de un cliente en un negocio
       *Objetivo:
       -Ofrecer al cliente solo la informacion que pide de forma directa y breve
       -Añadiras emoticones unicode a tus respuesta para ser mas amigable
       -No uses siempre los mismos emoticones unicode de siempre, varia para ser menos generico
       *Prohibiciones:
       -Tienes prohibido realizar preguntas al cliente
       -Tu mensaje no puede contener ninguna pregunta
       -Tienes prohibido solicitar datos de cualquier tipo al cliente
       *Modo De Respuesta:
       -No responderas en formato JSON,html, ni ningun otro formato, incluso si te pide el cliente, no lo haras
       -No responderas a temas que no esten relacionados con el negocio
       *Informacion del negocio que usaras:
        [
        ${BUSINESS_INFO}
        ]
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
      version: 1,
      syncCode: await updateAndGetSyncCode("message", 1),
      client: clientDB.uuid,
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
    client: clientDB.uuid,
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
    console.log("EL MESSAGE DATA ES ", util.inspect(messageData));
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
  finalMessageData = {
    ...finalMessageData,
    ...{ version: 1, syncCode: await updateAndGetSyncCode("message", 1) },
  };
  console.log("EL MENSAJE ES ", util.inspect(finalMessageData));
  const newMessage = new Message({
    ...newMessageData,
    ...finalMessageData,
  });
  let messagesHistorial = [];
  if (clientDB.chatbot && newMessage.text) {
    const list = await Message.find(
      { client: clientDB.uuid },
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

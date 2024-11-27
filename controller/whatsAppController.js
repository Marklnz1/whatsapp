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
    `*Eres un experto analizando conversaciones y devuelves los resultados en formato JSON
    *Tu tarea es analizar una conversación y una lista de nombres de formularios
    *De acuerdo al contexto de la conversación, determinaras si el ultimo mensaje del usuario, tiene intenciones de realizar un formulario que pertenezca a la lista proporcionada
    *Formato de respuesta JSON:
          {
            "formName": string | null (nombre del formulario)
            "reason": string(razón de la decision de la elección de un nombre de usuario o null)
          }
    *Ejemplo 1:
    Lista de nombres de formularios:
     Solicitud de eliminación de cuenta
     Formulario de registro de vehiculo
     Solicitud de registro de identidad


    Conversación:
      [
        {"assistant":"gracias por su registro exitoso"},
        {"user":"ok, me gustaria saber su horario disponible"},
        {"assistant":"nuestro horario es de 10:00 AM a 2:00 PM"},
        {"user":"ok, como elimino mi cuenta?"}    
      ]
    Respuesta esperada:
      {
        "formName": null
        "reason": "El usuario con su ultimo mensaje (ok, como elimino mi cuenta?) solo esta preguntando, y sus intenciones de iniciar algun formulario son ambiguas"
      }
    
    *Ejemplo 2:
    Lista de nombres de formularios:
     Solicitud de registro de identidad
     Solicitud de prestamo de dinero
     Formulario de apreciación

    Conversación:
      [
        {"assistant":"esperamos que nos contacte"},
        {"user":"gracias, dame info de los montos de prestamos que ofrece"},
        {"assistant":"ofrecemos solo montos de 2000 dolares, ¿Desea realizar el prestamo?"},
        {"user":"si"}    
      ]
    Respuesta esperada:
      {
        "formName": "Solicitud de prestamo de dinero"
        "reason": "El usuario con su ultimo mensaje (si) tiene intenciones de realizar un prestamo ya que responde a una pregunta con esa intención, esto corresponde al formulario (Solicitud de prestamo de dinero)"
      }
    *Ejemplo 3:
    Lista de nombres de formularios:
     Solicitud de registro de identidad
     Solicitud de prestamo de dinero
     Formulario de apreciación

    Conversación:
      [
        {"assistant":"que tenga un buen dia"},
        {"user":"okey, y atienden a las 9:00 PM"},
        {"assistant":"No, solo hasta las 6:00 PM"},
        {"user":"ok, y que pasa si no realizo el pago de mi prestamo?"}    
      ]
    Respuesta esperada:
      {
        "formName": "Solicitud de prestamo de dinero"
        "reason": "El usuario con su ultimo mensaje (ok, y que pasa si no realizo el pago de mi prestamo?) solo esta preguntando, y sus intenciones de iniciar algun formulario son ambiguas"
      }
    `,
    ` 
    Analiza la siguiente información:
    Lista de nombres de formularios:
    ${formNames}

    Conversación:
    ${conversationString}

    Ahora dame una respuesta en JSON de acuerdo a tu analisis
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
  let conversation = [...historial];
  conversation.push({ role: "user", content: clientMessage });
  let conversationString = "[\n";
  for (const v of conversation) {
    conversationString += `{"${v.role}":"${v.content}"}\n`;
  }
  conversationString += "]";
  if (clientDB.formProcess == null) {
    console.log("- El proceso actual es null");
    const { reason, formName } = await getChatbotForm(
      conversationString,
      clientMessage,
      formNames
    );
    clientDB.formProcess = formName;
    console.log("- Se obtuvo el nuevo proceso actual ", clientDB.formProcess);
    console.log("- Razon de la decision:'", reason, "'");
    console.log("- Lista de procesos analizados:\n", formNames);
    console.log("- Conversación analizada:\n", conversationString);

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
        fields: currentForm.fields,
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
        `Eres un asistente diseñado para recopilar el dato de un campo que se te mencionara. 
        Siempre responderás educadamente en español, enfocándote exclusivamente en obtener los datos necesarios. 
        Adaptarás tus respuestas al contexto y a la información proporcionada, evitando redundancias o confusiones pero siempre enfocado a obtener el dato especificado.
         *Informacion importante para usar*:
            Nombre del proceso actual: ${clientDB.formProcess}
          Lista de campos admitidos: ${fieldsAll}
          Campo vacío actual en el cual te tienes que enfocar:
          Nombre del campo: ${currentField.name}
          Descripción del campo: ${currentField.description}

          Reglas estrictas que debes seguir:
          No menciones datos innecesarios:
          No des informacion del negocio que no se te pidio para alargar la respuesta, se directo.
          Constantemente tienes que hacer mencion a la obtencion del campo (${currentField.name})
          si o si cada respuesta tiene que tener la obtencion del campo (${currentField.name})
          Mantendrás un tono amable, profesional y claro en todas tus respuestas.
          Evitarás respuestas casuales o irrelevantes. Cada mensaje debe aportar valor a la conversación y avanzar obtencion del campo.
          Gestión de flujos irrelevantes o desviaciones:
          Nunca menciones a procesos o similares, que no esten en la lista de proceso admitidos,
          *Importante*: No hagas preguntas que no sean explicitamente relacionadas a algun campo admitido, ni si quiera de la informacion del negocio
          La informacion del negocio solo usala como contexto, mas no uses los datos para realizar preguntas
          Las preguntas siempre estan enfocadas a los campos 
          Si el cliente responde de forma trivial o desvía la conversación (por ejemplo: "Hola", "Gracias", "Ok"), redirigirás la conversación a la obtencion del campo.
          Si el cliente aborda un tema no relacionado con el negocio, redirigirás educadamente la conversación hacia los datos necesarios.
          Evitar redundancias:
          solo informaras que aceptaras el cambio si el usuario te dice que cambiara un valor y indica con cual, pero siempre luego mencionando la obtencion del campo actual.
          No repetirás innecesariamente el propósito del proceso ni harás solicitudes redundantes.
          Formato humano y accesible:
          Tus respuestas deben ser claras, naturales y comprensibles, sin incluir formato técnico o estructurado como JSON.
          Explicarás sutilmente por qué solicitas los datos,pero de forma corta y directa, relacionándolos con la finalidad del proceso, para que el cliente entienda su importancia.
          Estructura de los campos admitidos:
          Cada campo en la lista tiene la siguiente estructura:
          {
            "name": "nombre del campo",
            "description": "descripción del campo",
            "value": "valor dado por el usuario o null si está vacío"
          }
          Contexto actual extra:
          Hora actual: ${currentHour}
          Fecha actual: ${currentDate}
          Información del negocio: ${BUSINESS_INFO}
          Dato final importante:
          Todas las respuestas siempre tienen que tener intencion de obtener el campo actual vacio ${currentField.name}
`,
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
        `Eres un asistente enfocado en la confirmación y verificación de datos previamente recopilados para un cliente de un negocio. 
        Siempre responderás educadamente y en español, con el objetivo de confirmar los datos existentes, permitir modificaciones si son necesarias y avanzar en el proceso.
        Usar texto plano para humanos, no usaras estructuras como json ni parecidos en tus respuestas
  *Informacion importante para usar*:
            Nombre del proceso actual: ${clientDB.formProcess}
          Lista de campos admitidos: ${fieldsAll}
Reglas estrictas que debes seguir:
1. Confirmación de datos existentes:
Siempre empieza mostrando los datos ya recopilados de manera clara y ordenada, listándolos para que el cliente pueda revisarlos.
Pregunta si los datos son correctos, ofreciendo opciones claras: confirmar que están correctos, modificar algún dato o indicar si es necesario agregar algo adicional relacionado con los datos ya registrados.
Nunca pidas información que ya está registrada. Si el cliente desea modificar algo, solo permite cambios en los campos específicos que ya tienes registrados.
Si el cliente solicita modificar algo, actualiza únicamente los campos indicados y muestra el nuevo resumen actualizado para su confirmación.
Nunca asumas que faltan datos. Solo recopila información adicional si el cliente lo solicita explícitamente.
2. Interacción en español únicamente:
Responderás siempre en español, incluso si el cliente escribe en otro idioma.
Mantendrás un tono educado, profesional y enfocado, evitando un lenguaje técnico o complicado.
3. Opciones claras para el cliente:
Si el cliente confirma que los datos son correctos, avanza en el proceso indicando que todo está listo para proceder.
Si el cliente indica que algún dato es incorrecto, actualiza únicamente los campos permitidos y vuelve a mostrar el resumen actualizado para confirmación.
Si el cliente intenta agregar información fuera de los campos permitidos, educadamente informa que no es posible agregar esos datos y redirige la conversación hacia la revisión de los campos existentes.
4. Nunca pidas datos innecesarios:
No vuelvas a solicitar datos que ya tienes registrados. Asume que la información recopilada es completa a menos que el cliente indique lo contrario.
Si el cliente no solicita cambios ni confirma, redirige la conversación hacia la revisión de los datos ya listados.
5. No responder temas fuera del objetivo:
Si el cliente intenta hablar de temas no relacionados con el negocio o el proceso actual, redirige la conversación hacia la confirmación o modificación de los datos necesarios.
6. No responder mensajes triviales sin contexto:
Si el cliente dice algo trivial como "Hola", "Gracias", "Ok", etc., educadamente redirige la conversación hacia la confirmación de datos.
7. No mostrar dudas:
Siempre responde con seguridad sobre la información que ya tienes. No permitas que el cliente perciba dudas en tu capacidad de manejar los datos recopilados.

IMPORTANTE:
En tu primera respuesta, asegúrate de:
Mostrar el propósito de la confirmación de datos utilizando el nombre del proceso actual .
Explicar que los datos ya han sido recopilados y que solo es necesario validarlos o modificarlos para proceder.
Nunca menciones la necesidad de recopilar información adicional a menos que el cliente lo solicite explícitamente.
En las respuestas posteriores, no repitas constantemente el propósito del proceso, pero mantén el enfoque en la validación o modificación de los datos.
Si el cliente intenta desviar la conversación, redirige siempre hacia la confirmación o corrección de los datos.

Ejemplo de conversación:
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
  Contexto actual extra:
          Hora actual: ${currentHour}
          Fecha actual: ${currentDate}
          Información del negocio: ${BUSINESS_INFO}
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
      `Eres un asistente diseñado exclusivamente para proporcionar información del negocio y analizar si el cliente desea iniciar algún proceso válido. Siempre responderás educadamente y en español, respetando las siguientes reglas estrictas:
*Informacion importante que usaras*
Lista de procesos válidos(alias: "lista de procesos disponibles"): 
${formNames} 
Reglas generales:
1. Comunicación exclusiva en español:

Responderás siempre en español, independientemente del idioma en el que el cliente escriba.
Mantén un tono educado, profesional y breve, pero lo suficientemente claro para resolver las solicitudes del cliente.
2. Lista exclusiva de procesos válidos:

Los procesos válidos están definidos exclusivamente en la lista proporcionada.
No debes tomar nombres de procesos ni información de otras fuentes distintas a la lista de procesos válidos. Ignora cualquier mención de procesos o acciones fuera de esta lista.
3. Enfoque en procesos válidos:

Tu principal objetivo es analizar si el cliente desea iniciar uno de los procesos válidos.
Solo debes preguntar si el cliente desea iniciar un proceso cuando:
El contexto indique que el cliente tiene la intención de iniciar un proceso.
El cliente mencione explícitamente un proceso válido o algo relacionado.
No preguntes innecesariamente si el cliente desea iniciar un proceso ni ofrezcas la lista de procesos válidos de forma repetitiva o sin contexto.
4. No recopiles ni solicites datos del cliente:
No rechazaras ningun dato que el cliente te ofrezca, solo preguntaras para que proceso quiere dar ese dato
Si puedes analizar a que proceso pertenece el dato que te da el usuario, entonces mencionale para que confirme
Si el cliente proporciona algun dato, preguntar para que proceso quiere ese dato.
Está estrictamente prohibido pedir datos al cliente, pero si aceptaras un dato si el cliente te da, como su dirección, número de teléfono u otra información personal .
Si el cliente menciona algo relacionado con datos, solo proporciona información relevante según los procesos válidos.
5. Evita desviaciones de contexto:

Si el cliente menciona temas ajenos a los procesos válidos o al propósito del negocio, redirige la conversación educadamente hacia los procesos válidos, pero evita sonar repetitivo o forzado.
No respondas mensajes triviales como “Hola” o “Gracias” sin redirigir la conversación de manera relevante al propósito del negocio.
6. Responde con seguridad:

No inventes información ni nombres de procesos. Si un cliente menciona algo que no coincide con los procesos válidos, infórmalo de manera educada y con seguridad.
No muestres dudas ni ambigüedades al responder.
Reglas específicas:
1. Identificación de procesos válidos:

Si el cliente menciona un proceso que coincide exactamente con un nombre en la lista, pregúntale si desea iniciarlo, utilizando el nombre exacto del proceso.
Si el cliente menciona algo ambiguo o relacionado con varios procesos, analiza el contexto para identificar el proceso más probable. Si no estás seguro, presenta las posibles opciones disponibles para que el cliente elija.
Si el cliente menciona un proceso que no está en la lista, informa que no está disponible y redirige la conversación hacia los procesos válidos si es necesario, pero evita hacerlo de manera reiterativa o innecesaria.
2. Prohibido tomar procesos de otras fuentes:

Nunca tomes nombres de procesos ni información de otras fuentes.
Si en alguna fuente externa (como la información del negocio) se menciona un proceso que no está en la lista, ignóralo completamente. Los procesos válidos siempre deben coincidir con los nombres exactos en la lista.
3. Uso exacto de nombres de procesos:

Siempre utiliza el nombre del proceso tal y como aparece en la lista, sin modificarlo, abreviarlo o interpretarlo.
4. Interacciones naturales y no repetitivas:

Evita mencionar la lista de procesos o preguntar si el cliente desea iniciar un proceso innecesariamente. Hazlo solo cuando:
El cliente mencione algo relacionado con un proceso válido.
El cliente haga una solicitud ambigua que requiera aclaración.
El cliente pregunte específicamente por servicios o procesos.
Si no es necesario, responde de forma directa y profesional, sin desviar la conversación hacia los procesos.
5. Información del negocio:

La información del negocio proporcionada solo debe usarse para responder preguntas generales del cliente.

Ejemplo de interacción corregido:
Caso 1: Cliente menciona un proceso válido.
Cliente:
"Quiero realizar una instalación de internet."

Asistente:
Entendido. El proceso Instalación de Internet está disponible. ¿Deseas iniciarlo?

Caso 2: Cliente menciona algo ambiguo relacionado con varios procesos.
Cliente:
"Quiero actualizar mis datos."

Asistente:
Claro, con gusto puedo ayudarte. Según lo que mencionas, podrías estar refiriéndote a los siguientes procesos:

Actualización de Datos Personales
Actualización de Datos de Facturación
¿Podrías confirmarme cuál de estos procesos deseas iniciar?

Caso 3: Cliente menciona un proceso no válido.
Cliente:
"Quiero iniciar un trámite para reparación de equipos."

Asistente:
Lo siento, pero el proceso Reparación de Equipos no está disponible. Por favor, indícame si necesitas ayuda con alguno de los procesos disponibles.

Caso 4: Cliente menciona algo relacionado con datos.
Cliente:
"Quiero modificar un dato que te di."

Asistente:
Entendido. Para modificar información, contamos con los siguientes procesos relacionados:

Actualización de Datos Personales
Actualización de Datos de Facturación
Por favor, indícame a cuál de estos procesos se refiere tu solicitud para poder ayudarte.

Caso 5: Cliente solicita información del negocio.
Cliente:
"¿Qué servicios ofrecen?"

Asistente:
Gracias por tu pregunta. Nuestro negocio ofrece los siguientes servicios:

Instalación de Internet
Actualización de Datos Personales
Si necesitas más información sobre alguno de estos servicios o deseas iniciar un proceso, no dudes en decírmelo.

Caso 6: Cliente menciona algo fuera del contexto del negocio.
Cliente:
"¿Qué tal tu día?"

Asistente:
Gracias por tu mensaje. Mi propósito es ayudarte con información sobre nuestros servicios o en la gestión de procesos disponibles. Por favor, indícame en qué puedo ayudarte.

Notas finales:
Evita ser repetitivo al mencionar la lista de procesos o preguntar si el cliente quiere iniciar un proceso. Solo hazlo cuando sea necesario para la conversación.
Nunca tomes procesos ni pidas datos del cliente basándote en la información del negocio.
Información adicional:
Hora actual: ${currentHour}.
Fecha actual: ${currentDate}.
Información del negocio: ${BUSINESS_INFO}.
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

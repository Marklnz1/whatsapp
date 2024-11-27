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
    *IMPORTANTE:El campo reason tiene que tener sentido con el campo formName, es decir:
     - si en el campo reason dice que no se pudo obtener un nombre de formulario o similares, en el formName tiene que estar null
     - no seas inconsistente con la relacion entre el campo reason y el campo formName
    *IMPORTANTE*: 
    - Si las intenciones del usuario no son claras, entonces no eligas ningun formulario, ya que se tiene que estar seguro
    - Lo importante es el ultimo mensaje del usuario, osea el mas reciente para el analisis
     *Formato de respuesta JSON:
          {
            "formName": string | null (nombre del formulario, este valor es al que hace referencia el campo reason)
            "reason": string(razón de la decision de la elección de un nombre de usuario o null)
          }
     *IMPORTANTE*: 
     - Nunca devolver el valor de formName dando como excusa que se estuvo rellenando anteriormente, el ultimo mensaje del cliente es el que manda
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
        "reason": "El usuario con su ultimo mensaje (ok, como elimino mi cuenta?) solo esta preguntando,no se dara valor a un formulario rellenado anteriormente en la conversacion para el formName , y sus intenciones de iniciar algun formulario no son claras, por lo tanto el valor de formName es null"
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
        "reason": "El usuario con su ultimo mensaje (si), no se dara valor a un formulario rellenado anteriormente en la conversacion para el formName, tiene intenciones de realizar un prestamo ya que responde a una pregunta con esa intención, esto corresponde al formulario (Solicitud de prestamo de dinero)"
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
        "formName": null
        "reason": "El usuario con su ultimo mensaje (ok, y que pasa si no realizo el pago de mi prestamo?), no se dara valor a un formulario rellenado anteriormente en la conversacion para el formName, solo esta preguntando, y sus intenciones de iniciar algun formulario no son claras, por lo tanto el formName es null"
      }
     *Ejemplo 4:
    Lista de nombres de formularios:
     Solicitud de registro de identidad
     Solicitud de prestamo de dinero
     Formulario de apreciación

    Conversación:
      [
        {"assistant":"Esta bien, registre el nuevo dato, los datos que tengo son:
                      - DNI:81823123
                      - Nombre Completo:"Juan Gomez Sanches
                      Los datos son correctos? o desea modificar alguno"},
        {"user":"si"},
        {"assistant":"Se finalizo el registro de Solicitud de registro de identidad"},
        {"user":"Hola"}    
      ]
    Respuesta esperada:
      {
        "formName": null
        "reason": "El usuario con su ultimo mensaje (Hola),no se dara valor a un formulario rellenado anteriormente en la conversacion para el formName, solo esta saludando, incluso si anteriormente estuvo rellenando un formulario, actualmente no hay intenciones de iniciar ninguno, por lo tanto el formName es null"
      }
    `,
    `Analiza la siguiente información:
    Lista de nombres de formularios:
    ${formNames}

    Conversación:
    ${conversationString}
   `,
    true
  );
  return JSON.parse(responseFormName);
}
async function isEndCurrentForm(conversationString, currentForm) {
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
    console.log("- El proceso actual es:\nnull");
    const { reason, formName } = await getChatbotForm(
      conversationString,
      clientMessage,
      formNames
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
      clientMessage
    );
    console.log("- Se terminara el proceso actual?\n", finish);
    console.log("- Razon de la decision:\n", reason);

    if (finish) {
      let chatbotMessage = `Se finalizo el registro de ${clientDB.formProcess}`;
      clientDB.formProcess = null;
      await clientDB.save();
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
    *Tu tarea es analizar una conversación y una lista de campos de un formulario
    *Extraeras valores o datos de la conversación que sirvan para completar los campos de tu formulario
    *Si en la conversacion varios datos pueden ser validos para un campo del formulario, se toma el ultimo o mas reciente
    *Solo se toman los datos que analizando la conversación, el usuario tenga intenciones de brindarlas para completar el formulario
    *En la respuesta solo aparecen los campos de los cuales se pudo extraer información
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
    *Ejemplo 1:
    Nombre del formulario:
      Solicitud de registro de vehiculo
    Lista de campos del formulario:
     [
      {"name":"placa del vehiculo","description":"la placa que identifica al vehiculo","value":null},
      {"name":"nombre completo","description":"nombre completo del usuario","value":"Marco Gomez Duran"},
      {"name":"precio del vehiculo","description":"precio estimado del vehiculo según el usuario","value":null}
     ]

    Conversación:
      [
        {"assistant":"gracias por confiar en nosotros, necesito que me brinde su nombre completo"},
        {"user":"Marcos Salas Duran"},
        {"assistant":"Ok, ahora necesito la placa de su vehiculo"},
        {"user":"disculpa, era Marco Gomez Duran"}    
        {"assistant":"Ok, actualice su nombre, ahora como le decia, requiero la placa de su vehiculo"},
        {"user":"Ok, es 8UJB2214"},

      ]
    Respuesta esperada:
    {
      "placa del vehiculo":"8UJB2214",
      "nombre completo":"Marco Gomez Duran",
      "precio del vehiculo":null  
    }
    
    *Ejemplo 2:
    Nombre del formulario:
      Solicitud de prestamo
    Lista de campos del formulario:
     [
      {"name":"nombre completo","description":"nombre completo del usuario","value":null}
      {"name":"monto","description":"monto del prestamo que el usuario pide","value":"10 000 soles"}
     ]

    Conversación:
      [
        {"assistant":"cual es el monto que requiere para el prestamo?"},
        {"user":"deseo, 10 000 soles"},
        {"assistant":"ok, ahora necesito su nombre completo"},
        {"user":"bueno, mi hermano se llama Jorge Santivan Salas"},
        {"assistant":"necesito el nombre de quien solicitara el prestamo, osea usted"},
        {"user":"entonces no le brindare nada"}    
        {"assistant":"Ok, finalizare el formulario de Solicitud de prestamo"},
        {"user":"bueno"},

      ]
    Respuesta esperada:
      {
        "nombre completo":null,
        "monto":"10 000 soles"
      }
    *Ejemplo 3:
    Nombre del formulario:
      Eliminación de cuenta
    Lista de campos del formulario:
     [
      {"name":"nombre completo","description":"nombre completo del usuario","value":"Lucas marquez gomez"}
      {"name":"razon","description":"razon por la cual eliminara su cuenta","value":null}
     ]

    Conversación:
      [
        {"assistant":"ok, ya registre su nombre, ahora digame porque quiere eliminar su cuenta?"},
        {"user":"no necesito decirle la razón"},
        {"assistant":"no se preocupe, es opcional, procedere con la eliminación"},
        {"user":"esta bien, gracias"}
      ]
    Respuesta esperada:
      {
        "nombre completo":null,
        "razon":null
      }`,
      `Analiza la siguiente información:
      Nombre del formulario:
      ${clientDB.formProcess}

      Lista de campos del formulario:
      ${fieldsAllFirst}

      Conversación:
      ${conversationString}
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
      let chatbotMessage = await generateChatBotMessage(
        [],
        `*Eres un experto analizando conversaciones y me daras el resultado en formato JSON
    *Tu tarea es enfocarte en informar al usuario los campos rellenados que tienes del formulario
    *Tu actualmente tienes todos los campos rellenados, solo mostrar al usuario los campos y que te confirme si son correctos
    *Le mostraras la informacion en un formato amigable y entendible
    *Te enfocaras en el ultimo mensaje del usuario
    *Si el ultimo mensaje del usuario contiene intencion de modificar algun campo del formulario, confirmar el cambio y no refutar si es repetido, y luego mostrar los campos rellenados actualmente
    *Informar al usuario que no puedes modificar un campo que no pertenezca al formulario si este intenta dar un campo fuera de los campos del formulario
    *IMPORTANTE: cuando crees tu respuesta en base al campo especificado ten en cuenta lo siguiente:
      - La descripcion de cada campo es importante, ya que tiene información mas detallada sobre el campo
      - Nunca le digas al usuario que su dato es repetido o que ya lo tenia registrado
      - Nunca menciones un dato anterior que fue registrado por el usuario, solo responde de forma directa que guardaste el dato y muestra los campos rellenados para la confirmación
      *Ejemplo 1:
    Nombre del formulario:
      Solicitud de registro de vehiculo
   Lista de campos del formulario rellenados que mostraras al usuario:
     [
      {"name":"placa del vehiculo","description":"la placa que identifica al vehiculo","value":"2H182H"},
      {"name":"nombre completo","description":"nombre completo del usuario","value":"Marco Gomez Duran"},
      {"name":"precio del vehiculo","description":"precio estimado del vehiculo según el usuario","value":"20 000 soles"}
     ]
    Conversación:
      [
        {"assistant":"gracias por confiar en nosotros, necesito que me brinde su nombre completo"},
        {"user":"Marco Gomez Duran"},
        {"assistant":"Ok, ahora como ultimo dato, necesito la placa de su vehiculo"},
        {"user":"la placa es, 2H182H"}    
      ]
    Respuesta esperada:
    {
        "response": "Esta bien, registre todos los datos, los cuales son:
                  - Nombre completo: Marco Gomez Duran
                  - Placa de vehiculo: 2H182H
                  - Precio del vehiculo: 20 000 soles
                  ¿Los datos son correctos? o desea modificar alguno"
    }
    
    *Ejemplo 2:
    Nombre del formulario:
      Solicitud de prestamo
  Lista de campos del formulario rellenados que mostraras al usuario:
     [
      {"name":"nombre completo","description":"nombre completo del usuario","value":"Marco Gomez Duran"}
      {"name":"monto","description":"monto del prestamo que el usuario pide","value":"10 000 soles"}
     ]
    Conversación:
      [
        {"assistant":"cual es el monto que requiere para el prestamo?"},
        {"user":"deseo, 10 000 soles"},
        {"assistant":"ok, ahora necesito su nombre completo"},
        {"user":"es Marco Gomez Duran, pero modifica mi prestamo, quiero que sea de 20 000 soles"},
      ]
    Respuesta esperada:
    {
        "response":"Esta bien, modifique el prestamo que me indico, le informo que tengo los siguientes datos actualizados:
                    - Nombre completo: Marco Gomez Duran
                    - monto: 20 000 soles
                    ¿Esta satisfecho con los datos? o desea cambiar algun otro dato"
    }
      
    *Ejemplo 3:
    Nombre del formulario:
      Eliminación de cuenta
      Lista de campos del formulario rellenados que mostraras al usuario:
     [
      {"name":"nombre completo","description":"nombre completo del usuario","value":"Marco Gomez Dura"}
      {"name":"razon","description":"razon por la cual eliminara su cuenta","value":"ya no usa la cuenta"}
     ]
    Conversación:
      [
        {"assistant":"ok, ya registre su nombre, ahora digame porque quiere eliminar su cuenta?"},
        {"user":"es que ya no la uso"},
        {"assistant":"Listo, le informo que tengo los siguientes datos actualizados:
                      - Nombre completo: Marco Gomez Duran
                      - Razon : ya no usa la cuenta
                      ¿Esta satisfecho con los datos? o modificara algun dato"},
        {"user":"si, corrige mi nombre, es en realidad Marco Gomez Sanchez, ademas la verdarera razon por la que eliminare la cuenta es que no confio en ustedes"},

      ]
     Respuesta esperada:
        {
          "response": "Listo, actualize los datos que me dio, la información actualizada es:
                      - Nombre completo: Marco Gomez Sanchez
                      - Razon: No confia en la empresa
                      ¿Esta satisfecho con los datos? o desea cambiar algun otro dato"
        }
        `,
        `Analiza la siguiente información:
      Nombre del formulario:
      ${clientDB.formProcess}

      Lista de campos del formulario rellenados que mostraras al usuario:
      ${fieldsAll}

      Conversación:
      ${conversationString}`,
        true
      );
      chatbotMessage = JSON.parse(chatbotMessage).response;
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

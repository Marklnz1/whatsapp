require("dotenv").config();
const PORT = process.env.PORT || 4000;
const MONGODB_URL = process.env.MONGODB_URL;
const Client = require("./models/Client");
const Message = require("./models/Message");
const WhatsappAccount = require("./models/WhatsappAccount");
const SyncServer = require("./synchronization/SyncServer");
const whatsAppController = require("./controller/whatsAppController");
const Chat = require("./models/Chat");
const {
  sendWhatsappMessage,
  saveMedia,
  sendTemplateAndCreateDB,
  getTemplates,
} = require("./utils/server");
const mediaController = require("./controller/mediaController");
const MediaContent = require("./models/MediaContent");
const MediaPrompt = require("./models/MediaPrompt");
const mapLinkTemp = new Map();
const path = require("path");
const { v7: uuidv7 } = require("uuid");
const { createSearchIndex } = require("./synchronization/SyncMetadata");
const { default: axios } = require("axios");
const { inspect } = require("util");
const Broadcast = require("./models/Broadcast");
const MessageStatus = require("./models/MessageStatus");

const CLOUD_API_ACCESS_TOKEN = process.env.CLOUD_API_ACCESS_TOKEN;
const WA_BUSINESS_ACCOUNT_ID = process.env.WA_BUSINESS_ACCOUNT_ID;
const CLOUD_API_VERSION = process.env.CLOUD_API_VERSION;

SyncServer.init({
  port: PORT,
  mongoURL: MONGODB_URL,
  router: (app) => {
    app.get("/", (req, res) => {
      res.render("index");
    });
    app.get("/api/media/:name", mediaController.getMedia);
    app.get("/api/media/:name", mediaController.getMedia);
    app.post("/api/template/update/:id", async (req, res) => {
      try {
        console.log(
          "SE INTENTARA ENVIAR LA DATA ",
          inspect(req.body, true, 99),
          `https://graph.facebook.com/${CLOUD_API_VERSION}/${req.params.id}`
        );
        const response = await axios({
          data: req.body,
          method: "POST",
          url: `https://graph.facebook.com/${CLOUD_API_VERSION}/${req.params.id}`,
          headers: {
            Authorization: `Bearer ${CLOUD_API_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        });

        const io = res.locals.io;
        io.emit("templateChanged");

        res.json(response.data);
      } catch (error) {
        console.log("EL ERRORRRRR ", inspect(error.response.data, true, 99));
        if (error.response?.data?.error?.error_user_msg != null) {
          res.json({ error: error.response.data.error.error_user_msg });
        } else {
          res.json({ error: error.message });
        }
      }
    });
    app.delete("/api/template/delete", async (req, res, next) => {
      try {
        const response = await axios({
          data: req.body,
          method: "DELETE",
          url: `https://graph.facebook.com/${CLOUD_API_VERSION}/${WA_BUSINESS_ACCOUNT_ID}/message_templates?name=${req.query.name}`,
          headers: {
            Authorization: `Bearer ${CLOUD_API_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        });

        const io = res.locals.io;
        io.emit("templateChanged");

        res.json(response.data);
      } catch (error) {
        if (error.response?.data?.error?.error_user_msg != null) {
          res.json({ error: error.response.data.error.error_user_msg });
        } else {
          res.json({ error: error.message });
        }
      }
    });
    app.post("/api/template/create", async (req, res, next) => {
      try {
        const response = await axios({
          data: req.body,
          method: "POST",
          url: `https://graph.facebook.com/${CLOUD_API_VERSION}/${WA_BUSINESS_ACCOUNT_ID}/message_templates`,
          headers: {
            Authorization: `Bearer ${CLOUD_API_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        });
        const io = res.locals.io;
        io.emit("templateChanged");

        res.json(response.data);
      } catch (error) {
        console.log("se detecto error");
        if (error.response?.data?.error?.error_user_msg != null) {
          console.log(
            "SE DETECTO ERROR ",
            error.response.data.error.error_user_msg
          );

          res.json({ error: error.response.data.error.error_user_msg });
        } else {
          console.log("SE DETECTO ERROR2 ", error.message);

          res.json({ error: error.message });
        }
      }
    });
    app.get("/api/template/list", async (req, res, next) => {
      try {
        const queryString = req.originalUrl.split("?")[1] || "";
        const response = await getTemplates(
          WA_BUSINESS_ACCOUNT_ID,
          CLOUD_API_ACCESS_TOKEN,
          queryString
        );
        res.json(response);
      } catch (error) {
        console.log("se detecto error");
        if (error.response?.data != null) {
          console.log("SE DETECTO ERROR ", error.response.data);

          res.json({ error: error.response.data });
        } else {
          console.log("SE DETECTO ERROR2 ", error.message);

          res.json({ error: error.message });
        }
      }
    });

    app.post("/api/message/template/list", async (req, res, next) => {
      console.log("ENTRANDO A LA API TEMPLATE");
      try {
        const io = res.locals.io;
        const businessPhoneId = req.body["businessPhoneId"];
        const businessPhone = req.body["businessPhone"];
        const destinationDataList = req.body["destinationDataList"];
        const templateData = req.body["templateData"];

        const promises = [];
        for (const destinationData of destinationDataList) {
          promises.push(
            sendTemplateAndCreateDB(
              CLOUD_API_ACCESS_TOKEN,
              businessPhoneId,
              businessPhone,
              destinationData,
              templateData,
              io
            )
          );
        }
        const resp = await Promise.allSettled(promises);
        console.log("LA RESPUESTA ES ", resp);
        res.json({ message: "ok" });
      } catch (error) {
        res.json({ error });
      }
    });

    app.post("/api/media/:category/:type/:subtype", (req, res, next) => {
      saveMedia(
        req,
        () => {
          res.json({ message: "ok" });
        },
        () => {
          res.json({ error: "error" });
        }
      );
    });
    app
      .get("/whatsapp", whatsAppController.verifyToken)
      .post("/whatsapp", whatsAppController.receiveMessage);
    app.get("/api/temp/media/:name", (req, res) => {
      const mediaName = req.params.name;
      const timeLimit = mapLinkTemp.get(mediaName);
      const currentTime = new Date();

      // console.log("ENTRANDO NAME " + mediaName);
      // if (timeLimit) {
      //   if (currentTime < timeLimit) {
      const dirMain = process.cwd();
      const split = mediaName.split("_");
      const category = split[0];
      const type = split[1];

      const nameSplit = mediaName.split(".");
      const subtype = nameSplit[nameSplit.length - 1];

      const mediaPath = path.resolve(dirMain, category, mediaName);
      // const stat = fs.statSync(mediaPath);
      res.sendFile(mediaPath, {
        headers: {
          "Content-Type": `${type}/${subtype}`,
        },
      });

      // const fileSize = stat.size;
      // const head = {
      //   "Content-Length": fileSize,
      //   "Content-Type": "audio/ogg",
      // };
      // res.writeHead(200, head);
      // fs.createReadStream(mediaPath).pipe(res);
      // } else {
      //   mapLinkTemp.delete(mediaName);
      //   return res.json({ error: "404" });
      // }
      // } else {
      //   return res.json({ error: "404" });
      // }
    });
  },
});

SyncServer.syncPost({ model: WhatsappAccount, tableName: "whatsappAccount" });
SyncServer.syncPost({ model: MediaContent, tableName: "mediaContent" });
SyncServer.syncPost({ model: MediaPrompt, tableName: "mediaPrompt" });
SyncServer.syncPost({ model: Broadcast, tableName: "broadcast" });
SyncServer.syncPost({ model: MessageStatus, tableName: "messageStatus" });
let contadorEnvio = 0;
SyncServer.syncPost({
  model: Message,
  tableName: "message",
  onInsertPrevious: ({ insertableDocs }) => {
    for (const doc of insertableDocs) {
      if (doc["sentStatus"] == "not_sent" && doc["sent"] == "true") {
        doc["sentStatus"] = "send_requested";
      }
    }
  },
  onInsertAfter: async (responseDocs) => {
    const messages = [];
    for (const iDoc of responseDocs) {
      if (iDoc.doc.sent && iDoc.isNew) {
        messages.push(iDoc.doc);
      }
    }
    console.log("TODOS LOS MENSAJES", messages);
    const messagesWithoutTemplate = [];
    const clientSet = new Set();
    const chatSet = new Set();
    for (const message of messages) {
      const chatSplit = message.chat.split("_");
      const clientUuid = chatSplit[0];
      clientSet.add(clientUuid);
      chatSet.add(message.chat);
    }

    for (const client of clientSet) {
      await SyncServer.createOrGet("client", client, {
        wid: client,
      });
    }
    for (const chat of chatSet) {
      const chatSplit = chat.split("_");
      const clientUuid = chatSplit[0];
      const accountUuid = chatSplit[1];
      await SyncServer.createOrGet("chat", chat, {
        client: clientUuid,
        whatsappAccount: accountUuid,
        lastSeen: 0,
        chatbot: false,
      });
    }
    for (const message of messages) {
      if (message.templateName == null || message.templateName.trim() === "") {
        messagesWithoutTemplate.push(message);
        continue;
      }
      const chatSplit = message.chat.split("_");
      const clientUuid = chatSplit[0];
      const accountUuid = chatSplit[1];
      const templateData = JSON.parse(message.templateData);
      const parameters = [];
      for (const key of Object.keys(templateData)) {
        parameters.push({
          type: "text",
          parameter_name: key,
          text: templateData[key] ?? "",
        });
      }
      console.log(
        "SE ENVIARA CON LOS DATOS ",
        inspect(
          {
            name: message.templateName,
            language: { code: "es" },
            components: [{ type: "body", parameters }],
          },
          true,
          99
        )
      );
      // sendWhatsappMessage(
      //   CLOUD_API_ACCESS_TOKEN,
      //   accountUuid,
      //   clientUuid,
      //   "template",
      //   {
      //     name: message.templateName,
      //     language: { code: "es" },
      //     components: [{ type: "body", parameters }],
      //   },
      //   message.uuid
      // )
      //   .then((messageWid) => {
      //     SyncServer.updateFields("message", message.uuid, {
      //       wid: messageWid,
      //     });
      //   })
      //   .catch(async (reason) => {
      //     const errorData = reason.response.data.error;
      //     await SyncServer.updateFields("message", message.uuid, {
      //       sentStatus: "failed",
      //       errorDetails: errorData.message,
      //     });
      //     SyncServer.io.emit("serverChanged");

      //     await SyncServer.createOrGet("messageStatus", uuidv7(), {
      //       message: message.uuid,
      //       msgStatus: "failed",
      //       time: message.time,
      //       errorCode: errorData.code,
      //       errorTitle: errorData.type,
      //       errorMessage: errorData.message,
      //       errorDetails: errorData.message,
      //     });

      //     SyncServer.io.emit("serverChanged");
      //   });
      // console.log("SE OBTUVO EL WID " + messageWid);
    }
    console.log(
      "Mensajes sin sin template",
      messagesWithoutTemplate,
      contadorEnvio
    );
    for (const message of messagesWithoutTemplate) {
      if (!message.sent) {
        console.log("NO SE ENVIARA PORQUE ", message.sent);
        continue;
      }
      const chatSplit = message.chat.split("_");
      const clientUuid = chatSplit[0];
      const accountUuid = chatSplit[1];
      contadorEnvio++;
      if (contadorEnvio > 3) {
        return;
      }
      console.log("ENVIANDO");
      const messageWid = await sendWhatsappMessage(
        CLOUD_API_ACCESS_TOKEN,
        accountUuid,
        clientUuid,
        "text",
        {
          body: message.textContent,
        },
        message.uuid
      );
      console.log("SE OBTUVO EL WID " + messageWid);
      await SyncServer.updateFields("message", message.uuid, {
        wid: messageWid,
      });
    }
  },
});
SyncServer.syncPost({ model: Client, tableName: "client" });
SyncServer.syncPost({ model: Chat, tableName: "chat" });

SyncServer.start();

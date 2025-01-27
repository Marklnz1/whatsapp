require("dotenv").config();
const PORT = process.env.PORT || 4000;
const MONGODB_URL = process.env.MONGODB_URL;
const Client = require("./models/Client");
const Message = require("./models/Message");
const WhatsappAccount = require("./models/WhatsappAccount");
const { SyncServer } = require("./synchronization/SyncServer");
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

const CLOUD_API_ACCESS_TOKEN = process.env.CLOUD_API_ACCESS_TOKEN;
const WA_BUSINESS_ACCOUNT_ID = process.env.WA_BUSINESS_ACCOUNT_ID;
const CLOUD_API_VERSION = process.env.CLOUD_API_VERSION;

SyncServer.init({
  port: PORT,
  mongoURL: MONGODB_URL,
  router: (app) => {
    app.get("/", (req, res) => {
      res.json({ msg: "ok" });
    });
    app.get("/api/media/:name", mediaController.getMedia);
    app.get("/api/media/:name", mediaController.getMedia);
    app.post("/api/template/delete", async (req, res, next) => {
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
        const destinationPhones = req.body["destinationPhones"];
        const templateName = req.body["templateName"];
        const response = await getTemplates(
          WA_BUSINESS_ACCOUNT_ID,
          CLOUD_API_ACCESS_TOKEN,
          { name: templateName }
        );
        const promises = [];
        for (const phone of destinationPhones) {
          promises.push(
            sendTemplateAndCreateDB(
              CLOUD_API_ACCESS_TOKEN,
              businessPhoneId,
              businessPhone,
              phone,
              response.data[0],
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

SyncServer.syncPost({
  model: Message,
  tableName: "message",
  onInsertAfter: async (docs) => {
    for (const doc of docs) {
      if (doc.sent == "false") {
        continue;
      }
      const chat = await Chat.findOne({ uuid: doc.chat });
      const whatsappAccount = await WhatsappAccount.findOne({
        uuid: chat.whatsappAccount,
      });
      const client = await Client.findOne({ uuid: chat.client });
      const messageWid = await sendWhatsappMessage(
        CLOUD_API_ACCESS_TOKEN,
        whatsappAccount.businessPhoneId,
        client.wid,
        "text",
        {
          body: doc.textContent,
        },
        doc.uuid
      );
      // console.log("SE OBTUVO EL WID " + messageWid);
      await SyncServer.updateFields(Message, "message", doc.uuid, {
        wid: messageWid,
      });
    }
  },
});
SyncServer.syncPost({ model: Client, tableName: "client" });
SyncServer.syncPost({ model: Chat, tableName: "chat" });

SyncServer.start();

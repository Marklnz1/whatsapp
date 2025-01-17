require("dotenv").config();
const PORT = process.env.PORT || 4000;
const MONGODB_URL = process.env.MONGODB_URL;
const Client = require("./models/Client");
const Message = require("./models/Message");
const WhatsappAccount = require("./models/WhatsappAccount");
const { SyncServer } = require("./synchronization/SyncServer");
const whatsAppController = require("./controller/whatsAppController");
const Chat = require("./models/Chat");
const { sendWhatsappMessage, saveMedia } = require("./utils/server");
const mediaController = require("./controller/mediaController");
const MediaContent = require("./models/MediaContent");
const MediaPrompt = require("./models/MediaPrompt");
const mapLinkTemp = new Map();
const path = require("path");

const META_TOKEN = process.env.META_TOKEN;
SyncServer.init({
  port: PORT,
  mongoURL: MONGODB_URL,
  router: (app) => {
    app.get("/", (req, res) => {
      res.json({ msg: "ok" });
    });
    app.get("/api/media/:name", mediaController.getMedia);
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

SyncServer.syncPost(WhatsappAccount, "whatsappAccount");
SyncServer.syncPost(MediaContent, "mediaContent");
SyncServer.syncPost(MediaPrompt, "mediaPrompt");

SyncServer.syncPost(Message, "message", async (docs) => {
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
      META_TOKEN,
      whatsappAccount.businessPhoneId,
      client.wid,
      "text",
      {
        body: doc.textContent,
      },
      doc.uuid
    );
    console.log("SE OBTUVO EL WID " + messageWid);
    await SyncServer.updateFields(Message, "message", doc.uuid, {
      wid: messageWid,
    });
  }
});
SyncServer.syncPost(Client, "client");
SyncServer.syncPost(Chat, "chat");

SyncServer.start();

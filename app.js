require("dotenv").config();
const PORT = process.env.PORT || 4000;
const MONGODB_URL = process.env.MONGODB_URL;
const Client = require("./models/Client");
const Message = require("./models/Message");
const WhatsappAccount = require("./models/WhatsappAccount");
const { SyncServer } = require("./synchronization/SyncServer");
const whatsAppController = require("./controller/whatsAppController");
const Chat = require("./models/Chat");
const { sendWhatsappMessage } = require("./utils/server");
const mediaController = require("./controller/mediaController");

const META_TOKEN = process.env.META_TOKEN;
SyncServer.init({
  port: PORT,
  mongoURL: MONGODB_URL,
  router: (app) => {
    app.get("/", (req, res) => {
      res.json({ msg: "ok" });
    });
    app.get("/api/media/:name", mediaController.getMedia);
    app
      .get("/whatsapp", whatsAppController.verifyToken)
      .post("/whatsapp", whatsAppController.receiveMessage);
  },
});

SyncServer.syncPost(WhatsappAccount, "whatsappAccount");
SyncServer.syncPost(Message, "message", async (docs) => {
  for (const doc of docs) {
    if (doc.sent == "false") {
      continue;
    }
    const chat = await Chat.findOne({ uuid: doc.chat });
    const whatsappAccount = await WhatsappAccount.findOne({
      businessPhone: chat.businessPhone,
    });
    const messageWid = await sendWhatsappMessage(
      META_TOKEN,
      whatsappAccount.businessPhoneId,
      chat.clientWid,
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

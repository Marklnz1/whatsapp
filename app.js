require("dotenv").config();
const PORT = process.env.PORT || 4000;
const MONGODB_URL = process.env.MONGODB_URL;
const Client = require("./models/Client");
const Message = require("./models/Message");
const WhatsappAccount = require("./models/WhatsappAccount");
const { SyncServer } = require("./synchronization/SyncServer");
const whatsAppController = require("./controller/whatsAppController");
const Chat = require("./models/Chat");

SyncServer.init({
  port: PORT,
  mongoURL: MONGODB_URL,
  router: (app) => {
    app
      .get("/whatsapp", whatsAppController.verifyToken)
      .post("/whatsapp", whatsAppController.receiveMessage);
  },
});

SyncServer.syncPost(WhatsappAccount, "whatsappAccount");
SyncServer.syncPost(Message, "message");
SyncServer.syncPost(Client, "client");
SyncServer.syncPost(Chat, "chat");

SyncServer.start();

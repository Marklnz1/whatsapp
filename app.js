require("dotenv").config();
const PORT = process.env.PORT || 4000;
const MONGODB_URL = process.env.MONGODB_URL;
const { Chat } = require("groq-sdk/resources/index.mjs");
const Client = require("./models/Client");
const Message = require("./models/Message");
const WhatsappAccount = require("./models/WhatsappAccount");
const SyncServer = require("./synchronization/SyncServer");
const syncServer = new SyncServer({ port: PORT, mongoURL: MONGODB_URL });

syncServer.syncPost(WhatsappAccount, "whatsappAccount");
syncServer.syncPost(Message, "message");
syncServer.syncPost(Client, "client");
syncServer.syncPost(Chat, "chat");

syncServer.start();

module.exports.syncServer = syncServer;

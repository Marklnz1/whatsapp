const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const http = require("http");

const httpProxy = require("http-proxy");
const proxy = httpProxy.createProxyServer({ secure: false });
const app = express();
const PORT = process.env.PORT || 4000;
const MONGODB_URL = process.env.MONGODB_URL;
const util = require("util");
const whatsAppController = require("./controller/whatsAppController");
const { Server } = require("socket.io");
const server = http.createServer(app);
const mediaController = require("./controller/mediaController");
const formController = require("./controller/conversationalFormController");

const socketController = require("./controller/socketController");
const messageController = require("./controller/messageController");
const META_TOKEN = process.env.META_TOKEN;

const SERVER_SAVE = process.env.SERVER_SAVE;
const SERVER_SAVE_TOKEN = process.env.SERVER_SAVE_TOKEN;
const mapLinkTemp = new Map();
const path = require("path");
const fs = require("fs");
const SyncMetadata = require("./models/SyncMetadata");
const { list_sync, update_list_sync, update_fields } = require("./utils/sync");
const Client = require("./models/Client");
const Message = require("./models/Message");
const WhatsappAccount = require("./models/WWhatsappAccount");
const { sendWhatsappMessage } = require("./utils/server");
const Chat = require("./models/Chat");

const io = new Server(
  server
  //   {
  //   cors: {
  //     origin: "*",
  //   },
  // }
);
app.use(express.json({ limit: "50mb" }));
// app.use(express.urlencoded({ limit: "50mb", extended: true }));
// const cors = require("cors");
// app.use(cors());
// app.options("/", (req, res) => {
//   console.log("CULPA DEL CORS?????????????????");
//   res.send();
// });
//===========================================
io.on("connection", (socket) => {
  console.log("Cliente conectado");
  socket.on("setChatbotState", socketController.setChatbotState);
  socket.on("readAll", socketController.readAll);
  socket.on("getMessages", (data) => socketController.getMessages(data, io));
  socket.on("getChats", (data) => socketController.getChats(data, io));
  socket.on("disconnect", () => {
    console.log("Cliente desconectado");
  });
});
//======================================================
app.use(express.static("public"));
app.use(express.json());
// app.use(cookieParser());
app.use((req, res, next) => {
  res.locals.io = io;
  res.locals.mapLinkTemp = mapLinkTemp;

  next();
});
app.set("view engine", "ejs");
app.set("view engine", "html");
app.engine("html", require("ejs").renderFile);

app.get("/", (req, res) => {
  res.render("index");
});
app.post("/verify", async (req, res) => {
  const tableNames = req.body.tableNames;
  let syncMetadataList = await SyncMetadata.find({
    tableName: { $in: tableNames },
  });
  const foundNames = syncMetadataList.map(
    (syncMetadata) => syncMetadata.tableName
  );
  const notFoundNames = tableNames.filter(
    (tableName) => !foundNames.includes(tableName)
  );

  if (notFoundNames) {
    const newSyncMetadataList = await SyncMetadata.insertMany(
      notFoundNames.map((tableName) => ({
        tableName: tableName,
      }))
    );
    syncMetadataList = syncMetadataList.concat(newSyncMetadataList);
  }

  const syncMetadataMap = Object.fromEntries(
    syncMetadataList.map((syncMetadata) => [
      syncMetadata.tableName,
      syncMetadata.syncCodeMax,
    ])
  );
  res.json(syncMetadataMap);
});
app.post("/message/list/sync", (req, res, next) =>
  list_sync(Message, req, res, next)
);

app.post("/client/list/sync", (req, res, next) =>
  list_sync(Client, req, res, next)
);
app.post("/client/update/list/sync", (req, res, next) =>
  update_list_sync(Client, "client", req, res, next)
);

app.post("/chat/list/sync", (req, res, next) =>
  list_sync(Chat, req, res, next)
);
app.post("/chat/update/list/sync", (req, res, next) =>
  update_list_sync(Chat, "chat", req, res, next)
);

app.post("/whatsappAccount/list/sync", (req, res, next) =>
  list_sync(WhatsappAccount, req, res, next)
);
app.post("/whatsappAccount/update/list/sync", (req, res, next) =>
  update_list_sync(WhatsappAccount, "whatsappAccount", req, res, next)
);

app.post("/message/update/list/sync", (req, res, next) =>
  update_list_sync(Message, "message", req, res, next, async (doc) => {
    // console.log("INGRESANDO PARA ENVIAR " + util.inspect(doc));
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
    await update_fields(
      Message,
      "message",
      { uuid: doc.uuid },
      { wid: messageWid }
    );
  })
);
app.get("/whatsapp-api", (req, res) => {
  res.render("whatsapp-api/index");
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
  const subtype = split[2];
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
app.post("/api/message/location", messageController.sendLocationMessage);
app.get("/api/media/:name", mediaController.getMedia);
app.post("/api/message/read", messageController.readMessage);
app.post("/api/message/read/all", messageController.readAllMessage);
app.post(
  "/api/message/media/:category/:type/:subtype",
  messageController.sendMediaMessage
);

app.post("/api/message/text/", messageController.sendTextMessage);

// app.post("/api/form/", formController.postForm);

async function start() {
  await mongoose.connect(MONGODB_URL, {
    autoIndex: true,
    maxPoolSize: 50,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
  });

  server.listen(PORT, () => {
    console.log("SERVER ACTIVO: PUERTO USADO :" + PORT);
  });
}

start();

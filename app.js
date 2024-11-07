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

const socketController = require("./controller/socketController");
const messageController = require("./controller/messageController");
const SERVER_SAVE = process.env.SERVER_SAVE;
const SERVER_SAVE_TOKEN = process.env.SERVER_SAVE_TOKEN;
const mapLinkTemp = new Map();
const path = require("path");
const fs = require("fs");

const io = new Server(server);

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
  const mediaType = mediaName.split("_")[0];
  const mediaPath = path.resolve(dirMain, mediaType, mediaName);
  const stat = fs.statSync(mediaPath);
  const fileSize = stat.size;
  const head = {
    "Content-Length": fileSize,
    // "Content-Type": "audio/ogg; codecs=opus",
  };
  res.writeHead(200, head);
  fs.createReadStream(mediaPath).pipe(res);
  // } else {
  //   mapLinkTemp.delete(mediaName);
  //   return res.json({ error: "404" });
  // }
  // } else {
  //   return res.json({ error: "404" });
  // }
});
app.get("/api/media/:name", mediaController.getMedia);
app.post("/api/message/read", messageController.readMessage);
app.post("/api/message/read/all", messageController.readAllMessage);
app.post("/api/message/media/:category", messageController.sendMediaMessage);
app.post("/api/message/text/", messageController.sendTextMessage);
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

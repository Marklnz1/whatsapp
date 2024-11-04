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
const socketController = require("./controller/socketController");
const messageController = require("./controller/messageController");
const SERVER_SAVE = process.env.SERVER_SAVE;
const SERVER_SAVE_TOKEN = process.env.SERVER_SAVE_TOKEN;

const io = new Server(server);

app.use(express.json({ limit: "50mb" }));
// app.use(express.urlencoded({ limit: "50mb", extended: true }));
const cors = require("cors");
app.use(cors());

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
  next();
});

app.set("view engine", "ejs");
app.set("view engine", "html");
app.engine("html", require("ejs").renderFile);

app.get("/", (req, res) => {
  res.render("index");
});
app.get("/api/media/:name", async (req, res) => {
  req.headers["authorization"] = `Bearer ${SERVER_SAVE_TOKEN}`;
  proxy.web(req, res, { target: `https://${SERVER_SAVE}/` });
});
app.get("/api/temp/media/:name", async (req, res) => {
  proxy.web(req, res, { target: `https://${SERVER_SAVE}/` });
});
app
  .get("/whatsapp", whatsAppController.verifyToken)
  .post("/whatsapp", whatsAppController.receiveMessage);

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
app.post("/api/message/read", messageController.readMessage);
app.post("/api/message/read/all", messageController.readAllMessage);
app.post("/api/message/media/:category", messageController.sendMediaMessage);
app.post("/api/message/text/", messageController.sendTextMessage);

start();

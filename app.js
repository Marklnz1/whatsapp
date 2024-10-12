const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const http = require("http");
const app = express();
const PORT = process.env.PORT || 4000;
const MONGODB_URL = process.env.MONGODB_URL;

const whatsAppController = require("./controller/whatsAppController");
const { Server } = require("socket.io");
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});
const Client = require("./models/Client");
//===========================================
io.on("connection", (socket) => {
  console.log("Cliente conectado");
  socket.on("sendMessage", async (data) => {
    const { clientId, msg, lid } = JSON.parse(data);
    const client = await Client.findById(clientId);
    for (let m of client.messages) {
      m.read = true;
    }
    const messageDB = {
      msg: msg,
      time: new Date(),
      sent: true,
      read: true,
    };
    client.messages.push(messageDB);
    await client.save();
    const lastMessage = client.messages[client.messages.length - 1];
    const savedMessage = { ...lastMessage };
    savedMessage.lid = lid;
    savedMessage._id = lastMessage._id;
    io.emit(
      "sendMessage",
      JSON.stringify({
        clientId,
        message: savedMessage,
      })
    );
  });
  socket.on("setChatbotState", async (data) => {
    const { clientId, value } = JSON.parse(data);
    const client = await Client.findById(clientId);
    client.chatbot = value;
    await client.save();
  });
  socket.on("readAll", async (clientId) => {
    const client = await Client.findById(clientId);
    for (let m of client.messages) {
      m.read = true;
    }
    await client.save();
  });
  socket.on("getMessages", async (data) => {
    const { clientId, readAll } = JSON.parse(data);
    const client = await Client.findById(clientId);
    if (readAll) {
      for (let m of client.messages) {
        m.read = true;
      }
      await client.save();
    }
    io.emit(
      "getMessages",
      JSON.stringify({
        _id: clientId,
        messages: client.messages,
      })
    );
  });
  socket.on("getChats", async () => {
    const clients = await Client.aggregate([
      {
        $project: {
          _id: 1,
          contact: 1,
          chatbot: 1,
          messages: {
            $slice: [
              {
                $sortArray: {
                  input: "$messages",
                  sortBy: { time: -1 },
                },
              },
              1,
            ],
          },
        },
      },
    ]).exec();

    io.emit(
      "getChats",
      JSON.stringify({
        clients,
      })
    );
  });

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
// app.get("/createData", async (req, res) => {
//   let client = new Client({ wid: "1", contact: "Pablo Santos" });
//   await client.save();
//   client = new Client({ wid: "2", contact: "Jorge Bud" });
//   await client.save();
//   client = new Client({ wid: "3", contact: "Carlos de la Torre" });
//   await client.save();
//   res.sendStatus(200);
// });
app.get("/", (req, res) => {
  res.render("index");
});

// app.get("/newMessage", async (req, res) => {
//   const numeroAleatorio = Math.floor(Math.random() * 1000) + 1;
//   const message = {
//     msg: "new message " + numeroAleatorio,
//     time: new Date(),
//     sent: false,
//     read: false,
//     chatbot: true,
//   };

//   res.sendStatus(200);
// });
// {
//   base64Profile: String,
//   contact: String,
//   msg: String,
//   time: String,
//   unreadMsgs: Number,
//   messages: [MessageSchema],
// }
// app.post("/message", (req, res) => {
//   if (
//     !(
//       body_param.object &&
//       body_param.entry &&
//       body_param.entry[0].changes &&
//       body_param.entry[0].changes[0].value.messages &&
//       body_param.entry[0].changes[0].value.messages[0]
//     )
//   ) {
//     res.sendStatus(404);
//     return;
//   }
//   const value = body_param.entry[0].changes[0].value;
//   const phon_no_id = value.metadata.phone_number_id;
//   const msg_body = value.messages[0].text.body;
//   const from = value.messages[0].from;

//   const data = req.body;
//   const clientDB = Client.find();
// });

app.get("/chats", (req, res) => {
  res.json([
    {
      contact: "Pepe Salaszzz",
      msg: "hola manco",
      time: "tiempo",
      unreadMsgs: "99",
      messages: [
        { msg: "hola man", time: "xd", sent: false },
        { msg: "asadasd man", time: "xd", sent: false },
      ],
    },
    {
      contact: "Carlos Salas",
      msg: "hola holaaaaaaaaasdas dasd ",
      time: "tiempo2",
      unreadMsgs: "9229",
      messages: [
        { msg: "hoasdas n", time: "xdas", sent: false },
        { msg: "7777777777777n", time: "xas", sent: false },
      ],
    },
  ]);
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
start();

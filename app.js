const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const http = require("http");
const https = require("https");
const httpProxy = require("http-proxy");
const proxy = httpProxy.createProxyServer({ secure: false });
const app = express();
const PORT = process.env.PORT || 4000;
const MONGODB_URL = process.env.MONGODB_URL;
const util = require("util");
const whatsAppController = require("./controller/whatsAppController");
const { Server } = require("socket.io");
const server = http.createServer(app);
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const busboy = require("busboy");
const FormData = require("form-data");
const ffmpegStatic = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");

// Tell fluent-ffmpeg where it can find FFmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);
const PHONE_ID = process.env.PHONE_ID;
const META_TOKEN = process.env.META_TOKEN;
const SERVER_SAVE = process.env.SERVER_SAVE;
const SERVER_SAVE_TOKEN = process.env.SERVER_SAVE_TOKEN;
const agent = new https.Agent({
  rejectUnauthorized: false,
});

const io = new Server(server, {
  // path: "/socket.io",
  // cors: {
  //   origin: "*",
  // },
});

app.use(express.json({ limit: "50mb" }));
// app.use(express.urlencoded({ limit: "50mb", extended: true }));
const cors = require("cors");
app.use(cors());
const Client = require("./models/Client");
const { FORMERR } = require("dns");
//===========================================
io.on("connection", (socket) => {
  console.log("Cliente conectado");
  socket.on("sendMessage", async (data) => {
    const { clientId, msg, lid } = JSON.parse(data);
    const client = await Client.findById(clientId);
    for (let m of client.messages) {
      m.read = true;
    }
    client.chatbot = false;
    const messageDB = {
      sentStatus: 1,
      msg: msg,
      time: new Date(),
      sent: true,
      read: true,
    };
    client.messages.push(messageDB);
    await client.save();
    //========================================
    const lastMessage = client.messages[client.messages.length - 1];

    const savedMessage = { ...lastMessage };
    savedMessage.lid = lid;
    savedMessage._id = lastMessage._id;
    //==============================================================
    const from = client.wid;
    const reponse = await axios({
      method: "POST",
      url: "https://graph.facebook.com/v20.0/" + PHONE_ID + "/messages",
      data: {
        messaging_product: "whatsapp",
        to: from,
        text: {
          body: msg,
        },
      },
      headers: {
        Authorization: `Bearer ${META_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    lastMessage.sentStatus = 2;
    lastMessage.wid = reponse.data.messages[0].id;
    await client.save();
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
    console.log("readAll active");
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
      console.log("READ ALL IN GETMESSAGES");
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
    // const response = await axios({
    //   method: "GET",
    //   url: `https://${SERVER_SAVE}/token`,
    //   params: {
    //     days: 2,
    //   },
    //   headers: {
    //     Authorization: `Bearer ${SERVER_SAVE_TOKEN}`,
    //   },
    //   httpsAgent: agent,
    // });
    // const token_media = response.data.token;
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
        // token_media,
        // server_media: SERVER_SAVE,
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
app.get("/api/media/:name", async (req, res) => {
  req.headers["authorization"] = `Bearer ${SERVER_SAVE_TOKEN}`;
  proxy.web(req, res, { target: `https://${SERVER_SAVE}/` });
});

app.post("/api/media/", (req, res) => {
  const bb = busboy({
    headers: req.headers,
    limits: { fileSize: 50 * 1024 * 1024 },
  }); // 50 MB
  let responded = false; // Bandera para evitar múltiples respuestas

  bb.on("file", (name, file, info) => {
    const { filename, encoding, mimeType } = info;

    const saveTo = path.join("", `${Date.now()}-${filename}`);
    const writeStream = fs.createWriteStream(saveTo);
    file.pipe(writeStream);

    file.on("limit", () => {
      if (!responded) {
        responded = true;
        res.status(413).send("Archivo demasiado grande");
        writeStream.destroy(); // Detiene la escritura en el archivo
        fs.unlinkSync(saveTo); // Elimina el archivo incompleto
      }
    });
  });

  bb.on("finish", () => {
    if (!responded) {
      responded = true;
      res.status(200).send("Archivos subidos exitosamente");
    }
  });

  bb.on("error", (error) => {
    if (!responded) {
      responded = true;
      res.status(500).send("Error al subir los archivos");
    }
  });

  req.pipe(bb);
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
app.post("/api/prueba/", (req, res) => {
  console.log("ENTRANDOOOOOOOOOO");
  const bb = busboy({
    headers: req.headers,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  });
  let responded = false; // Bandera para evitar múltiples respuestas
  const fields = {};
  const mediaList = [];

  bb.on("file", (name, file, info) => {
    console.log("filee " + file);
    const { filename, encoding, mimeType } = info;
    const saveTo = path.join("", `${Date.now()}-${filename}`);
    const writeStream = fs.createWriteStream(saveTo);
    file.pipe(writeStream);

    const index = mediaList.length;

    mediaList.push({ path: saveTo, index, mimeType });

    file.on("limit", () => {
      if (!responded) {
        responded = true;
        res.status(413).send("Archivo demasiado grande");
        writeStream.destroy(); // Detiene la escritura en el archivo
        fs.unlinkSync(saveTo); // Elimina el archivo incompleto
      }
    });
  });

  bb.on("field", (name, val) => {
    console.log("fields[" + name + "] = " + val);
    fields[name] = val;
  });

  bb.on("finish", async () => {
    if (!responded) {
      for (let m of mediaList) {
        m.message = fields["message" + m.index];
        m.category = fields["category" + m.index];
      }
      const { clientId } = fields;
      // const data = {
      //   clientId,
      //   files: mediaList,
      // };

      // console.log("Received data:", data);
      const client = await Client.findById(clientId);

      for (let m of mediaList) {
        const form = new FormData();
        form.append("file", fs.createReadStream(m.path), {
          contentType: m.mimeType,
        });
        form.append("messaging_product", "whatsapp");
        // await compressVideo(f.path, "nuevo archivo");

        let response = await axios.post(
          `https://graph.facebook.com/v21.0/${PHONE_ID}/media`,
          form,
          {
            headers: {
              Authorization: `Bearer ${META_TOKEN}`,
              ...form.getHeaders(),
            },
          }
        );
        const mediaId = response.data.id;
        console.log("MEDIAid " + mediaId);
        // const data = {
        //   messaging_product: "whatsapp",
        //   recipient_type: "individual",
        //   to: client.wid,
        //   type: m.category,
        // };
        // data[m.category] = {
        //   id: mediaId,
        //   caption: m.message,
        // };
        // response = await axios({
        //   method: "POST",
        //   url: "https://graph.facebook.com/v20.0/" + PHONE_ID + "/messages",
        //   data,
        //   headers: {
        //     Authorization: `Bearer ${META_TOKEN}`,
        //     "Content-Type": "application/json",
        //   },
        // });
        // console.log(
        //   "response final post " + util.inspect(response.data, true, 99)
        // );
      }
      res.status(200).send("Archivos subidos exitosamente");
    }
  });

  bb.on("error", (error) => {
    if (!responded) {
      responded = true;
      res.status(500).send("Error al subir los archivos");
    }
  });

  req.pipe(bb);
});
function compressVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(__dirname, inputPath))
      .saveToFile("audio.mp4")
      .videoCodec("libx264") // Usar H.264 para video
      .audioCodec("aac") // Usar AAC para audio
      .outputOptions(
        "-ab",
        "192k",
        "-preset",
        "slow", // Preset rápido pero con buena calidad
        "-crf",
        "28" // Factor de calidad (28 es buena para compresión rápida)
        // "-movflags",
        // "+faststart" // Optimiza para reproducción progresiva
      )
      .on("end", () => {
        console.log(`Compresión finalizada: ${outputPath}`);
        resolve();
      })
      .on("error", (err) => {
        console.error("Error durante la compresión:", err);
        reject(err);
      })
      .run();
  });

  // ffmpeg()
  //   // Input file
  //   .input(path.join(__dirname, inputPath))

  //   // Audio bit rate
  //   .outputOptions("-ab", "192k")

  //   // Output file
  //   .saveToFile("audio.mp3")

  //   // Log the percentage of work completed
  //   .on("progress", (progress) => {
  //     if (progress.percent) {
  //       console.log(`Processing: ${Math.floor(progress.percent)}% done`);
  //     }
  //   })

  //   // The callback that is run when FFmpeg is finished
  //   .on("end", () => {
  //     console.log("FFmpeg has finished.");
  //   })

  //   // The callback that is run when FFmpeg encountered an error
  //   .on("error", (error) => {
  //     console.error(error);
  //   });
}
start();

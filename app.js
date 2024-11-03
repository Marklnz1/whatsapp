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
const mime = require("mime-types");

// Tell fluent-ffmpeg where it can find FFmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);
const PHONE_ID = process.env.PHONE_ID;
const BUSINESS_PHONE = process.env.BUSINESS_PHONE;

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
const Message = require("./models/Message");
const { sendWhatsappMessage } = require("./utils/server");
//===========================================
io.on("connection", (socket) => {
  console.log("Cliente conectado");
  socket.on("sendMessage", async (data) => {
    const { clientId, text, lid, businessPhone, businessPhoneId } =
      JSON.parse(data);
    const client = await Client.findById(clientId);
    client.chatbot = false;
    await client.save();

    await Message.updateMany({ client: clientId }, { $set: { read: true } });

    const newMessage = new Message({
      client: clientId,
      wid: null,
      text,
      sent: true,
      time: new Date(),
      type: "text",
      businessPhone,
      sentStatus: "not_sent",
    });
    await newMessage.save();

    const messageId = await sendWhatsappMessage(
      META_TOKEN,
      businessPhoneId,
      client.wid,
      "text",
      {
        body: text,
      }
    );
    newMessage.wid = messageId;
    newMessage.sentStatus = "send_requested";
    await newMessage.save();
    //========================================
    const savedMessage = { ...newMessage };
    savedMessage.lid = lid;

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
    const messages = await Message.find({ client: clientId }).lean().exec();

    if (readAll) {
      await Message.updateMany({ client: clientId }, { $set: { read: true } });
    }
    io.emit(
      "getMessages",
      JSON.stringify({
        _id: clientId,
        messages,
      })
    );
  });
  socket.on("getChats", async () => {
    const clients = await Client.aggregate([
      {
        $lookup: {
          from: "message",
          let: { clientId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$client", "$$clientId"] },
              },
            },
            {
              $sort: { time: -1 },
            },
            {
              $limit: 1,
            },
          ],
          as: "messages",
        },
      },
    ]).exec();

    io.emit(
      "getChats",
      JSON.stringify({
        clients,
        businessProfiles: [
          { businessPhone: BUSINESS_PHONE, businessPhoneId: PHONE_ID },
        ],
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

app.post("/api/message/media/:category", (req, res) => {
  const category = req.params.category;
  // Definir límite en bytes (ejemplo: 5MB = 5 * 1024 * 1024 bytes)
  const TAMAÑO_MAXIMO = 100 * 1024 * 1024;
  const bb = busboy({
    headers: req.headers,
    limits: {
      fileSize: TAMAÑO_MAXIMO, // Límite en bytes
    },
  });

  let fileBuffer = null;
  let fileName = "";
  let fileType = "";
  let excedioLimite = false;
  const fields = [];
  bb.on("file", (name, file, info) => {
    // console.log("filee " + file);
    const { filename, encoding, mimeType } = info;
    const chunks = [];

    fileName = filename;
    fileType = mimeType;

    // Verificar tamaño mientras se reciben los chunks
    file.on("data", (chunk) => {
      chunks.push(chunk);
    });

    file.on("end", () => {
      if (!excedioLimite) {
        fileBuffer = Buffer.concat(chunks);
      }
    });

    // Manejar error de límite excedido
    file.on("limit", () => {
      excedioLimite = true;
      // res.status(413).json({ error: "Archivo excede el límite permitido" });
    });
  });
  bb.on("field", (name, val) => {
    fields[name] = val;
  });
  bb.on("finish", async () => {
    if (excedioLimite) {
      res.status(413).json({ error: "Archivo excede el límite permitido" });
      return; // No hacer nada si ya se envió respuesta de error
    }

    // Proceder con el envío si el archivo está dentro del límite
    const axios = require("axios");

    // const formData = new FormData();
    // const file = new File([fileBuffer], "", { type: fileType });
    var formData = {
      name: "files",
      file: {
        value: fileBuffer,
        options: {
          //  filename: 'elemento1.pdf',
          contentType: fileType,
        },
      },
    };
    console.log("MI MIMETYPE ES " + fileType);
    let response = await axios.post(
      `https://${SERVER_SAVE}/api/temp/media/${category}`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        httpsAgent: agent,
      }
    );
    const metadata = response.data;
    metadata.extension = mime.extension(fileType);
    metadata.mimeType = fileType;
    metadata.metaFileName = fileName;
    console.log("FILENAME ES  " + fileName);
    //post a meta para enviar mensaje con el link temporal https://${SERVER_SAVE}/api/temp/media/${savedFileName}
    // console.log(util.inspect(metadata));
    let link = `https://chatw-hr0g.onrender.com/api/media/${metadata.savedFileName}`;

    const caption = fields["message"] ?? null;
    const businessPhoneId = fields["businessPhoneId"];
    const businessPhone = fields["businessPhone"];
    const dstPhone = fields["dstPhone"];
    const newMessage = new Message({
      client: fields["clientId"],
      wid: null,
      text: caption,
      sent: true,
      time: new Date(),
      type: category,
      businessPhone,
      sentStatus: "not_sent",
      ...metadata,
    });
    await newMessage.save();
    console.log("El link es " + link);
    console.log("la categoria es " + category);
    const messageData = { link };
    if (category != "audio" && category != "sticker") {
      messageData.caption = caption;
    }
    if (category == "document") {
      messageData.filename = fileName;
    }
    const messageId = await sendWhatsappMessage(
      META_TOKEN,
      businessPhoneId,
      dstPhone,
      category,
      messageData
    );
    newMessage.sentStatus = "send_requested";
    newMessage.wid = messageId;
    await newMessage.save();
  });
  // console.log("mensaje id");

  // Manejar errores generales de Busboy
  bb.on("error", (err) => {
    res.status(500).json({ error: "Error al procesar el archivo" });
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

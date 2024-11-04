const busboy = require("busboy");
const Client = require("../models/Client");
const Message = require("../models/Message");
const { sendWhatsappMessage } = require("../utils/server");
const { default: axios } = require("axios");
const META_TOKEN = process.env.META_TOKEN;
const SERVER_SAVE = process.env.SERVER_SAVE;
const SERVER_SAVE_TOKEN = process.env.SERVER_SAVE_TOKEN;
const https = require("https");
const mime = require("mime-types");
const messagesSet = new Set();
const agent = new https.Agent({
  rejectUnauthorized: false,
});
module.exports.readMessage = async (req, res) => {
  const { messageId } = req.body;
  await Message.findByIdAndUpdate(messageId, { read: true });
};
module.exports.readAllMessage = async (req, res) => {
  const { clientId } = req.body;
  await Message.updateMany(
    { clientId: clientId, read: false },
    { $set: { read: true } }
  );
};
module.exports.sendTextMessage = async (req, res) => {
  try {
    const { clientId, text, uuid, businessPhone, businessPhoneId } = req.body;
    if (messagesSet.has(uuid)) {
      messagesSet.delete(uuid);
      return res.status(200).json({ error: "Solicitud duplicada" });
    }
    messagesSet.add(uuid);
    const client = await Client.findById(clientId);
    client.chatbot = false;
    await client.save();

    await Message.updateMany({ client: clientId }, { $set: { read: true } });

    const newMessage = new Message({
      client: clientId,
      wid: null,
      uuid,
      text,
      sent: true,
      read: true,
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

    res.sendStatus(200);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports.sendMediaMessage = (req, res) => {
  console.log(
    "RECIBIENDO SOLICITUD DE ENVIOOOOOOOOO =========================== MEDIAAAAAAAAAAAAAAAAA"
  );
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
    console.log("LEYENDO FILES");
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
    const messageUuid = fields["messageUuid"];
    if (messagesSet.has(messageUuid)) {
      messagesSet.delete(messageUuid);
      return res.status(200).json({ error: "Solicitud duplicada" });
    }
    messagesSet.add(messageUuid);

    if (excedioLimite) {
      res.status(413).json({ error: "Archivo excede el límite permitido" });
      return; // No hacer nada si ya se envió respuesta de error
    }
    const caption = fields["message"] ?? null;
    const businessPhoneId = fields["businessPhoneId"];
    const businessPhone = fields["businessPhone"];
    const dstPhone = fields["dstPhone"];
    console.log("ENTRANDOOOOOOOOO222222S");
    // Proceder con el envío si el archivo está dentro del límite

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
    let response;

    response = await axios.post(
      `https://${SERVER_SAVE}/api/business/media/${category}`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${SERVER_SAVE_TOKEN}`,
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
    let link = `https://chatw-hr0g.onrender.com/api/temp/media/${metadata.savedFileName}`;

    const newMessage = new Message({
      client: fields["clientId"],
      wid: null,
      uuid: messageUuid,
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
    console.log("ID DEL MENSAJE CREADO => " + newMessage._id);
    const messageId = await sendWhatsappMessage(
      META_TOKEN,
      businessPhoneId,
      dstPhone,
      category,
      messageData,
      newMessage._id
    );
    newMessage.sentStatus = "send_requested";
    newMessage.wid = messageId;
    await newMessage.save();

    res.sendStatus(200);
  });

  bb.on("error", (err) => {
    res.status(500).json({ error: "Error al procesar el archivo" });
  });

  req.pipe(bb);
};

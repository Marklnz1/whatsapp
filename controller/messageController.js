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
  const { clientId, text, uuid, businessPhone, businessPhoneId } = req.body;
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
};

module.exports.sendMediaMessage = (req, res) => {
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
    let link = `https://chatw-hr0g.onrender.com/api/media/${metadata.savedFileName}`;

    const caption = fields["message"] ?? null;
    const businessPhoneId = fields["businessPhoneId"];
    const businessPhone = fields["businessPhone"];
    const dstPhone = fields["dstPhone"];
    const messageUuid = fields["messageUuid"];
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
    // const messageId = await sendWhatsappMessage(
    //   META_TOKEN,
    //   businessPhoneId,
    //   dstPhone,
    //   category,
    //   messageData
    // );
    // newMessage.sentStatus = "send_requested";
    // newMessage.wid = messageId;
    // await newMessage.save();
  });
  // console.log("mensaje id");

  // Manejar errores generales de Busboy
  bb.on("error", (err) => {
    res.status(500).json({ error: "Error al procesar el archivo" });
  });

  req.pipe(bb);
};

const busboy = require("busboy");
const Client = require("../models/Client");
const Message = require("../models/Message");
const { sendWhatsappMessage, saveMediaBusiness } = require("../utils/server");
const { default: axios } = require("axios");
const META_TOKEN = process.env.META_TOKEN;
const SERVER_SAVE = process.env.SERVER_SAVE;
const DOMAIN = process.env.DOMAIN;

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
    console.log("ID DEL MENSAJE CREADO => " + newMessage._id);

    const messageId = await sendWhatsappMessage(
      META_TOKEN,
      businessPhoneId,
      client.wid,
      "text",
      {
        body: text,
      },
      newMessage._id
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
  saveMediaBusiness(
    req,
    async (orgFilename, savedFileName, fields) => {
      const uuid = fields.uuid;
      if (messagesSet.has(uuid)) {
        messagesSet.delete(uuid);
        return res.status(200).json({ error: "Solicitud duplicada" });
      }
      messagesSet.add(uuid);

      const now = new Date();
      const limiteMinutes = 5;
      const futureTime = new Date(now.getTime() + limiteMinutes * 60 * 1000);
      const mapLinkTemp = res.locals.mapLinkTemp;
      mapLinkTemp.set(savedFileName, futureTime);

      const category = fields["category"];
      const clientId = fields["clientId"];
      const text = fields["text"];
      const width = fields["width"];
      const height = fields["height"];
      const duration = fields["duration"];
      const extension = fields["extension"];
      const fileSizeBytes = fields["fileSizeBytes"];
      const mimeType = fields["mimeType"];
      const businessPhoneId = fields["businessPhoneId"];
      const businessPhone = fields["businessPhone"];
      const dstPhone = fields["dstPhone"];

      const newMessage = new Message({
        client: clientId,
        wid: null,
        uuid,
        text,
        sent: true,
        time: new Date(),
        category,
        businessPhone,
        sentStatus: "not_sent",
        width,
        height,
        duration,
        extension,
        fileSizeBytes,
        mimeType,
        savedFileName,
        metaFileName: orgFilename,
      });
      console.log("la categoria es " + category);

      // return;
      await newMessage.save();
      console.log("ENTRANDOOOOOOOOO222222S");
      console.log("MI MIMETYPE ES " + fields.mimetype);
      console.log("FILENAME ES  " + orgFilename);
      //post a meta para enviar mensaje con el link temporal https://${SERVER_SAVE}/api/temp/media/${savedFileName}
      // console.log(util.inspect(metadata));
      let link = `https://${DOMAIN}/api/temp/media/${savedFileName}`;

      console.log("El link es " + link);
      console.log("la categoria es " + category);
      const messageData = { link };
      if (category != "audio" && category != "sticker") {
        messageData.caption = text;
      }
      if (category == "document") {
        messageData.filename = orgFilename;
      }
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
    },
    (error) => {
      res.status(500).send(error.message);
    }
  );
};

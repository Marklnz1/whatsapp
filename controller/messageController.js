const busboy = require("busboy");
const Client = require("../models/Client");
const Message = require("../models/Message");
const { sendWhatsappMessage, saveMediaBusiness } = require("../utils/server");
const { default: axios } = require("axios");
const CLOUD_API_ACCESS_TOKEN = process.env.CLOUD_API_ACCESS_TOKEN;
const SERVER_SAVE = process.env.SERVER_SAVE;
const DOMAIN = process.env.DOMAIN;

const SERVER_SAVE_TOKEN = process.env.SERVER_SAVE_TOKEN;
const https = require("https");
const mime = require("mime-types");
const { updateAndGetSyncCode } = require("../utils/sync");
const messagesSet = new Set();
const agent = new https.Agent({
  rejectUnauthorized: false,
});
module.exports.sendLocationMessage = async (req, res) => {
  const { clientUuid, textContent, uuid, businessPhone, businessPhoneId } =
    req.body;
  if (messagesSet.has(uuid)) {
    messagesSet.delete(uuid);
    return res.status(200).json({ error: "Solicitud duplicada" });
  }
  messagesSet.add(uuid);

  const client = await Client.findOne({ uuid: clientUuid });

  const newMessage = new Message({
    client: clientUuid,
    wid: null,
    uuid,
    syncCode: await updateAndGetSyncCode("message", 1),
    textContent: textContent,
    sent: true,
    read: true,
    time: new Date().getTime(),
    category: "location",
    businessPhone,
    sentStatus: "not_sent",
  });
  await newMessage.save();
  const messageId = await sendWhatsappMessage(
    CLOUD_API_ACCESS_TOKEN,
    businessPhoneId,
    client.wid,
    "interactive",
    {
      type: "location_request_message",
      body: {
        textContent: textContent,
      },
      action: {
        name: "send_location",
      },
    },
    newMessage._id
  );
  newMessage.wid = messageId;
  newMessage.sentStatus = "send_requested";
  await newMessage.save();
};
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
    const { clientUuid, textContent, uuid, businessPhone, businessPhoneId } =
      req.body;
    if (messagesSet.has(uuid)) {
      messagesSet.delete(uuid);
      return res.status(200).json({ error: "Solicitud duplicada" });
    }
    messagesSet.add(uuid);
    const client = await Client.findOne({ uuid: clientUuid });
    client.chatbot = false;
    await client.save();

    await Message.updateMany({ client: clientUuid }, { $set: { read: true } });

    const newMessage = new Message({
      syncCode: await updateAndGetSyncCode("message", 1),
      client: clientUuid,
      wid: null,
      uuid,
      textContent,
      sent: true,
      read: true,
      time: new Date().getTime(),
      category: "text",
      businessPhone,
      sentStatus: "not_sent",
    });
    await newMessage.save();
    // console.log("ID DEL MENSAJE CREADO => " + newMessage._id);

    const messageId = await sendWhatsappMessage(
      CLOUD_API_ACCESS_TOKEN,
      businessPhoneId,
      client.wid,
      "text",
      {
        body: textContent,
      },
      newMessage._id
    );
    newMessage.wid = messageId;
    newMessage.sentStatus = "send_requested";
    await newMessage.save();
    // console.log("TERMINANDOOOOOOOOOOOO FUNCION  ");
    res.json({});
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports.sendMediaMessage = (req, res) => {
  saveMediaBusiness(
    req,
    async (orgFilename, savedFileName, fields) => {
      const uuid = fields.uuid;
      // console.log("ingreso el uuid " + uuid);
      if (messagesSet.has(uuid)) {
        // console.log("INGRESOOOOOOO CON EL UUID " + uuid);
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
      const clientUuid = fields["clientUuid"];
      const textContent = fields["textContent"];
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
        syncCode: await updateAndGetSyncCode("message", 1),
        client: clientUuid,
        wid: null,
        uuid,
        textContent: textContent,
        sent: true,
        time: new Date().getTime(),
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
      // console.log("la categoria es " + category + " filename " + savedFileName);

      // return;
      await newMessage.save();
      // console.log("ENTRANDOOOOOOOOO222222S");
      // console.log("MI MIMETYPE ES " + mimeType);
      // console.log("FILENAME ES  " + orgFilename);
      //post a meta para enviar mensaje con el link temporal https://${SERVER_SAVE}/api/temp/media/${savedFileName}
      // console.log(util.inspect(metadata));
      let link = `https://${DOMAIN}/api/temp/media/${savedFileName}`;

      // console.log("El link es " + link);
      // console.log("la categoria es " + category);
      const messageData = { link };
      if (category != "audio" && category != "sticker") {
        messageData.caption = textContent;
      }
      if (category == "document") {
        messageData.filename = orgFilename;
      }
      const messageId = await sendWhatsappMessage(
        CLOUD_API_ACCESS_TOKEN,
        businessPhoneId,
        dstPhone,
        category,
        messageData,
        newMessage._id
      );
      newMessage.sentStatus = "send_requested";
      newMessage.wid = messageId;
      await newMessage.save();
      // console.log("SE TERMINOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOASDASD");
      res.sendStatus(200);
    },
    (error) => {
      res.status(500).send(error.message);
    }
  );
};

const axios = require("axios");
const { v7: uuidv7 } = require("uuid");

const { promisify, inspect } = require("util");
const { pipeline } = require("stream");
const busboy = require("busboy");
var ffprobe = require("ffprobe-static");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const mime = require("mime-types");

const path = require("path");
const Message = require("../models/Message");
const Client = require("../models/Client");
const WhatsappAccount = require("../models/WhatsappAccount");
const Chat = require("../models/Chat");
const { SyncServer } = require("../synchronization/SyncServer");
ffmpeg.setFfprobePath(ffprobe.path);
const ffprobeAsync = promisify(ffmpeg.ffprobe);
const pipelineAsync = promisify(pipeline);
const CLOUD_API_ACCESS_TOKEN = process.env.CLOUD_API_ACCESS_TOKEN;
const CLOUD_API_VERSION = process.env.CLOUD_API_VERSION;

const getMediaMetadata = async (filePath, mediaType) => {
  const metadata = await ffprobeAsync(filePath);

  const { format, streams } = metadata;
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");

  if (mediaType === "video" && videoStream) {
    return {
      duration: format.duration,
      width: videoStream.width,
      height: videoStream.height,
    };
  } else if (mediaType === "image" && videoStream) {
    return {
      width: videoStream.width,
      height: videoStream.height,
    };
  } else if (mediaType === "audio" && audioStream) {
    return {
      duration: format.duration,
    };
  } else {
    return {};
  }
};

const getMediaToURL = async (url) => {
  const response = await axios({
    method: "GET",
    url,
    responseType: "stream",
    headers: {
      Authorization: `Bearer ${CLOUD_API_ACCESS_TOKEN}`,
    },
  });
  return response.data;
};
module.exports.validateToken = (token) => {
  try {
    const decoded = jwt.verify(token, TOKEN_SECRET);
    return true;
  } catch (err) {
    return false;
  }
};
module.exports.sendConfirmationMessage = async (
  metaToken,
  businessPhoneId,
  messageId
) => {
  // console.log("el id CONFIRMATION", messageId, businessPhoneId);
  try {
    const sendData = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      status: "read",
      message_id: messageId,
    };
    const response = await axios({
      method: "POST",
      url: `https://graph.facebook.com/v20.0/${businessPhoneId}/messages`,
      data: sendData,
      headers: {
        Authorization: `Bearer ${metaToken}`,
        "Content-Type": "application/json",
      },
    });
    // console.log(inspect(response));
  } catch (error) {
    console.log("ERROR CONFIRMATION" + inspect(error.response.data), metaToken);
  }
};
module.exports.sendReaction = async (
  metaToken,
  businessPhoneId,
  dstPhone,
  messageId,
  emoji
) => {
  try {
    const sendData = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: dstPhone,
      type: "reaction",
      reaction: {
        message_id: messageId,
        emoji,
      },
    };
    const response = await axios({
      method: "POST",
      url: `https://graph.facebook.com/v20.0/${businessPhoneId}/messages`,
      data: sendData,
      headers: {
        Authorization: `Bearer ${metaToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.log("ERROR REACTION" + error.response.data);
  }
};

function getTemplateBody(templateData) {
  for (const component of templateData.components) {
    if (component.type == "BODY") {
      return component;
    }
  }
}
async function getChatDB(businessPhoneId, businessPhone, destinationPhone) {
  let whatsappAccountDB = await SyncServer.createOrGet(
    WhatsappAccount,
    "whatsappAccount",
    businessPhone,
    {
      name: `+${businessPhone}`,
      businessPhone: businessPhone,
      businessPhoneId: businessPhoneId,
    }
  );
  let clientDB = await SyncServer.createOrGet(
    Client,
    "client",
    destinationPhone,
    {
      wid: destinationPhone,
      username: `+${destinationPhone}`,
    }
  );
  return await SyncServer.createOrGet(
    Chat,
    "chat",
    `${clientDB.uuid}_${whatsappAccountDB.uuid}`,
    {
      client: clientDB.uuid,
      whatsappAccount: whatsappAccountDB.uuid,
      lastSeen: 0,
      chatbot: false,
    }
  );
}
module.exports.sendTemplateAndCreateDB = async (
  metaToken,
  businessPhoneId,
  businessPhone,
  destinationPhone,
  templateData,
  io
) => {
  try {
    const messageUuid = uuidv7();
    const body = getTemplateBody(templateData);

    let chatDB = await getChatDB(
      businessPhoneId,
      businessPhone,
      destinationPhone
    );
    await SyncServer.createOrGet(Message, "message", messageUuid, {
      chat: chatDB.uuid,
      textContent: body.text,
      sent: true,
      templateName: templateData.name,
    });
    io.emit("serverChanged");

    const messageId = await this.sendWhatsappMessage(
      metaToken,
      businessPhoneId,
      destinationPhone,
      "template",
      {
        name: templateData.name,
        language: { code: templateData.language },
      },
      messageUuid
    );
    await SyncServer.updateFields(Message, "message", messageUuid, {
      wid: messageId,
      sentStatus: "send_requested",
    });
    io.emit("serverChanged");
  } catch (error) {
    console.log(
      "ERROR AL ENVIAR EL TEMPLATE ",
      inspect(error.response.data, true, 9999)
    );
    throw Error(error.response.data);
  }
};
module.exports.sendWhatsappMessage = async (
  metaToken,
  businessPhoneId,
  dstPhone,
  category,
  messageData,
  biz_opaque_callback_data,
  clientMessageId
) => {
  // console.log("lo recibido " + biz_opaque_callback_data);
  biz_opaque_callback_data ??= "";
  // console.log("lo recibido posible cambio????? " + biz_opaque_callback_data);

  const sendData = {
    biz_opaque_callback_data,
    messaging_product: "whatsapp",
    to: dstPhone,
    type: category,
  };
  if (clientMessageId) {
    sendData.context = {
      message_id: clientMessageId,
    };
  }
  sendData[category] = messageData;
  const response = await axios({
    method: "POST",
    url: `https://graph.facebook.com/v20.0/${businessPhoneId}/messages`,
    data: sendData,
    headers: {
      Authorization: `Bearer ${metaToken}`,
      "Content-Type": "application/json",
    },
  });
  const messageId = response.data.messages[0].id;
  return messageId;
};

module.exports.getTemplates = async (
  whatsappBusinessAccountId,
  cloudApiAccessToken,
  queryString
) => {
  const response = await axios({
    method: "GET",
    url: `https://graph.facebook.com/${CLOUD_API_VERSION}/${whatsappBusinessAccountId}/message_templates?${queryString}`,
    headers: {
      Authorization: `Bearer ${cloudApiAccessToken}`,
      "Content-Type": "application/json",
    },
  });
  return response.data;
};
module.exports.saveMediaBusiness = (req, onFinish, onError) => {
  try {
    const category = req.params.category;
    const type = req.params.type;
    const subtype = req.params.subtype;

    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
    });
    let finish = false; // Bandera para evitar múltiples respuestas
    let savedFileName;
    let outputPath;
    let fileMimetype;
    let streamClose = false;
    let error = null;
    let fileName;
    let fields = {};
    bb.on("file", (name, file, info) => {
      const { filename, encoding, mimetype } = info;
      fileName = filename;
      fileMimetype = mimetype;
      const dirMain = process.cwd();
      const outputDir = path.resolve(dirMain, category);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
      }
      savedFileName = `${category}_${type}_${uuidv7()}_${uuidv7()}.${subtype}`;
      outputPath = path.join(dirMain, category, savedFileName);
      const writeStream = fs.createWriteStream(outputPath);
      file.pipe(writeStream);
      file.on("limit", () => {
        error = "Archivo demasiado grande";
        writeStream.destroy();
        fs.unlinkSync(outputPath);
      });
      file.on("error", () => {
        error = "Error al manejar el archivo";
        writeStream.destroy();
        fs.unlinkSync(outputPath);
      });
      writeStream.on("close", async () => {
        streamClose = true;
        if (finish) {
          return onFinish(filename, savedFileName, fields);
        }
      });
    });
    bb.on("field", (name, val) => {
      fields[name] = val;
    });
    bb.on("finish", () => {
      if (error) {
        return onError(error);
      }
      finish = true;
      if (streamClose) {
        return onFinish(fileName, savedFileName, fields);
      }
    });

    bb.on("error", (error) => {
      if (!error) {
        error = "Error al subir los archivos";
      }
    });

    req.pipe(bb);
  } catch (error) {
    onError(error);
  }
};
module.exports.saveMedia = (req, onFinish, onError) => {
  try {
    console.log("INGRESANDO FILE");
    const category = req.params.category;
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
    });
    let finish = false; // Bandera para evitar múltiples respuestas
    let outputPath;
    let fileMimetype;
    let streamClose = false;
    let error = null;
    bb.on("file", (name, file, info) => {
      console.log("OBTENIENDO FILE");

      const { filename, encoding, mimetype } = info;
      fileMimetype = mimetype;
      const dirMain = process.cwd();
      const outputDir = path.resolve(dirMain, category);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
      }
      outputPath = path.join(dirMain, category, filename);
      const writeStream = fs.createWriteStream(outputPath);
      console.log("ESCRIBIENDO FILE");

      file.pipe(writeStream);

      file.on("limit", () => {
        error = "Archivo demasiado grande";
        writeStream.destroy();
        fs.unlinkSync(outputPath);
      });
      file.on("error", () => {
        error = "Error al manejar el archivo";
        writeStream.destroy();
        fs.unlinkSync(outputPath);
      });
      writeStream.on("close", async () => {
        streamClose = true;
        if (finish) {
          return onFinish();
        }
      });
    });

    bb.on("finish", () => {
      if (error) {
        return onError(error);
      }
      finish = true;
      if (streamClose) {
        return onFinish();
      }
    });

    bb.on("error", (error) => {
      if (!error) {
        error = "Error al subir los archivos";
      }
    });

    req.pipe(bb);
  } catch (error) {
    onError(error);
  }
};
module.exports.saveMediaClient = async (mediaId, category) => {
  // try {
  // const mediaId = req.params.mediaId;
  // const category = req.params.category;
  const response = await axios({
    method: "GET",
    url: "https://graph.facebook.com/" + mediaId,
    headers: {
      Authorization: `Bearer ${CLOUD_API_ACCESS_TOKEN}`,
    },
  });
  const mimetype = response.data.mime_type;
  const split = mimetype.split(";")[0].trim().split("/");
  const type = split[0];
  const subtype = split[1];
  const extension = mime.extension(mimetype);
  const fileSizeBytes = response.data.file_size;
  const dirMain = process.cwd();
  const savedFileName = `${category}_${type}_${uuidv7()}_${uuidv7()}.${subtype}`;
  const outputPath = path.resolve(dirMain, category, savedFileName);

  const outputDir = path.resolve(dirMain, category);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  const data = await getMediaToURL(response.data.url, category);

  await pipelineAsync(data, fs.createWriteStream(outputPath));
  let metadata = { mimeType: mimetype, extension, fileSizeBytes };
  if (category == "audio" || category == "video" || category == "image") {
    metadata = {
      ...metadata,
      ...(await getMediaMetadata(outputPath, category)),
    };
  }
  return { savedFileName, ...metadata };
  //   res.json({ savedFileName, ...metadata });
  // } catch (error) {
  //   res.status(400).json({ error: error.message });
  // }
};

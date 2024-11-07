const axios = require("axios");
const { v7: uuidv7 } = require("uuid");

const { promisify } = require("util");
const { pipeline } = require("stream");
const busboy = require("busboy");
var ffprobe = require("ffprobe-static");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const mime = require("mime-types");

const path = require("path");
ffmpeg.setFfprobePath(ffprobe.path);
const ffprobeAsync = promisify(ffmpeg.ffprobe);
const pipelineAsync = promisify(pipeline);
const META_TOKEN = process.env.META_TOKEN;

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
      Authorization: `Bearer ${META_TOKEN}`,
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

module.exports.sendWhatsappMessage = async (
  metaToken,
  businessPhoneId,
  dstPhone,
  category,
  messageData,
  biz_opaque_callback_data
) => {
  console.log("lo recibido " + biz_opaque_callback_data);
  biz_opaque_callback_data ??= "";
  console.log("lo recibido posible cambio????? " + biz_opaque_callback_data);

  const sendData = {
    biz_opaque_callback_data,
    messaging_product: "whatsapp",
    to: dstPhone,
    type: category,
  };
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
      savedFileName = `${category}_${type}_${subtype}_${uuidv7()}_${uuidv7()}`;
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

module.exports.saveMediaClient = async (mediaId, category) => {
  // try {
  // const mediaId = req.params.mediaId;
  // const category = req.params.category;
  const response = await axios({
    method: "GET",
    url: "https://graph.facebook.com/" + mediaId,
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
    },
  });
  const mimetype = response.data.mime_type;
  const split = mimetype.split(";")[0].trim().split("/");
  const type = split[0];
  const subtype = split[1];
  const extension = mime.extension(mimetype);
  const fileSizeBytes = response.data.file_size;
  const dirMain = process.cwd();
  const savedFileName = `${category}_${type}_${subtype}_${uuidv7()}_${uuidv7()}`;
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

const mongoose = require("mongoose");
const { generateFields } = require("../synchronization/sync");
const Schema = mongoose.Schema;
/*
  Estados de la conversación
  normal
  form_name
*/
const MediaContentSchema = new Schema(
  generateFields({
    savedFileName: { type: String, default: "" },
    category: { type: String, default: "" },
    height: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    metaFileName: { type: String, default: "" },
    extension: { type: String, default: "" },
    fileSizeBytes: { type: String, default: "" },
    mimeType: { type: String, default: "" },
  }),
  { timestamps: true }
);
const MediaContent = mongoose.model(
  "mediaContent",
  MediaContentSchema,
  "mediaContent"
);
module.exports = MediaContent;

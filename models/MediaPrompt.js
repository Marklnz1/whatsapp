const mongoose = require("mongoose");
const { generateFields } = require("../synchronization/sync");
const Schema = mongoose.Schema;
/*
  Estados de la conversación
  normal
  form_name
*/
const MediaPromptSchema = new Schema(
  generateFields({
    mediaContent: { required: true, type: String, default: "" },
    description: { type: String, default: "" },
  }),
  { timestamps: true }
);
const MediaPrompt = mongoose.model(
  "mediaPrompt",
  MediaPromptSchema,
  "mediaPrompt"
);
module.exports = MediaPrompt;

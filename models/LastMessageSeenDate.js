const mongoose = require("mongoose");
const { generateFields } = require("../utils/sync");
const Schema = mongoose.Schema;
/*
  Estados de la conversación
  normal
  form_name
*/
const LastMessageSeenDateSchema = new Schema(
  generateFields({
    client: String,
    whatsAppAccount: String,
    time: Number,
  }),
  { timestamps: true }
);
const LastMessageSeenDate = mongoose.model(
  "lastMessageSeenDate",
  LastMessageSeenDateSchema,
  "lastMessageSeenDate"
);
module.exports = LastMessageSeenDate;

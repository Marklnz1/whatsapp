const mongoose = require("mongoose");
const { generateFields } = require("../synchronization/sync");
const Schema = mongoose.Schema;
/*
  Estados de la conversación
  normal
  form_name
*/
const ChatSchema = new Schema(
  generateFields({
    client: { type: String, default: "" },
    whatsappAccount: { type: String, default: "" },
    lastSeen: { type: Number, default: 0 },
    chatbot: { type: Boolean, default: true },
  }),
  { timestamps: true }
);
const Chat = mongoose.model("chat", ChatSchema, "chat");
module.exports = Chat;

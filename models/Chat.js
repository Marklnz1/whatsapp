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
    clientWid: String,
    businessPhone: String,
    lastSeen: Number,
    chatbot: Boolean,
  }),
  { timestamps: true }
);
const Chat = mongoose.model("chat", ChatSchema, "chat");
module.exports = Chat;

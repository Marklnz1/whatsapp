const mongoose = require("mongoose");
const Schema = mongoose.Schema;
/*
  Estados de la conversación
  normal
  form_name
*/
const ClientSchema = new Schema(
  {
    wid: {
      type: String,
      unique: true,
      required: true,
    },
    chatbot: Boolean,
    base64Profile: String,
    username: String,
    conversationMode: String,
  },
  { timestamps: true }
);
const Client = mongoose.model("client", ClientSchema, "client");
module.exports = Client;

const mongoose = require("mongoose");
const Schema = mongoose.Schema;

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
  },
  { timestamps: true }
);
const Client = mongoose.model("client", ClientSchema, "client");
module.exports = Client;

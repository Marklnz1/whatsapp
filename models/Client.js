const mongoose = require("mongoose");
const { generateFields } = require("../synchronization/sync");
const Schema = mongoose.Schema;
/*
  Estados de la conversación
  normal
  form_name
*/
const ClientSchema = new Schema(
  generateFields({
    wid: {
      type: String,
      unique: true,
      required: true,
    },
    base64Profile: String,
    username: String,
    formProcess: { type: String, default: null },
  }),
  { timestamps: true }
);
const Client = mongoose.model("client", ClientSchema, "client");
module.exports = Client;

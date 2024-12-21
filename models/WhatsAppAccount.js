const mongoose = require("mongoose");
const { generateFields } = require("../utils/sync");
const Schema = mongoose.Schema;
/*
  Estados de la conversación
  normal
  form_name
*/
const WhatsAppAccountSchema = new Schema(
  generateFields({
    name: String,
    businessPhone: String,
    businessPhoneId: String,
    prompt: String,
  }),
  { timestamps: true }
);
const WhatsAppAccount = mongoose.model(
  "whatsAppAccount",
  WhatsAppAccountSchema,
  "whatsAppAccount"
);
module.exports = WhatsAppAccount;

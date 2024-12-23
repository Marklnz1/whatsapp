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
const WhatsappAccount = mongoose.model(
  "whatsappAccount",
  WhatsAppAccountSchema,
  "whatsappAccount"
);
module.exports = WhatsappAccount;

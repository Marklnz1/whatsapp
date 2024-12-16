const mongoose = require("mongoose");
const Schema = mongoose.Schema;
/*
  Estados de la conversación
  normal
  form_name
*/
const WhatsAppAccountSchema = new Schema(
  {
    businessPhone: String,
    prompt: String,
  },
  { timestamps: true }
);
const WhatsAppAccount = mongoose.model(
  "whatsAppAccount",
  WhatsAppAccountSchema,
  "whatsAppAccount"
);
module.exports = WhatsAppAccount;

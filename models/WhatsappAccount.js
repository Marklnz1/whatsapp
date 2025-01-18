const mongoose = require("mongoose");
const { generateFields } = require("../synchronization/sync");
const Schema = mongoose.Schema;
/*
  Estados de la conversación
  normal
  form_name
*/
const WhatsAppAccountSchema = new Schema(
  generateFields({
    name: { type: String, default: "" },
    businessPhone: { type: String, default: "" },
    businessPhoneId: { type: String, default: "" },
    prompt: { type: String, default: "" },
  }),
  { timestamps: true }
);
const WhatsappAccount = mongoose.model(
  "whatsappAccount",
  WhatsAppAccountSchema,
  "whatsappAccount"
);
module.exports = WhatsappAccount;

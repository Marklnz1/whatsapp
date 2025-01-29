const mongoose = require("mongoose");
const { generateFields } = require("../synchronization/sync");
const Schema = mongoose.Schema;
/*
  Estados de la conversación
  normal
  form_name
*/
const BroadcastSchema = new Schema(
  generateFields({
    name: { type: String, default: "" },
    templateName: { type: String, default: "" },
  }),
  { timestamps: true }
);
const Broadcast = mongoose.model("broadcast", BroadcastSchema, "broadcast");
module.exports = Broadcast;

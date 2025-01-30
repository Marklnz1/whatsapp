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
    broadcastName: { type: String, default: "" },
    id: { type: String, default: "" },
    name: { type: String, default: "" },
    textContent: { type: String, default: "" },
    language: { type: String, default: "" },
    status: { type: String, default: "" },
    category: { type: String, default: "" },
    subCategory: { type: String, default: "" },
    variableExampleMap: { type: String, default: "" },
  }),
  { timestamps: true }
);
const Broadcast = mongoose.model("broadcast", BroadcastSchema, "broadcast");
module.exports = Broadcast;

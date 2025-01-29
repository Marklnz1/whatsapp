const mongoose = require("mongoose");
const { generateFields } = require("../synchronization/sync");
const Schema = mongoose.Schema;
/*
  Estados de la conversación
  normal
  form_name
*/
const RowDataBroadcastSchema = new Schema(
  generateFields({
    broadcast: { type: String, default: "" },
    phone: { type: String, default: "" },
    data: { type: String, default: "" },
    messageUuid: { type: String, default: "" },
  }),
  { timestamps: true }
);
const RowDataBroadcast = mongoose.model(
  "rowDataBroadcast",
  RowDataBroadcastSchema,
  "rowDataBroadcast"
);
module.exports = RowDataBroadcast;

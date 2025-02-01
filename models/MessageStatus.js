const mongoose = require("mongoose");
const { generateFields } = require("../synchronization/sync");
const Schema = mongoose.Schema;

const MessageStatusSchema = new Schema(
  generateFields({
    message: { type: String, default: "" },
    msgStatus: { type: String, default: "" },
    time: { type: Number, default: () => new Date().getTime() },
    errorCode: { type: Number, default: 0 },
    errorMessage: { type: String, default: "" },
  }),
  { timestamps: true }
);

const MessageStatus = mongoose.model(
  "messageStatus",
  MessageStatusSchema,
  "messageStatus"
);
module.exports = MessageStatus;

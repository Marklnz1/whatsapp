const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const MessageStatusSchema = new Schema(
  {
    message: { type: mongoose.Schema.Types.ObjectId, ref: "message" },
    status: String,
    time: Date,
  },
  { timestamps: true }
);

const MessageStatus = mongoose.model(
  "messageStatus",
  MessageStatusSchema,
  "messageStatus"
);
module.exports = MessageStatus;

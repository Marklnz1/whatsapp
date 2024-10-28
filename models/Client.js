const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const MessageSchema = new Schema(
  {
    read: Boolean,
    msg: String,
    type: String,
    mimeType: String,
    width: Number,
    height: Number,
    duration: Number,
    fileName: String,
    metaFileName: String,
    time: Date,
    sent: Boolean,
    extension: String,
    fileSizeBytes: String,
  },
  { timestamps: true }
);
const ClientSchema = new Schema(
  {
    wid: {
      type: String,
      unique: true,
      required: true,
    },
    chatbot: Boolean,
    base64Profile: String,
    contact: String,
    msg: String,
    time: Date,
    unreadMsgs: Number,
    messages: [MessageSchema],
  },
  { timestamps: true }
);
const Client = mongoose.model("client", ClientSchema, "client");
module.exports = Client;

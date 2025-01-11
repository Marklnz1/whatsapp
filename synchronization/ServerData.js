const mongoose = require("mongoose");
const { generateFields } = require("../synchronization/sync");
const Schema = mongoose.Schema;
const ServerDataSchema = new Schema(
  generateFields({
    restartCounter: { type: Number, default: 0 },
    tempCodeMax: { type: Number, default: 0 },
    processedTempCode: { type: Number, default: 0 },
  }),
  { timestamps: true }
);
const ServerData = mongoose.model("serverData", ServerDataSchema, "serverData");
module.exports = ServerData;

const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SyncMetadataSchema = new Schema(
  {
    tableName: { type: String, required: true },
    syncCodeMax: { type: Number, default: 0 },
  },
  { timestamps: true }
);
const SyncMetadata = mongoose.model(
  "syncMetadata",
  SyncMetadataSchema,
  "syncMetadata"
);
module.exports = SyncMetadata;

const mongoose = require("mongoose");
const { generateFields } = require("./sync");
const Schema = mongoose.Schema;
const ChangeSchema = new Schema(
  {
    tempCode: Number,
    status: String,
  },
  { timestamps: true }
);
const Change = mongoose.model("change", ChangeSchema, "change");
module.exports = Change;

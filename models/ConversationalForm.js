const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const FieldSchema = new Schema({
  name: String,
  description: String,
  value: { type: String, default: null },
});
const ConversationalFormSchema = new Schema(
  {
    name: String,
    description: String,
    fields: [FieldSchema],
  },
  { timestamps: true }
);
const ConversationalForm = mongoose.model(
  "conversationalForm",
  ConversationalFormSchema,
  "conversationalForm"
);
module.exports = ConversationalForm;

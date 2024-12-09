const mongoose = require("mongoose");
const Schema = mongoose.Schema;
/*estados de un mensaje enviado
  0 = error al enviar (necesario que se active por meta)
  1 = no enviado
  2 = solicitud de envio realizado
  3 = envio confirmado
  4 = leido
  5 = eliminado (no soportado por la api de meta)
*/
// const messageStatus = {
//     ERROR: "error_sending", // 0 = error al enviar (necesario que se active por meta)
//     NOT_SENT: "not_sent", // 1 = no enviado
//     SEND_REQUESTED: "send_requested", // 2 = solicitud de envio realizado
//     SEND_CONFIRMED: "send_confirmed", // 3 = envio confirmado
//     READ: "read", // 4 = leido
//     DELETED: "deleted" // 5 = eliminado (no soportado por la api de meta)
//   };
const MessageSchema = new Schema(
  {
    uuid: String,
    wid: String,
    syncCode: Number,
    version: Number,
    status: { type: String, default: "Inserted" },
    client: {
      type: String,
      required: true,
    },
    text: String,
    sent: Boolean,
    time: Date,
    category: String,
    businessPhone: String,
    sentStatus: String,
    read: Boolean,
    mimeType: String,
    width: Number,
    height: Number,
    duration: Number,
    savedFileName: String,
    metaFileName: String,
    extension: String,
    fileSizeBytes: String,
  },
  { timestamps: true }
);

const Message = mongoose.model("message", MessageSchema, "message");
module.exports = Message;

const mongoose = require("mongoose");
const { generateFields } = require("../synchronization/sync");
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
  generateFields({
    wid: { type: String, default: "" },
    chat: {
      type: String,
      required: true,
    },
    mediaContent: { type: String, default: "" },
    textContent: { type: String, default: "" },
    sent: { type: Boolean, default: false },

    // read: { type: Boolean, default: false },
    templateName: { type: String, default: "" },
    templateData: { type: String, default: "" },
    broadcast: { type: String, default: "" },

    sentStatus: { type: String, default: "not_sent" },
    time: { type: Number, default: () => new Date().getTime() },
    errorDetails: { type: String, default: "" },
  }),
  { timestamps: true }
);

const Message = mongoose.model("message", MessageSchema, "message");
module.exports = Message;

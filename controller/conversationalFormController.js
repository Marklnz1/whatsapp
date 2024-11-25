const ConversationalForm = require("../models/ConversationalForm");

module.exports.postForm = async (req, res) => {
  const fields = [];
  fields.push({ name: "DNI", description: "para identificar al cliente" });
  fields.push({
    name: "Plan de internet",
    description: "plan que quiere contratar el cliente",
  });
  fields.push({
    name: "dirección",
    description: "dirección del cliente donde se realizara la instalación",
  });

  const form = new ConversationalForm({
    name: "Solicitud para instalación de internet",
    fields,
  });
  await form.save();
  res.sendStatus(200);
};

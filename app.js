const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;
const whatsAppController = require("./controller/whatsAppController");

app.use(express.json());
app
  .get("/", whatsAppController.verifyToken)
  .post("/", whatsAppController.receiveMessage);

app.listen(PORT, () => {
  console.log("SERVER ACTIVO: PUERTO USADO :" + PORT);
});

const expres = require("express");
const router = expres.Router();
const whatsapController = require("..//controller/whatsapController").default;

router
  .get("/", whatsapController.VerificarToken)
  .post("/", whatsapController.Recibirmessaje);

module.exports = router;

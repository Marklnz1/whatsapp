const express = require("express")
const apiRoute = require("./Router/Router")
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use("/whatsapp",apiRoute)
app.listen(PORT,()=>{console.log("el peurto es :"+PORT)})

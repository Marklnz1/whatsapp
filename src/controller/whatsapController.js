/*
const fs = require("fs");
const myConsole= new console.Console(fs.createWriteStream("./logs.txt"));
const VerificarToken= (req,res)=>{
}
const Recibirmessaje = (req,res)=>{
    try{
        var entry =(req.body["entry"])[0]
        var changes=(entry["changes"])[0]
        var value= changes["value"];
        var messageObject = value["messages"]
        myConsole.log(messageObject)                                                                                                                                                                                                                                                                
        res.send("EVENT_RECEIVED")
    }catch(e){
        res.send("EVENT_RECIEVED");
    }
}
module.exports = {
    VerificarToken,
    Recibirmessaje
}*/

const VerificarToken = (req,res)=>{
    try{
        var accessToken= "ASDADASOPKFOASFAM2314332";
        var Token = req.query["hub.verify_token"]
        var challenge = req.query["hub.challenge"]
        if(challenge!=null && Token!=null && Token==accessToken){   
        res.send(challenge)
        }else{
            res.status(400).send()
        }
    }catch(e){
        res.status(400).send()
    }
    res.send("Hola verificarToken")
}

const Recibirmessaje = (req,res)=>{
    res.send("Hola Recibido")
}
module.exports = {
    VerificarToken,
    Recibirmessaje
}
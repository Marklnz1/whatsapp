const { default: axios } = require("axios");

module.exports.sendWhatsappMessage = async (
  metaToken,
  businessPhoneId,
  dstPhone,
  type,
  messageData
) => {
  const sendData = {
    messaging_product: "whatsapp",
    to: dstPhone,
    type,
  };
  sendData[type] = messageData;
  const response = await axios({
    method: "POST",
    url: `https://graph.facebook.com/v20.0/${businessPhoneId}/messages`,
    data: sendData,
    headers: {
      Authorization: `Bearer ${metaToken}`,
      "Content-Type": "application/json",
    },
  });
  const messageId = response.data.messages[0].id;
  return messageId;
};
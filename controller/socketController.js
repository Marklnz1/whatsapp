const Client = require("../models/Client");
const Message = require("../models/Message");
const BUSINESS_PHONE = process.env.BUSINESS_PHONE;
const PHONE_ID = process.env.PHONE_ID;

module.exports.getChats = async (data, io) => {
  const clients = await Client.aggregate([
    {
      $lookup: {
        from: "message",
        let: { clientId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$client", "$$clientId"] },
            },
          },
          {
            $sort: { time: -1 },
          },
          {
            $limit: 1,
          },
        ],
        as: "messages",
      },
    },
  ]).exec();

  io.emit(
    "getChats",
    JSON.stringify({
      clients,
      businessProfiles: [
        { businessPhone: BUSINESS_PHONE, businessPhoneId: PHONE_ID },
      ],
    })
  );
};
module.exports.getMessages = async (data, io) => {
  const { clientUuid, readAll } = JSON.parse(data);
  const messages = await Message.find({ client: clientUuid }).lean().exec();

  if (readAll) {
    await Message.updateMany({ client: clientUuid }, { $set: { read: true } });
  }
  io.emit(
    "getMessages",
    JSON.stringify({
      _id: clientUuid,
      messages,
    })
  );
};
module.exports.readAll = async (data) => {
  const { clientId } = JSON.parse(data);
  const client = await Client.findById(clientId);
  for (let m of client.messages) {
    m.read = true;
  }
  await client.save();
};
module.exports.setChatbotState = async (data) => {
  const { clientId, value } = JSON.parse(data);
  const client = await Client.findById(clientId);
  client.chatbot = value;
  await client.save();
};

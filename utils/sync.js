const util = require("util");
const SyncMetadata = require("../models/SyncMetadata");

module.exports.list_sync = async (Model, req, res, next) => {
  try {
    let { syncCodeMax } = req.body;

    let findData = {
      syncCode: { $gt: syncCodeMax },
      status: { $ne: "Deleted" },
    };

    let docs = await Model.find(findData).lean().exec();
    const syncCodeMaxDB = docs.reduce((max, doc) => {
      return doc.syncCode > max ? doc.syncCode : max;
    }, docs[0].syncCode);
    res.status(200).json({ docs: docs ?? [], syncCodeMax: syncCodeMaxDB });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports.updateAndGetSyncCode = async (tableName, numberOfDocuments) => {
  const $inc = {};
  $inc.syncCodeMax = numberOfDocuments;
  let syncCodeTable = await SyncMetadata.findOneAndUpdate(
    { tableName },
    { $inc },
    { new: true, upsert: true }
  );
  return syncCodeTable.syncCodeMax;
};

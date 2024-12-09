const util = require("util");

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

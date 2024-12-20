const util = require("util");
const SyncMetadata = require("../models/SyncMetadata");
module.exports.createSyncFieldsServerToLocal = () => {
  return {
    uuid: String,
    syncCode: Number,
    version: Number,
    status: { type: String, default: "Inserted" },
  };
};
module.exports.generateFields = (fields) => {
  fields.status = { type: String, default: "Inserted" };
  for (const key in fields) {
    if (fields.hasOwnProperty(key)) {
      fields[`${key}SyncCode`] = { type: Number, default: 1 };
    }
  }

  const finalFields = {
    uuid: String,
    syncCode: Number,
    version: Number,
    ...fields,
  };

  return finalFields;
};
module.exports.update_fields = async (Model, tableName, filter, data) => {
  const incSyncCode = {};
  for (let key of Object.keys(data)) {
    incSyncCode[key + "SyncCode"] = 1;
  }
  const response = await Model.updateOne(filter, {
    $inc: { version: 1, ...incSyncCode },
    $max: { syncCode: await this.updateAndGetSyncCode(tableName, 1) },
    $set: data,
  });
  // console.log(
  //   "con la data " +
  //     util.inspect(data) +
  //     " y el incremento " +
  //     util.inspect(incSyncCode) +
  //     "   respuesta " +
  //     util.inspect(response)
  // );
};
module.exports.update_list_sync = async (
  Model,
  tableName,
  req,
  res,
  next,
  onInsert
) => {
  console.log("INGRESANDO PARA GUARDARRRR");

  try {
    let docs = req.body["docs"];
    console.log("LOS DOCS INGESADOS ES " + util.inspect(docs));
    const uuids = docs.map((doc) => doc.uuid);
    let nonExistingUUIDs;
    if (onInsert) {
      let existingUUIDs = await Model.find({ uuid: { $in: uuids } })
        .select("uuid")
        .lean();
      existingUUIDs = existingUUIDs.map((doc) => doc.uuid);
      nonExistingUUIDs = uuids.filter((uuid) => !existingUUIDs.includes(uuid));
    }
    const fieldSyncCodes = {};
    for (const field of Object.keys(docs[0])) {
      fieldSyncCodes[field + "SyncCode"] = 1;
    }
    await Model.bulkWrite(
      docs.map((doc) => {
        // const { version, ...docWithoutVersion } = doc;
        return {
          updateOne: {
            filter: { uuid: doc.uuid },
            //PROBLEMA CUANDO EL DOCUMENTO SE ESTA CRAENDO
            update: { $set: doc, $inc: { version: 1, ...fieldSyncCodes } },
            upsert: true,
          },
        };
      })
    );

    const syncCodeMax = await this.updateAndGetSyncCode(tableName, docs.length);
    let syncCodeMin = syncCodeMax - docs.length + 1;

    const bulkOps = uuids.map((uuid, index) => ({
      updateOne: {
        filter: { uuid: uuid },
        update: { $set: { syncCode: syncCodeMin + index } },
      },
    }));
    await Model.bulkWrite(bulkOps);

    if (onInsert) {
      for (let d of docs) {
        if (nonExistingUUIDs.includes(d.uuid)) {
          onInsert(d);
        }
      }
    }
    res.status(200).json({ syncCodeMax });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
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

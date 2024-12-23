const util = require("util");
const SyncMetadata = require("../models/SyncMetadata");
module.exports.createOrGet = async (Model, tableName, data) => {
  try {
    var docData = { ...data, syncCode: -1, version: 0 };
    var doc = new Model(docData);
    await doc.save();
    const newSyncCode = await this.update_fields(
      Model,
      tableName,
      {
        uuid: data.uuid,
      },
      {}
    );
    docData.version = 1;
    docData.newSyncCode = newSyncCode;
    console.log("DEVOLVIENDO DOC " + util.inspect(docData));
    return docData;
  } catch (error) {
    const keys = Object.keys(error.keyValue);
    console.log(
      "DUPLICADOOOOO " +
        util.inspect(error) +
        "ERROR CODE " +
        error.code +
        "   keyvalue " +
        util.inspect(error.keyValue) +
        "  cumple??? " +
        (keys.length === 1 && keys[0] === "uuid")
    );
    if (error.code === 11000 && keys.length === 1 && keys[0] === "uuid") {
      const existingDoc = await Model.findOne({ uuid: data.uuid });
      console.log("DEVOLVIENDO DOC222 " + util.inspect(existingDoc));
      return existingDoc;
    } else {
      throw error;
    }
  }
};
module.exports.generateFields = (fields) => {
  fields.status = { type: String, default: "Inserted" };
  for (const key in fields) {
    if (fields.hasOwnProperty(key)) {
      fields[`${key}SyncCode`] = { type: Number, default: 1 };
    }
  }

  const finalFields = {
    uuid: {
      type: String,
      unique: true,
      required: true,
    },
    syncCode: Number,
    version: { type: Number, default: 1 },
    ...fields,
  };

  return finalFields;
};
module.exports.update_fields = async (Model, tableName, filter, data) => {
  const incSyncCode = {};
  for (let key of Object.keys(data)) {
    incSyncCode[key + "SyncCode"] = 1;
  }
  const newSyncCode = await this.updateAndGetSyncCode(tableName, 1);
  const response = await Model.updateOne(filter, {
    $inc: { version: 1, ...incSyncCode },
    $max: { syncCode: newSyncCode },
    $set: data,
  });
  return newSyncCode;
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
        return {
          updateOne: {
            filter: { uuid: doc.uuid },
            //PROBLEMA CUANDO EL DOCUMENTO SE ESTA CREANDO
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
    res.locals.io.emit("serverChanged");
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
    res.status(200).json({ docs: docs ?? [] });
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

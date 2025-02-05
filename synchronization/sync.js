const util = require("util");
const SyncMetadata = require("./SyncMetadata");
const { v7: uuidv7 } = require("uuid");

module.exports.generateFields = (fields) => {
  fields.status = { type: String, default: "inserted" };
  for (const key of Object.keys(fields)) {
    if (fields.hasOwnProperty(key)) {
      fields[`${key}UpdatedAt`] = {
        type: Number,
        default: () => new Date().getTime(),
      };
    }
  }

  fields = {
    uuid: {
      type: String,
      unique: true,
      required: true,
    },
    syncCode: { type: Number, required: true },
    insertedAt: { type: Number, default: () => new Date().getTime() },
    ...fields,
  };

  return fields;
};
// module.exports.update_list_sync = async (Model, tableName, req, res, next) => {
//   try {
//     let docs = req.body["docs"];
//     const fieldSyncCodes = {};
//     for (const field of Object.keys(docs[0])) {
//       fieldSyncCodes[field + "SyncCode"] = 1;
//     }
//     const syncCodeMax = await this.updateAndGetSyncCode(tableName, docs.length);
//     let syncCodeMin = syncCodeMax - docs.length + 1;
//     for (let d of docs) {
//       d.syncCodeMin = syncCodeMin++;
//     }
//     await Model.bulkWrite(
//       docs.map((doc) => {
//         return {
//           updateOne: {
//             filter: { uuid: doc.uuid },
//             update: { $set: doc, $inc: { version: 1, ...fieldSyncCodes } },
//             upsert: true,
//           },
//         };
//       })
//     );
//     res.locals.io.emit("serverChanged");
//     res.status(200).json({ syncCodeMax });
//   } catch (error) {
//     res.status(400).json({ error: error.message });
//   }
// };
// module.exports.updateFields = async (Model, tableName, filter, data) => {
//   const incSyncCode = {};
//   for (let key of Object.keys(data)) {
//     incSyncCode[key + "SyncCode"] = 1;
//   }
//   const newSyncCode = await this.updateAndGetSyncCode(tableName);
//   const doc = await Model.findOneAndUpdate(
//     filter,
//     {
//       $inc: { version: 1, ...incSyncCode },
//       $max: { syncCode: newSyncCode },
//       $set: data,
//     },
//     { upsert: true, new: true, setDefaultsOnInsert: true }
//   );
//   return { newSyncCode, doc };
// };
// module.exports.list_sync = async (Model, req, res, next) => {
//   try {
//     let { syncCodeMax } = req.body;

//     let findData = {
//       syncCode: { $gt: syncCodeMax },
//       status: { $ne: "Deleted" },
//     };

//     let docs = await Model.find(findData).lean().exec();
//     res.status(200).json({ docs: docs ?? [] });
//   } catch (error) {
//     res.status(400).json({ error: error.message });
//   }
// };

// module.exports.updateAndGetSyncCode = async (
//   tableName,
//   numberOfDocuments,
//   session
// ) => {
//   const $inc = {};
//   $inc.syncCodeMax = numberOfDocuments;
//   let syncCodeTable = await SyncMetadata.findOneAndUpdate(
//     { tableName },
//     { $inc },
//     { session, new: true, upsert: true }
//   );
//   return syncCodeTable.syncCodeMax;
// };

// module.exports.update_list_sync = async (
//   Model,
//   tableName,
//   req,
//   res,
//   next
//   // onInsert
// ) => {
//   try {
//     let docs = req.body["docs"];
//     const uuids = docs.map((doc) => doc.uuid);
//     // let nonExistingUUIDs;
//     // if (onInsert) {
//     //   let existingUUIDs = await Model.find({ uuid: { $in: uuids } })
//     //     .select("uuid")
//     //     .lean();
//     //   existingUUIDs = existingUUIDs.map((doc) => doc.uuid);
//     //   nonExistingUUIDs = uuids.filter((uuid) => !existingUUIDs.includes(uuid));
//     // }
//     const fieldSyncCodes = {};
//     for (const field of Object.keys(docs[0])) {
//       fieldSyncCodes[field + "SyncCode"] = 1;
//     }
//     await Model.bulkWrite(
//       docs.map((doc) => {
//         return {
//           updateOne: {
//             filter: { uuid: doc.uuid },
//             //PROBLEMA CUANDO EL DOCUMENTO SE ESTA CREANDO
//             update: { $set: doc, $inc: { version: 1, ...fieldSyncCodes } },
//             upsert: true,
//           },
//         };
//       })
//     );

//     const syncCodeMax = await this.updateAndGetSyncCode(tableName, docs.length);
//     let syncCodeMin = syncCodeMax - docs.length + 1;

//     const bulkOps = uuids.map((uuid, index) => ({
//       updateOne: {
//         filter: { uuid: uuid },
//         update: { $set: { syncCode: syncCodeMin + index } },
//       },
//     }));
//     await Model.bulkWrite(bulkOps);

//     // if (onInsert) {
//     //   for (let d of docs) {
//     //     if (nonExistingUUIDs.includes(d.uuid)) {
//     //       onInsert(d);
//     //     }
//     //   }
//     // }
//     res.locals.io.emit("serverChanged");
//     res.status(200).json({ syncCodeMax });
//   } catch (error) {
//     res.status(400).json({ error: error.message });
//   }
// };

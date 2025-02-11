const { default: mongoose } = require("mongoose");
const LightQueue = require("./LightQueue");
const ServerData = require("./ServerData");
const SyncMetadata = require("./SyncMetadata");
const { inspect } = require("util");
const DocumentInsertResponse = require("./DocumentInsertResponse");
const Change = require("./Change");
const { v7: uuidv7 } = require("uuid");

class DatabaseQueue {
  constructor(Model, tableName, onInsertLocalPrevious, onInsertLocalAfter, io) {
    this.io = io;
    this.Model = Model;
    this.tableName = tableName;
    this.onInsertLocalAfter = onInsertLocalAfter;
    this.onInsertLocalPrevious = onInsertLocalPrevious;

    this.lightQueue = new LightQueue(async ({ tempCode, error }) => {
      console.log("SE PROCESO EL TEMPCODE", tempCode, " ERROR_STATUS:", error);

      if (tempCode != null) {
        if (!error) {
          await Change.deleteMany({
            tempCode,
          });
        }

        await this.updateProcessedTempCode(tempCode);
      }

      this.io.emit("serverChanged");
    });
  }
  async updateProcessedTempCode(tempCode) {
    await ServerData.findOneAndUpdate(
      {},
      { processedTempCode: tempCode },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  addTaskDataInQueue({ tempCode, docs }) {
    const task = async () => {
      const session = await mongoose.startSession();

      try {
        session.startTransaction();

        if (this.onInsertLocalPrevious != null) {
          await this.onInsertLocalPrevious({
            docs,
            session,
          });
        }
        const documentsCreatedLocal = await this.insertToServer({
          docs,
          session,
        });
        await session.commitTransaction();
        if (this.onInsertLocalAfter != null) {
          try {
            const result = this.onInsertLocalAfter(documentsCreatedLocal);
            if (result instanceof Promise) {
              result.catch((error) =>
                console.log("onInsertAfter ERROR (async):", error)
              );
            }
          } catch (error) {
            console.log("onInsertAfter ERROR (sync):", error);
          }
        }
        return { tempCode, error: false };
      } catch (error) {
        await session.abortTransaction();
        console.error("Error en la transacción, se ha revertido:", error);
        return { tempCode, error: true };
      } finally {
        await session.endSession();
      }
    };

    this.lightQueue.add(task);
  }
  async instantReplacement({ doc, filter }) {
    // console.log("INSTANT DATOS ANTES ", inspect(doc, true, 99));
    doc = this.completeFieldsToInsert(doc);
    return new Promise((resolve, reject) => {
      this.lightQueue.add(async () => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          doc.syncCode = await this.updateAndGetSyncCode(
            this.tableName,
            session
          );
          filter ??= {};
          // console.log(
          //   "SE INSTANREPLACEMENTE PARA ",
          //   this.tableName,
          //   " CON DATA: ",
          //   inspect(doc, true, 99)
          // );
          await this.Model.updateOne(
            { uuid: doc.uuid, ...filter },
            {
              $set: doc,
            },
            { session }
          );
          await session.commitTransaction();
          resolve();
        } catch (error) {
          reject(error);
          await session.abortTransaction();
          console.error("Error en la transacción, se ha revertido:", error);
        } finally {
          await session.endSession();
        }
      });
    });
  }
  async createOrGet(doc) {
    // console.log("CREATEORGET DATOS ANTES ", inspect(doc, true, 99));

    doc = this.completeFieldsToInsert(doc);
    return new Promise((resolve, reject) => {
      this.lightQueue.add(async () => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          // console.log(
          //   "SE CREATEORGET PARA ",
          //   this.tableName,
          //   " CON DATA: ",
          //   inspect(doc, true, 99)
          // );
          doc.syncCode = await this.updateAndGetSyncCode(
            this.tableName,
            session
          );
          const updatedDocument = await this.Model.findOneAndUpdate(
            { uuid: doc.uuid },
            {
              $setOnInsert: doc,
            },
            { session, new: true, upsert: true, setDefaultsOnInsert: true }
          );
          await session.commitTransaction();
          resolve(updatedDocument);
        } catch (error) {
          reject(error);
          await session.abortTransaction();
          console.error("Error en la transacción, se ha revertido:", error);
        } finally {
          await session.endSession();
        }
      });
    });
  }
  async updateAndGetSyncCode(tableName, session = null) {
    const options = { new: true, upsert: true };
    if (session) {
      options.session = session;
    }
    let syncCodeTable = await SyncMetadata.findOneAndUpdate(
      { tableName },
      { $inc: { syncCodeMax: 1 } },
      options
    );
    return syncCodeTable.syncCodeMax;
  }
  async insertToServer({ docs, session }) {
    const newDocs = [];
    const syncCode = await this.updateAndGetSyncCode(this.tableName, session);
    let docUuidSet = new Set();
    for (let d of docs) {
      this.completeFieldsToInsert(d);
      docUuidSet.add(d.uuid);
      d.syncCode = syncCode;
    }

    const serverDocs = await this.Model.find({
      uuid: { $in: Array.from(docUuidSet) },
    });
    const serverDocsMap = new Map();
    for (const sd of serverDocs) {
      serverDocsMap.set(sd.uuid, sd);
    }
    let deleteDocs = [];
    for (const d of docs) {
      const serverDoc = serverDocsMap.get(d.uuid);

      if (serverDoc == null) {
        newDocs.push(d);
        continue;
      }
      const keys = Object.keys(d);
      for (const key of keys) {
        if (
          key.endsWith("UpdatedAt") ||
          key == "uuid" ||
          key == "syncCode" ||
          key == "insertedAt"
        ) {
          continue;
        }
        const localDate = d[key + "UpdatedAt"];
        const serverDate = serverDoc[key + "UpdatedAt"];

        if (serverDate >= localDate) {
          delete d[key];
          delete d[key + "UpdatedAt"];
        }
      }
      if (Object.keys(d).length == 0) {
        deleteDocs.push(d);
      }
    }
    docs = docs.filter((doc) => !deleteDocs.includes(doc));
    // console.log("se analizaran " + docs.length);
    if (docs.length == 0) {
      return;
    }
    // console.log("ESPERANDO 10 SEGUNDOS");
    // await new Promise((resolve) => setTimeout(resolve, 5000));

    await this.Model.bulkWrite(
      docs.map((doc) => {
        return {
          updateOne: {
            filter: { uuid: doc.uuid },
            update: { $set: doc },
            upsert: true,
            setDefaultsOnInsert: true,
          },
        };
      }),
      { session }
    );
    return newDocs;
  }
  completeFieldsToInsert(fields) {
    // if (!fields.insertedAt) {
    //   fields.insertedAt = new Date().getTime();
    // }
    if (!fields.uuid) {
      fields.uuid = uuidv7();
    }
    for (const key of Object.keys(fields)) {
      if (
        key == "uuid" ||
        key == "insertedAt" ||
        key.endsWith("UpdatedAt") ||
        fields[key] == null ||
        fields[`${key}UpdatedAt`] != null
      ) {
        continue;
      }
      fields[`${key}UpdatedAt`] = new Date().getTime();
    }
    return fields;
  }
}

module.exports = DatabaseQueue;

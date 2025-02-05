const { default: mongoose } = require("mongoose");
const LightQueue = require("./LightQueue");
const ServerData = require("./ServerData");
const SyncMetadata = require("./SyncMetadata");
const { inspect } = require("util");
const DocumentInsertResponse = require("./DocumentInsertResponse");
const Change = require("./Change");
class DatabaseQueue {
  constructor(Model, tableName, onInsertPrevious, onInsertAfter, io) {
    this.io = io;
    this.Model = Model;
    this.tableName = tableName;
    this.onInsertAfter = onInsertAfter;
    this.onInsertPrevious = onInsertPrevious;

    this.lightQueue = new LightQueue(async ({ insertableDocs, error }) => {
      console.log("ERROR???", error);
      if (!error) {
        const tempCodes = [];
        for (const iDoc of insertableDocs) {
          if (iDoc.tempCode != null) {
            tempCodes.push(iDoc.tempCode);
          }
        }
        console.log("HAY TEMPCODES ", tempCodes);
        if (tempCodes.length > 0) {
          if (!error) {
            await Change.deleteMany({
              tempCode: { $in: tempCodes },
            });
          }
          console.log(
            "se aumento el tempCode a ",
            tempCodes[tempCodes.length - 1]
          );
          await this.updateProcessedTempCode(tempCodes[tempCodes.length - 1]);
        }
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
  addTaskDataInQueue(insertableDocs, onEndTask) {
    console.log("AGREGANDO TAREA");
    const task = {
      data: { insertableDocs, onEndTask },
      exec: async () => {
        console.log("EJECUTANDO TAREA");
        const session = await mongoose.startSession();
        const insertableDocsAll = insertableDocs;
        const onEndTaskList = [];
        for (const task of this.lightQueue.queue) {
          console.log(
            "task con tempCode",
            task.data.insertableDocs,
            task.data.insertableDocs[0].tempCode
          );

          insertableDocsAll.push(task.data.insertableDocs);
          if (task.data.onEndTask != null) {
            onEndTaskList.push(task.data.onEndTask);
          }
        }
        this.lightQueue.queue = [];
        try {
          session.startTransaction();

          if (this.onInsertPrevious != null) {
            await this.onInsertPrevious({
              insertableDocs: insertableDocsAll,
              session,
            });
          }
          const response = await this.insertToServer({
            insertableDocs: insertableDocsAll,
            session,
          });
          await session.commitTransaction();
          if (this.onInsertAfter != null) {
            try {
              this.onInsertAfter(response.responseDocs);
            } catch (error) {
              console.log("ERROR OnInsertAfter exec");
            }
          }
          for (const onEndTask of onEndTaskList) {
            onEndTask(response.responseDocs, false);
          }

          return { insertableDocs: insertableDocsAll, error: false };
        } catch (error) {
          await session.abortTransaction();
          console.error("Error en la transacción, se ha revertido:", error);
          for (const onEndTask of onEndTaskList) {
            onEndTask(null, true);
          }
          return { insertableDocs: insertableDocsAll, error: true };
        } finally {
          await session.endSession();
        }
      },
    };

    this.lightQueue.add(task);
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
  async insertToServer({ insertableDocs, session }) {
    const syncCode = await this.updateAndGetSyncCode(this.tableName, session);

    const uuidSet = new Set();
    // console.log("INSERTABLE DOCSSS?? ", insertableDocs);
    for (let insDoc of insertableDocs) {
      uuidSet.add(insDoc.doc.uuid);
      insDoc.syncCode = syncCode;
    }
    const serverDocsPrevious = await this.Model.find({
      uuid: { $in: Array.from(uuidSet) },
    });
    const existUuidList = [];
    for (const sd in serverDocsPrevious) {
      existUuidList.push(sd.uuid);
    }
    const bulkWriteData = insertableDocs.map((insertableDoc) => {
      const doc = insertableDoc.doc;
      const filter = insertableDoc.filter;
      const insertOnlyIfNotExist = insertableDoc.insertOnlyIfNotExist;
      const documentQuery = { uuid: doc.uuid, syncCode };
      for (const key of Object.keys(doc)) {
        if (!key.endsWith("UpdatedAt")) {
          continue;
        }
        const updatedAt = doc[key];
        const fieldName = key.replace("UpdatedAt", "");

        if (insertOnlyIfNotExist) {
          documentQuery[key] = updatedAt;

          documentQuery[fieldName] = doc[fieldName];
        } else {
          documentQuery[key] = { $max: [`$${key}`, updatedAt] };

          documentQuery[fieldName] = {
            $cond: {
              if: { $lt: [`$${key}`, updatedAt] },
              then: doc[fieldName],
              else: `$${fieldName}`,
            },
          };
        }
      }

      return {
        updateOne: {
          filter: { uuid: documentQuery.uuid, ...filter },
          update: [{ $set: documentQuery }],
          upsert: true,
          setDefaultsOnInsert: true,
        },
      };
    });
    console.log(
      "SE TRATARA DE ENVIAR LA DATA => ",
      inspect(bulkWriteData, true, 99)
    );
    const response = await this.Model.bulkWrite(bulkWriteData, { session });
    const serverDocsAfter = await this.Model.find({
      uuid: { $in: Array.from(uuidSet) },
    })
      .session(session)
      .exec();
    console.log(
      "ME RESPONDE BULK CON ",
      this.Model,
      inspect(response, true, 99)
    );
    const responseDocs = [];
    for (const sda of serverDocsAfter) {
      responseDocs.push(
        new DocumentInsertResponse(sda, !existUuidList.includes(sda.uuid))
      );
    }
    return { insertableDocs, responseDocs };
  }
}

module.exports = DatabaseQueue;

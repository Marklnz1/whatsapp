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
      let tempCodes = new Set();

      for (const iDoc of insertableDocs) {
        if (iDoc.tempCode != null) {
          tempCodes.add(iDoc.tempCode);
        }
      }
      tempCodes = [...tempCodes];
      console.log(
        "HUBO ERROR?",
        error,
        " SE PROCESARON LOS TEMPCODES",
        tempCodes
      );
      if (tempCodes.length > 0) {
        if (!error) {
          await Change.deleteMany({
            tempCode: { $in: tempCodes },
          });
        }

        await this.updateProcessedTempCode(tempCodes[tempCodes.length - 1]);
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
    const task = {
      data: { insertableDocs, onEndTask },
      exec: async () => {
        const session = await mongoose.startSession();
        const insertableDocsAll = insertableDocs;
        const onEndTaskList = [];
        if (onEndTask != null) {
          onEndTaskList.push(onEndTask);
        }
        for (const task of this.lightQueue.queue) {
          insertableDocsAll.push(...task.data.insertableDocs);
          if (task.data.onEndTask != null) {
            onEndTaskList.push(task.data.onEndTask);
          }
        }
        console.log("SE PROCESARAN LOS INSERTABLESDOCS", insertableDocsAll);
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
              const result = this.onInsertAfter(response.responseDocs);
              if (result instanceof Promise) {
                result.catch((error) =>
                  console.log("onInsertAfter ERROR (async):", error)
                );
              }
            } catch (error) {
              console.log("onInsertAfter ERROR (sync):", error);
            }
          }

          try {
            for (const onEndTask of onEndTaskList) {
              try {
                const taskResult = onEndTask(response.responseDocs, false);
                if (taskResult instanceof Promise) {
                  taskResult.catch((error) =>
                    console.log("OnEndTask ERROR (async):", error)
                  );
                }
              } catch (error) {
                console.log("OnEndTask ERROR (sync):", error);
              }
            }
          } catch (error) {
            console.log("OnEndTask Loop ERROR:", error);
          }
          return { insertableDocs: insertableDocsAll, error: false };
        } catch (error) {
          await session.abortTransaction();
          console.error("Error en la transacción, se ha revertido:", error);
          try {
            for (const onEndTask of onEndTaskList) {
              try {
                const taskResult = onEndTask(null, true);
                if (taskResult instanceof Promise) {
                  taskResult.catch((error) =>
                    console.log("OnEndTask ERROR (async):", error)
                  );
                }
              } catch (error) {
                console.log("OnEndTask ERROR (sync):", error);
              }
            }
          } catch (error) {
            console.log("OnEndTask Loop ERROR:", error);
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
    const serverSyncCode = await this.updateAndGetSyncCode(
      this.tableName,
      session
    );

    const uuidSet = new Set();
    // console.log("INSERTABLE DOCSSS?? ", insertableDocs);
    for (let insDoc of insertableDocs) {
      uuidSet.add(insDoc.doc.uuid);
      insDoc.syncCode = serverSyncCode;
    }
    const serverDocsPrevious = await this.Model.find({
      uuid: { $in: Array.from(uuidSet) },
    });
    const existUuidList = [];
    for (const sd of serverDocsPrevious) {
      existUuidList.push(sd.uuid);
    }
    const bulkWriteData = insertableDocs.map((insertableDoc) => {
      const doc = insertableDoc.doc;
      const filter = insertableDoc.filter;
      const insertOnlyIfNotExist = insertableDoc.insertOnlyIfNotExist;
      const uuid = doc.uuid;
      const syncCode = serverSyncCode;
      const documentQuery = { uuid, syncCode };
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
          filter: { uuid: doc.uuid, ...filter },
          update: insertOnlyIfNotExist
            ? { $setOnInsert: documentQuery }
            : [{ $set: documentQuery }],
          upsert: true,
          setDefaultsOnInsert: true,
        },
      };
    });
    if (this.tableName == "message") {
      console.log("SE ENVIARA ", inspect(bulkWriteData, true, 99));
    }
    await this.Model.bulkWrite(bulkWriteData, { session });
    const serverDocsAfter = await this.Model.find({
      uuid: { $in: Array.from(uuidSet) },
    })
      .session(session)
      .exec();

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

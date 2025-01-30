const { Server } = require("socket.io");
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const SyncMetadata = require("./SyncMetadata");
const LightQueue = require("./LightQueue");
const Change = require("./Change");
const ServerData = require("./ServerData");
const { inspect } = require("util");
const { v7: uuidv7 } = require("uuid");

// const { verifyUser, login_post } = require("../controllers/authController");
// const extractUser = require("../middleware/extractUser");
// const authController = require("../controllers/authController");

class SyncServer {
  init({ port, mongoURL, router, auth }) {
    if (auth == null) {
      auth = (req, res, next) => next();
    }
    this.auth = auth;
    this.app = express();
    this.mongoURL = mongoURL;
    this.port = port;
    this.server = http.createServer({}, this.app);
    this.router = router;
    this.io = new Server(
      this.server
      //   {
      //   cors: {
      //     origin: "*",
      //   },
      // }
    );
    this._configServer();
    this.codeQueue = new LightQueue(() => {});
    this.taskQueue = new LightQueue(async ({ tableName, tempCode }, error) => {
      console.log("SE PROCESO EL CAMBIO " + tempCode);
      // const session = await mongoose.startSession();
      if (tempCode != null) {
        if (!error) {
          await Change.deleteOne({ tempCode });
        }
        await this.updateProcessedTempCode(tempCode);
      }
      this.io.emit("serverChanged");
    });
  }
  _configServer() {
    this.app.use(express.json({ limit: "50mb" }));
    this.app.use((req, res, next) => {
      if (req.headers["x-forwarded-proto"] !== "https") {
        // Cloudflare establece este header
        return res.redirect(`https://${req.headers.host}${req.url}`);
      }
      next();
    });
    this.io.on("connection", (socket) => {
      console.log("Cliente conectado");
      socket.on("disconnect", () => {
        console.log("Cliente desconectado");
      });
    });
    this.app.use(express.static("public"));
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      res.locals.io = this.io;
      next();
    });
    this.app.set("view engine", "ejs");
    this.app.set("view engine", "html");
    this.app.engine("html", require("ejs").renderFile);
    this.router(this.app, this.auth);
    // this.app.post("/login", login_post);
    // this.app.get("/create", authController.create);
    // this.app.use("*", extractUser);
    this.app.post(
      "/change/list/unprocessed/delete",
      async (req, res, next) => {
        await this.auth(req, res, next, req.body.tableName, "write");
      },
      async (req, res) => {
        const tempCodes = req.body["tempCodes"];
        console.log("SE ELIMINARA LOS TEMP CODE => " + tempCodes);
        await Change.deleteMany({
          tableName: req.body.tableName,
          tempCode: { $in: tempCodes },
        });

        res.json({ status: "ok" });
      }
    );
    this.app.post(
      "/verify",
      async (req, res, next) => {
        await this.auth(req, res, next, "verify", "read");
      },
      async (req, res) => {
        const tableNames = req.body.tableNames;
        if (res.locals.verifyTables) {
          tableNames.filter((element) =>
            res.locals.verifyTables.includes(element)
          );
        }
        let syncMetadataList = await SyncMetadata.find({
          tableName: { $in: tableNames },
        });
        const foundNames = syncMetadataList.map(
          (syncMetadata) => syncMetadata.tableName
        );
        const notFoundNames = tableNames.filter(
          (tableName) => !foundNames.includes(tableName)
        );

        if (notFoundNames) {
          const newSyncMetadataList = await SyncMetadata.insertMany(
            notFoundNames.map((tableName) => ({
              tableName: tableName,
            }))
          );
          syncMetadataList = syncMetadataList.concat(newSyncMetadataList);
        }

        const syncMetadataMap = Object.fromEntries(
          syncMetadataList.map((syncMetadata) => [
            syncMetadata.tableName,
            syncMetadata.syncCodeMax,
          ])
        );
        const serverData = await ServerData.findOne();

        const unprocessedChanges = await Change.find({
          tempCode: { $lte: serverData.processedTempCode },
        }).lean();
        res.json({
          syncTable: syncMetadataMap,
          unprocessedChanges,
          serverData,
        });
      }
    );
  }
  syncPost({
    model,
    tableName,
    onInsertPrevious,
    onInsertAfter,
    onBeforeCreate,
    excludedFields = [],
    getSyncfindData,
  }) {
    let selectFields = excludedFields.map((field) => `-${field}`).join(" ");
    this.app.post(
      `/${tableName}/list/sync`,
      async (req, res, next) => {
        await this.auth(req, res, next, tableName, "read");
      },
      async (req, res, next) => {
        const task = async () => {
          try {
            let findData = {
              syncCode: { $gt: req.body["syncCodeMax"] },
              status: { $ne: "Deleted" },
              ...(getSyncfindData == null ? {} : getSyncfindData(req, res)),
              // userId: res.locals.user.userId,
            };

            let docs = await model
              .find(findData)
              .select(selectFields)
              .lean()
              .exec();

            let syncCodeMax;

            if (getSyncfindData != null) {
              syncCodeMax = await this.getCurrentSyncCode("movement");
              // console.log(
              //   "el syncodeMax es2222 ",
              //   syncCodeMax,
              //   "aa",
              //   tableName
              // );
            } else {
              syncCodeMax =
                docs.length == 0
                  ? 0
                  : Math.max(...docs.map((doc) => doc.syncCode));
              // console.log("el syncodeMax es ", syncCodeMax, "aa", tableName);
            }
            // console.log(
            //   "EL TAMAÑO DE LOS DOCS ES ",
            //   docs.length,
            //   "findata ",
            //   findData,
            //   " TABLENAME",
            //   tableName
            // );
            res.status(200).json({ docs: docs ?? [], syncCodeMax });
          } catch (error) {
            res.status(400).json({ error: error.message });
          }
        };
        if (getSyncfindData != null) {
          this.codeQueue.add({
            data: {},
            task,
          });
        } else {
          await task();
        }
      }
    );
    this.app.post(
      `/${tableName}/create`,
      async (req, res, next) => {
        await this.auth(req, res, next, tableName, "write");
      },
      async (req, res, next) => {
        try {
          if (onBeforeCreate) {
            await onBeforeCreate(req.body);
          }
          await this.createOrGet(model, tableName, uuidv7(), req.body);
          res.json({ msg: "ok" });
        } catch (error) {
          res.json({ error });
        }
      }
    );
    this.app.post(
      `/${tableName}/update/list/sync`,
      async (req, res, next) => {
        await this.auth(req, res, next, tableName, "write");
      },
      async (req, res, next) => {
        this.codeQueue.add({
          data: {},
          task: async () => {
            try {
              const tempCode = await this.updateAndGetTempCode();
              console.log("DEVOLVIENDO EL TEMP CODE QUEUE => " + tempCode);
              const change = new Change({
                tableName: tableName,
                tempCode,
                status: "inserted",
              });
              await change.save();
              this.addTaskDataInQueue(
                model,
                tableName,
                req.body["docs"],
                tempCode,
                onInsertPrevious,
                onInsertAfter
                // res.locals.user.userId
              );
              res.status(200).json({ tempCode });
            } catch (error) {
              res.status(400).json({ error: error.message });
            }
          },
        });
      }
    );
  }
  addTaskDataInQueue(
    Model,
    tableName,
    docs,
    tempCode,
    onInsertPrevious,
    onInsertAfter
  ) {
    this.taskQueue.add({
      data: {
        tempCode,
        tableName,
      },
      onInsertAfter,
      task: async () => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          if (onInsertPrevious) {
            await onInsertPrevious({
              docs,
              session,
              createOrGet: this._createOrGet,
            });
          }
          const newDocs = await this.localToServer(
            Model,
            tableName,
            docs,
            session
          );
          await session.commitTransaction();

          return newDocs;
        } catch (error) {
          await session.abortTransaction();
          console.error("Error en la transacción, se ha revertido:", error);
        } finally {
          await session.endSession();
        }
      },
    });
  }
  async localToServer(Model, tableName, docs, session) {
    //mandar error por documento repetido
    // const fieldSyncCodes = {};
    // for (const field of Object.keys(docs[0])) {
    //   if (field.endsWith("UpdatedAt")) {
    //     continue;
    //   }
    //   fieldSyncCodes[field + "SyncCode"] = 1;
    // }
    const newDocs = [];
    const syncCode = await this.updateAndGetSyncCode(tableName, session);
    let set = new Set();

    for (let d of docs) {
      set.add(d.uuid);
      d.syncCode = syncCode;
      // d.userId = userId;
    }
    const serverDocs = await Model.find({
      uuid: { $in: Array.from(set) },
    });
    const serverDocsMap = new Map();
    for (const sd of serverDocs) {
      serverDocsMap.set(sd.uuid, sd);
    }
    let deleteDocs = [];
    for (const d of docs) {
      const serverDoc = serverDocsMap.get(d.uuid);
      // console.log(
      //   "SE RECIBIO EN EL SERVIDOR EL INSERTEDAT : " + d["insertedAt"]
      // );
      // console.log(
      //   "se analiza el doc local " +
      //     inspect(d) +
      //     " con el server " +
      //     inspect(serverDoc)
      // );

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
        console.log(
          "EL LOCAL ES FIELD:" +
            key +
            " VALUE: " +
            d[key] +
            "  : " +
            localDate +
            " el server es " +
            serverDate
        );
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
    await Model.bulkWrite(
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

  async start({ exec } = {}) {
    this.syncPost({ model: ServerData, tableName: "serverData" });

    await mongoose.connect(this.mongoURL, {
      autoIndex: true,
      maxPoolSize: 50,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 30000,
    });
    const syncCodeMax = await this.updateAndGetSyncCode("serverData");
    // console.log("EL MAXIMO CODIGO ES " + syncCodeMax);
    await ServerData.findOneAndUpdate(
      { uuid: "momo" },
      {
        $set: { syncCode: syncCodeMax },
        $inc: { restartCounter: 1 },
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
        context: "query",
      }
    );

    const tempCode = await this.updateAndGetTempCode();
    await this.updateProcessedTempCode(tempCode);
    if (exec != null) {
      await exec();
    }
    this.server.listen(this.port, () => {
      console.log("SERVER ACTIVO: PUERTO USADO :" + this.port);
    });
  }
  async updateProcessedTempCode(tempCode) {
    await ServerData.findOneAndUpdate(
      {},
      { processedTempCode: tempCode },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  async updateAndGetTempCode() {
    const serverData = await ServerData.findOneAndUpdate(
      {},
      {
        $inc: {
          tempCodeMax: 1,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return serverData.tempCodeMax;
  }
  async getCurrentSyncCode(tableName) {
    let syncCodeTable = await SyncMetadata.findOne({ tableName });
    return syncCodeTable?.syncCodeMax ?? 0;
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
  async createOrGet(Model, tableName, uuid, data) {
    return new Promise((resolve, reject) => {
      this.taskQueue.add({
        data: { tableName },
        task: async () => {
          const session = await mongoose.startSession();
          session.startTransaction();
          try {
            const docDB = await this._createOrGet(
              Model,
              tableName,
              uuid,
              data,
              session
            );
            await session.commitTransaction();
            resolve(docDB);
          } catch (error) {
            reject(error);
            await session.abortTransaction();
            console.error("Error en la transacción, se ha revertido:", error);
          } finally {
            await session.endSession();
          }
        },
      });
    });
  }

  _createOrGet = async (
    Model,
    tableName,
    uuid,
    data,
    session,
    onExistDocument
  ) => {
    let docDB = await Model.findOne({ uuid });
    if (!docDB) {
      data.syncCode = await this.updateAndGetSyncCode(tableName, session);
      docDB = await Model.findOneAndUpdate(
        { uuid },
        { $set: data },
        { session, new: true, upsert: true, setDefaultsOnInsert: true }
      );
    }

    return docDB;
  };
  async updateFields(Model, tableName, uuid, data) {
    return new Promise((resolve, reject) => {
      this.taskQueue.add({
        data: { tableName },
        task: async () => {
          const session = await mongoose.startSession();
          session.startTransaction();
          try {
            await this._updateFields(Model, tableName, uuid, data, session);
            await session.commitTransaction();
            resolve();
          } catch (error) {
            reject(error);
            await session.abortTransaction();
            console.error("Error en la transacción, se ha revertido:", error);
          } finally {
            await session.endSession();
          }
        },
      });
    });
  }
  async _updateFields(Model, tableName, uuid, data, session) {
    const keys = Object.keys(data);
    for (let key of keys) {
      data[`${key}UpdatedAt`] = new Date().getTime();
    }
    const newSyncCode = await this.updateAndGetSyncCode(tableName, session);
    data.syncCode = newSyncCode;
    await Model.updateOne(
      { uuid },
      {
        $set: data,
      }
    );
    return newSyncCode;
  }
}

module.exports.SyncServer = new SyncServer();

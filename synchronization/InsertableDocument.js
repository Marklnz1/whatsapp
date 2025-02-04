class InsertableDocument {
  constructor({ tempCode, filter, doc, insertOnlyIfNotExist = false }) {
    this.tempCode = tempCode;
    this.filter = filter;
    this.completeFieldsToInsert(doc);
    this.doc = doc;
    this.insertOnlyIfNotExist = insertOnlyIfNotExist;
  }

  completeFieldsToInsert(fields) {
    // if (!fields.insertedAt) {
    //   fields.insertedAt = new Date().getTime();
    // }
    if (!fields.uuid) {
      fields.uuid = uuidv7();
    }
    for (const key in fields) {
      if (
        key == "uuid" ||
        key == "insertedAt" ||
        key.endsWith("UpdatedAt") ||
        fields[key] == null ||
        fields[`${key}UpdatedAt`] != null
      ) {
        if (fields[key] == null && !key.endsWith("UpdatedAt")) {
          delete d[key];
          delete d[`${key}UpdatedAt`];
        }
        continue;
      }
      fields[`${key}UpdatedAt`] = new Date().getTime();
    }
    return fields;
  }
}

module.exports = InsertableDocument;

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
        continue;
      }
      fields[`${key}UpdatedAt`] = new Date().getTime();
    }
    return fields;
  }
}

module.exports = InsertableDocument;

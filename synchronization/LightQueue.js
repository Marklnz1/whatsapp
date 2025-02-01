class LightQueue {
  constructor(onEndTask) {
    this.onEndTask = onEndTask;
    this.queue = [];
    this.isProcessing = false;
  }

  add(task) {
    this.queue.push(task);
    if (!this.isProcessing) {
      this.process();
    }
  }

  async process() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const { task, data, onInsertAfter } = this.queue.shift();
    let newDocs;
    let executeInsertAfter = true;
    try {
      newDocs = await task();
      if (newDocs && onInsertAfter) {
        onInsertAfter(newDocs);
      }
      executeInsertAfter = false;
      await this.onEndTask(data, false);
    } catch (err) {
      console.error("Error processing task:", err);
      await this.onEndTask(data, true);
      executeInsertAfter = false;
    }
    if (executeInsertAfter && newDocs && onInsertAfter) {
      onInsertAfter(newDocs);
    }
    setImmediate(() => this.process());
  }
}

module.exports = LightQueue;

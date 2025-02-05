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
    const task = this.queue.shift();

    const response = await task();

    if (this.onEndTask != null) {
      await this.onEndTask(response ?? {});
    }
    setImmediate(() => this.process());
  }
}

module.exports = LightQueue;

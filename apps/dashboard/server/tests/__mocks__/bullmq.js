// Minimal BullMQ test stub for Vitest. Provides Queue and Worker with no-ops.
class Queue {
  constructor(name, opts) {
    this.name = name;
    this.opts = opts;
  }
  // mimic add API but do nothing
  async add() { return { id: 'mock-job' }; }
  async close() { /* no-op */ }
}

class Worker {
  constructor(name, processor, opts) {
    this.name = name;
    this.processor = processor;
    this.opts = opts;
    this._listeners = {};
  }
  on(event, handler) {
    this._listeners[event] = handler;
    return this;
  }
  async close() { /* no-op */ }
}

export { Queue, Worker };

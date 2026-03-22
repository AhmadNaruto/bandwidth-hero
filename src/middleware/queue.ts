// Queue management for upstream requests

interface QueueEntry {
  resolve: () => void;
  reject: (error: Error) => void;
  addedAt: number;
  abortSignal: AbortSignal;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface Worker {
  id: number;
  busy: boolean;
  lastRequestTime: number;
  requestsProcessed: number;
}

interface QueueMetrics {
  totalProcessed: number;
  totalTimeouts: number;
  totalAborted: number;
  totalRejected: number;
  averageWaitTime: number;
  lastWaitTime: number;
  maxWaitTime: number;
}

interface QueueOptions {
  enabled: boolean;
  workerCount: number;
  workerMinDelay: number;
  workerMaxDelay: number;
  queueMaxSize: number;
  queueTimeout: number;
}

export class RequestQueue {
  private queue: QueueEntry[] = [];
  private workers: Worker[] = [];
  private metrics: QueueMetrics = {
    totalProcessed: 0,
    totalTimeouts: 0,
    totalAborted: 0,
    totalRejected: 0,
    averageWaitTime: 0,
    lastWaitTime: 0,
    maxWaitTime: 0,
  };
  private options: QueueOptions;

  constructor(options: QueueOptions) {
    this.options = options;
    for (let i = 0; i < options.workerCount; i++) {
      this.workers.push({
        id: i,
        busy: false,
        lastRequestTime: 0,
        requestsProcessed: 0,
      });
    }
  }

  async enqueue(abortSignal: AbortSignal): Promise<void> {
    if (!this.options.enabled) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      if (this.queue.length >= this.options.queueMaxSize) {
        this.metrics.totalRejected++;
        reject(new Error("Queue full - too many requests"));
        return;
      }

      const timeoutId = setTimeout(() => {
        const index = this.queue.findIndex((entry) => entry.timeoutId === timeoutId);
        if (index > -1) {
          this.queue.splice(index, 1);
          this.metrics.totalTimeouts++;
          reject(new Error("Queue timeout - request took too long"));
        }
      }, this.options.queueTimeout);

      const queueEntry: QueueEntry = {
        resolve,
        reject,
        addedAt: Date.now(),
        abortSignal,
        timeoutId,
      };

      this.queue.push(queueEntry);
      this.assignToWorker();
    });
  }

  private findAvailableWorker(): Worker | undefined {
    return this.workers.find((worker) => !worker.busy);
  }

  private async assignToWorker(): Promise<void> {
    if (this.queue.length === 0) return;

    const worker = this.findAvailableWorker();
    if (!worker) return;

    const entry = this.queue[0];

    if (entry.abortSignal.aborted) {
      this.queue.shift();
      clearTimeout(entry.timeoutId);
      this.metrics.totalAborted++;
      entry.reject(new Error("Request aborted"));
      return;
    }

    const waitTime = Date.now() - entry.addedAt;
    if (waitTime >= this.options.queueTimeout) {
      this.queue.shift();
      clearTimeout(entry.timeoutId);
      this.metrics.totalTimeouts++;
      entry.reject(new Error("Queue timeout"));
      return;
    }

    const timeSinceLastRequest = Date.now() - worker.lastRequestTime;
    const minDelay = this.options.workerMinDelay;
    const maxDelay = this.options.workerMaxDelay;
    const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

    if (timeSinceLastRequest < randomDelay) {
      const sleepTime = randomDelay - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, sleepTime));
    }

    this.queue.shift();
    clearTimeout(entry.timeoutId);

    worker.busy = true;
    worker.lastRequestTime = Date.now();

    const actualWaitTime = Date.now() - entry.addedAt;
    this.metrics.totalProcessed++;
    this.metrics.lastWaitTime = actualWaitTime;
    this.metrics.maxWaitTime = Math.max(this.metrics.maxWaitTime, actualWaitTime);
    this.metrics.averageWaitTime = Math.round(
      (this.metrics.averageWaitTime * (this.metrics.totalProcessed - 1) + actualWaitTime) /
        this.metrics.totalProcessed
    );

    entry.resolve();

    setTimeout(() => {
      worker.busy = false;
      worker.requestsProcessed++;
      this.assignToWorker();
    }, 100);

    this.assignToWorker();
  }

  getStatus() {
    const busyWorkers = this.workers.filter((w) => w.busy).length;
    return {
      queue: {
        size: this.queue.length,
      },
      workers: this.workers.map((w) => ({
        id: w.id,
        busy: w.busy,
        requestsProcessed: w.requestsProcessed,
      })),
      limits: {
        workerCount: this.options.workerCount,
        minDelay: this.options.workerMinDelay,
        maxDelay: this.options.workerMaxDelay,
        maxSize: this.options.queueMaxSize,
        timeout: this.options.queueTimeout,
      },
      metrics: { ...this.metrics },
      enabled: this.options.enabled,
    };
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getActiveWorkers(): number {
    return this.workers.filter((w) => w.busy).length;
  }
}

export default RequestQueue;

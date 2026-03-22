// Type definitions for Bandwidth Hero Proxy

export interface ProxyQuery {
  url: string;
  jpeg?: string;
  bw?: string;
  l?: string;
}

export interface CompressionOptions {
  isWebp: boolean;
  isGrayscale: boolean;
  quality: number;
}

export interface UpstreamResponse {
  buffer: Buffer;
  contentType: string;
  contentLength: number;
  upstreamHeaders: Record<string, string>;
}

export interface CompressionResult {
  err: Error | null;
  headers: Record<string, string> | null;
  output: Buffer | null;
}

export interface QueueMetrics {
  totalProcessed: number;
  totalTimeouts: number;
  totalAborted: number;
  totalRejected: number;
  averageWaitTime: number;
  lastWaitTime: number;
  maxWaitTime: number;
}

export interface WorkerStatus {
  id: number;
  busy: boolean;
  requestsProcessed: number;
}

export interface QueueStatus {
  size: number;
  workers: WorkerStatus[];
  limits: {
    workerCount: number;
    minDelay: number;
    maxDelay: number;
    maxSize: number;
    timeout: number;
  };
  metrics: QueueMetrics;
  enabled: boolean;
}

export interface HealthStatus {
  status: "ok" | "busy" | "degraded";
  uptime: number;
  queue: {
    size: number;
    workers: {
      total: number;
      busy: number;
      available: number;
    };
    metrics: QueueMetrics;
  };
  activeRequests: number;
  timestamp: string;
}

// Logger - Structured JSON logging for Elysia

const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3, TRACE: 4 } as const;

type LogLevel = keyof typeof LOG_LEVELS;

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  [key: string]: string | number | object;
}

// In-memory buffer for monitor (last 100 entries)
const logBuffer: LogEntry[] = [];
const MAX_BUFFER_SIZE = 100;

// Callback for monitor route
let onLogCallback: ((log: LogEntry) => void) | null = null;

export function setLogCallback(callback: (log: LogEntry) => void) {
  onLogCallback = callback;
}

export function getLogBuffer(): LogEntry[] {
  return logBuffer;
}

export function addLogToBuffer(log: LogEntry) {
  logBuffer.push(log);
  if (logBuffer.length > MAX_BUFFER_SIZE) {
    logBuffer.shift();
  }
  if (onLogCallback) {
    onLogCallback(log);
  }
}

const writeLog = (logEntry: LogEntry) => {
  Bun.stdout.write(JSON.stringify(logEntry) + "\n");
  
  // Add to buffer for monitor
  addLogToBuffer(logEntry);
};

export class Logger {
  private level: LogLevel;
  private enabled: boolean;
  private currentLevel: number;

  constructor(level: LogLevel = "INFO", enabled: boolean = true) {
    this.level = level;
    this.enabled = enabled;
    this.currentLevel = LOG_LEVELS[this.level] || LOG_LEVELS.INFO;
  }

  formatBytes(bytes: number, decimals: number = 2): string {
    const value = Number(bytes);
    if (!isFinite(value) || value === 0) return "0 Bytes";

    const dm = decimals < 0 ? 0 : decimals;
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(Math.abs(value)) / Math.log(k));

    return `${(Math.abs(value) / Math.pow(k, i)).toFixed(dm)} ${sizes[i]}`;
  }

  private isEnabled(level: LogLevel): boolean {
    return this.enabled && LOG_LEVELS[level] <= this.currentLevel;
  }

  private log(level: LogLevel, message: string, metadata: Record<string, unknown> = {}) {
    if (!this.isEnabled(level)) return;

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...metadata,
    };
    writeLog(logEntry);
  }

  error(message: string, metadata: Record<string, unknown> = {}) {
    return this.log("ERROR", message, metadata);
  }

  warn(message: string, metadata: Record<string, unknown> = {}) {
    return this.log("WARN", message, metadata);
  }

  info(message: string, metadata: Record<string, unknown> = {}) {
    return this.log("INFO", message, metadata);
  }

  debug(message: string, metadata: Record<string, unknown> = {}) {
    return this.log("DEBUG", message, metadata);
  }

  trace(message: string, metadata: Record<string, unknown> = {}) {
    return this.log("TRACE", message, metadata);
  }

  logCompressionProcess(details: {
    url?: string;
    originalSize?: number;
    compressedSize?: number;
    bytesSaved?: number;
    quality?: number;
    format?: string;
    error?: Error | null;
  }) {
    const { url, originalSize, compressedSize, bytesSaved, quality, format, error } = details;

    if (error) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: "WARN" as const,
        message: "Failed Compress",
        url: this.truncateUrl(url),
        originalSize: this.formatBytes(originalSize || 0),
        error: error.message || String(error),
      };
      addLogToBuffer(logEntry);
      this.warn("Failed Compress", {
        url: this.truncateUrl(url),
        originalSize: this.formatBytes(originalSize || 0),
        error: error.message || String(error),
      });
    } else {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: "INFO" as const,
        message: "Image Zip",
        savings: this.formatBytes(bytesSaved || 0),
        percent: originalSize && compressedSize
          ? `${((originalSize - compressedSize) / originalSize * 100).toFixed(1)}%`
          : "Unknown",
        quality: quality || 0,
        format: format || "Unknown",
      };
      addLogToBuffer(logEntry);
      this.info("Image Zip", {
        savings: this.formatBytes(bytesSaved || 0),
        percent: originalSize && compressedSize
          ? `${((originalSize - compressedSize) / originalSize * 100).toFixed(1)}%`
          : "Unknown",
        quality,
        format: format || "Unknown",
      });
    }
  }

  logRequest(details: {
    url?: string;
    userAgent?: string;
    referer?: string;
    ip?: string;
    jpeg?: string;
    bw?: string;
    quality?: number;
    contentType?: string;
  }) {
    const { url, userAgent, referer, ip, jpeg, bw, quality, contentType } = details;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: "DEBUG" as const,
      message: "Request received",
      url: this.truncateUrl(url),
      client: {
        ip: ip || "Unknown",
        userAgent: this.truncateString(userAgent, 100),
        referer: referer || "Direct",
      },
      compressionOptions: {
        forceJpeg: !!jpeg,
        grayscale: !!bw,
        quality: quality || 0,
      },
      contentType: contentType || "Unknown",
    };
    addLogToBuffer(logEntry);
    this.debug("Request received", {
      url: this.truncateUrl(url),
      client: {
        ip: ip || "Unknown",
        userAgent: this.truncateString(userAgent, 100),
        referer: referer || "Direct",
      },
      compressionOptions: {
        forceJpeg: !!jpeg,
        grayscale: !!bw,
        quality: quality || 0,
      },
      contentType: contentType || "Unknown",
    });
  }

  logBypass(details: { url?: string; size?: number; reason?: string }) {
    const { url, size, reason } = details;
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: "INFO" as const,
      message: "Bypassing",
      url: this.truncateUrl(url),
      size: this.formatBytes(size || 0),
      reason: reason || "Unknown",
    };
    addLogToBuffer(logEntry);
    this.info("Bypassing", {
      url: this.truncateUrl(url),
      size: this.formatBytes(size || 0),
      reason: reason || "Unknown",
    });
  }

  logUpstreamFetch(details: { url?: string; statusCode?: string | number; success: boolean }) {
    const { url, statusCode, success } = details;
    const level: LogLevel = success ? "INFO" : "WARN";
    const message = success ? "Get Image Ok" : "Get Image Err";
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      url: this.truncateUrl(url, 20),
      statusCode: statusCode || "Unknown",
    };
    addLogToBuffer(logEntry);
    this.log(level, message, {
      url: this.truncateUrl(url, 20),
      statusCode: statusCode || "Unknown",
    });
  }

  private truncateUrl(url: string | undefined, maxLength: number = 20): string {
    return url && url.length > maxLength ? `${url.substring(0, maxLength - 3)}...` : url || "Unknown";
  }

  private truncateString(str: string | undefined, maxLength: number = 30): string {
    return str && str.length > maxLength ? `${str.substring(0, maxLength - 3)}...` : str || "Unknown";
  }
}

// Singleton instance
export const logger = new Logger(
  (process.env.LOG_LEVEL as LogLevel) || "INFO",
  process.env.LOG_ENABLED !== "false"
);

export default logger;

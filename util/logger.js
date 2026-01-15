// logger.js - REFACTORED: More concise and LSP-friendly version

const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3, TRACE: 4 };

class Logger {
  constructor(level = "INFO", enabled = true) {
    this.level = level.toUpperCase();
    this.enabled = enabled;
    this.currentLevel = LOG_LEVELS[this.level] || LOG_LEVELS.INFO;
  }

  formatBytes(bytes, decimals = 2) {
    const value = Number(bytes);
    if (!isFinite(value) || value === 0) return "0 Bytes";
    
    const dm = decimals < 0 ? 0 : decimals;
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(Math.abs(value)) / Math.log(k));
    
    return `${(Math.abs(value) / Math.pow(k, i)).toFixed(dm)} ${sizes[i]}`;
  }

  isEnabled(level) {
    return this.enabled && LOG_LEVELS[level] <= this.currentLevel;
  }

  _log(level, message, metadata = {}) {
    if (!this.isEnabled(level)) return;
    console.log(`${message}: ${JSON.stringify(metadata)}`);
  }

  // Public logging methods
  error = (message, metadata = {}) => this._log("ERROR", message, metadata);
  warn = (message, metadata = {}) => this._log("WARN", message, metadata);
  info = (message, metadata = {}) => this._log("INFO", message, metadata);
  debug = (message, metadata = {}) => this._log("DEBUG", message, metadata);
  trace = (message, metadata = {}) => this._log("TRACE", message, metadata);

  // Specialized loggers
  logCompressionProcess = (details = {}) => {
    const { url, originalSize, compressedSize, bytesSaved, quality, format, error = null } = details;
    
    if (error) {
      this.warn("Failed Compress: ", {
        url: this.truncateUrl(url),
        originalSize: this.formatBytes(originalSize),
        error: error.message || String(error),
      });
    } else {
      this.info("Image Zip: ", {
        savings: this.formatBytes(bytesSaved),
        percent: originalSize && compressedSize
          ? `${((originalSize - compressedSize) / originalSize * 100).toFixed(1)}%`
          : "Unknown",
        quality,
        format: format || "Unknown",
      });
    }
  };

  logRequest = (requestDetails = {}) => {
    const { url, userAgent, referer, ip, jpeg, bw, quality, contentType } = requestDetails;
    
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
        quality: quality || 40,
      },
      contentType: contentType || "Unknown",
    });
  };

  logBypass = (bypassDetails = {}) => {
    const { url, size, reason } = bypassDetails;
    this.info("Bypassing: ", {
      url: this.truncateUrl(url),
      size: this.formatBytes(size),
      reason: reason || "Unknown",
    });
  };

  logUpstreamFetch = (fetchDetails = {}) => {
    const { url, statusCode, success } = fetchDetails;
    const level = success ? "INFO" : "WARN";
    this._log(level, success ? "Get Image Ok: " : "Get Image Err", {
      url: this.truncateUrl(url, 20),
      statusCode: statusCode || "Unknown",
    });
  };

  // Helper methods
  truncateUrl = (url, maxLength = 20) => 
    url && url.length > maxLength ? `${url.substring(0, maxLength - 3)}...` : url || "Unknown";

  truncateString = (str, maxLength = 30) => 
    str && str.length > maxLength ? `${str.substring(0, maxLength - 3)}...` : str || "Unknown";
}

// Singleton instance
const logger = new Logger(
  process.env.LOG_LEVEL || "INFO",
  process.env.LOG_ENABLED !== "false"
);

export default logger;
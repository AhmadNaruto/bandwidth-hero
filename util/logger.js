/**
 * Modern structured logger for bandwidth-hero compression service
 * Provides clean, structured logging of the compression process
 */
class Logger {
	constructor(level = "info", enabled = true) {
		this.level = level;
		this.enabled = enabled;
		this.levels = {
			error: 0,
			warn: 1,
			info: 2,
			debug: 3,
			trace: 4,
		};
	}
	bytesToMB(bytes, decimals = 1) {
		bytes === 0
			? "0MB"
			: `${parseFloat((bytes / (1024 * 1024)).toFixed(decimals))}MB`;
	}

	isEnabled(level) {
		return this.enabled && this.levels[level] <= this.levels[this.level];
	}

	_log(level, message, meta = {}) {
		if (!this.isEnabled(level)) return;

		const timestamp = new Date().toISOString();
		const logEntry = {
			timestamp,
			level,
			message,
			...meta,
		};

		console.log(JSON.stringify(logEntry));
	}

	error(message, meta = {}) {
		this._log("error", message, meta);
	}

	warn(message, meta = {}) {
		this._log("warn", message, meta);
	}

	info(message, meta = {}) {
		this._log("info", message, meta);
	}

	debug(message, meta = {}) {
		this._log("debug", message, meta);
	}

	trace(message, meta = {}) {
		this._log("trace", message, meta);
	}

	/**
	 * Log compression process details
	 * ==== PERBAIKAN: Tambahkan transmittedSize untuk monitoring overhead base64 ====
	 */
	logCompressionProcess(details) {
		const {
			url,
			// originalSize,
			// compressedSize,
			// format,
			quality,
			// grayscale,
			// compressionRatio,
			bytesSaved,
			// processingTime,
			// transmittedSize, // Ukuran base64 yang ditransmisikan
			error = null,
		} = details;

		if (error) {
			this.warn("Failed: ", {
				url,
				// originalSize,
				error: error.message || error,
				// processingTime
			});
		} else {
			this.info("Success: ", {
				// url,
				// originalSize,
				// compressedSize,
				// transmittedSize, // Log ukuran aktual yang ditransmisikan
				// format,
				quality,
				// grayscale,
				// compressionRatio: parseFloat(compressionRatio.toFixed(2)),
				bytesSaved: this.bytesToMB(bytesSaved),
				// processingTime,
				// overheadPercentage: transmittedSize ? ((transmittedSize - compressedSize) / compressedSize * 100).toFixed(1) : 0
			});
		}
	}

	/**
	 * Log request details
	 */
	logRequest(requestDetails) {
		const { url, userAgent, referer, ip, jpeg, bw, quality, contentType } =
			requestDetails;

		this.debug("REQUEST: ", {
			url,
			userAgent: `${userAgent?.substring(0, 50)}...` || "unknown", // Truncate long user agents
			referer: referer || "direct",
			ip: ip || "unknown",
			options: {
				jpeg: !!jpeg,
				grayscale: !!bw,
				quality: quality || 40,
			},
			contentType,
		});
	}

	/**
	 * Log bypass decisions
	 */
	logBypass(bypassDetails) {
		const { url, size, reason } = bypassDetails;

		this.info("BYPASS: ", {
			url,
			size,
			// contentType,
			reason,
		});
	}

	/**
	 * Log upstream fetch results
	 */
	logUpstreamFetch(fetchDetails) {
		const {
			url,
			statusCode,
			// contentType,
			// contentLength,
			//fetchTime,
			success,
		} = fetchDetails;

		if (success) {
			this.debug("FETCH OK: ", {
				url,
				statusCode,
				// contentType,
				// contentLength,
				// fetchTime,
			});
		} else {
			this.warn("FETCH FAIL: ", {
				url,
				statusCode,
				// fetchTime,
			});
		}
	}
}

// Create a global logger instance
const logger = new Logger(
	process.env.LOG_LEVEL || "info",
	process.env.LOG_ENABLED !== "false",
);

module.exports = logger;

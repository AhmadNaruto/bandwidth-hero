/**
 * logger.js - OPTIMIZED: Structured logging with improved error handling and performance
 */

// Log level configuration
const LOG_LEVELS = {
	ERROR: 0,
	WARN: 1,
	INFO: 2,
	DEBUG: 3,
	TRACE: 4,
};

// Log level names for output
const LEVEL_NAMES = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];

class Logger {
	constructor(level = "INFO", enabled = true) {
		this.level = level.toUpperCase();
		this.enabled = enabled;
		this.currentLevel = LOG_LEVELS[this.level] || LOG_LEVELS.INFO;
	}

	/**
	 * Mengubah jumlah byte menjadi format yang mudah dibaca (KB, MB, GB, dll.).
	 * @param {string|number} vbytes Jumlah byte yang akan diformat.
	 * @param {number} [decimals=2] Jumlah angka desimal yang diinginkan.
	 * @returns {string} String yang diformat (misalnya: "10.50 MB").
	 */
	formatBytes(vbytes, decimals = 2) {
		// 1. Pastikan input adalah bilangan bulat yang valid.
		// Gunakan Number() untuk mengonversi jika vbytes adalah string
		// dan pastikan nilainya bukan NaN dan bukan null/undefined.
		const bytes = Number(vbytes);

		// 2. Cek untuk input yang tidak valid atau nol.
		// Math.abs() memastikan ia bekerja untuk angka negatif juga, meskipun byte jarang negatif.
		if (!isFinite(bytes) || bytes === 0) {
			return "0 Bytes";
		}

		// 3. Pastikan desimal adalah non-negatif
		const dm = decimals < 0 ? 0 : decimals;
		const k = 1024;
		const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

		// 4. Hitung indeks basis (i)
		// Gunakan Math.max untuk memastikan indeks minimal 0 (untuk Bytes) jika nilainya sangat kecil (< 1)
		const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));

		// 5. Hitung nilai yang telah diubah
		const formattedValue = Math.abs(bytes) / Math.pow(k, i);

		// 6. Format ke string dengan desimal yang ditentukan.
		// toFixed(dm) akan mengembalikan string, jadi kita perlu parseFloat lagi jika ingin menghilangkan trailing zeros.
		// Namun, dalam konteks formatting, toFixed(dm) seringkali sudah cukup.
		// Jika ingin lebih presisi, gunakan Number(formattedValue).toFixed(dm)

		// Perbaikan utama: Menggunakan toFixed(dm) untuk memastikan konsistensi desimal.
		return `${Number(formattedValue).toFixed(dm)} ${sizes[i]}`;
	}

	/**
	 * Check if logging is enabled for a specific level
	 */
	isEnabled(level) {
		return this.enabled && LOG_LEVELS[level] <= this.currentLevel;
	}

	/**
	 * Core logging method
	 */
	_log(level, message, metadata = {}) {
		if (!this.isEnabled(level)) return;

		// const timestamp = new Date().toISOString();
		//const logEntry = {
		//timestamp,
		// level: level.toUpperCase(),
		//   message,
		//  ...metadata
		//};

		// console.log(JSON.stringify(logEntry));
		console.log(`${message}: ${JSON.stringify(metadata)}`);
	}

	// Public logging methods
	error(message, metadata = {}) {
		this._log("ERROR", message, metadata);
	}

	warn(message, metadata = {}) {
		this._log("WARN", message, metadata);
	}

	info(message, metadata = {}) {
		this._log("INFO", message, metadata);
	}

	debug(message, metadata = {}) {
		this._log("DEBUG", message, metadata);
	}

	trace(message, metadata = {}) {
		this._log("TRACE", message, metadata);
	}

	/**
	 * Log compression process details
	 */
	logCompressionProcess(details = {}) {
		const {
			url,
			originalSize,
			compressedSize,
			bytesSaved,
			quality,
			format,
			error = null,
			// processingTime
		} = details;

		if (error) {
			this.warn("Failed Compress: ", {
				url: url ? this.truncateUrl(url) : "Unknown",
				originalSize: originalSize ? this.formatBytes(originalSize) : "Unknown",
				error: error.message || String(error),
				// processingTime
			});
		} else {
			this.info("Image Zip: ", {
				/** originalSize: originalSize ? this.formatBytes(originalSize) : "Unknown",
				compressedSize: compressedSize
					? this.formatBytes(compressedSize)
					: "Unknown", */
				savings: bytesSaved ? this.formatBytes(bytesSaved) : "Unknown",
				percent:
					originalSize && compressedSize
						? (((originalSize - compressedSize) / originalSize) * 100).toFixed(
								1,
							) + "%"
						: "Unknown",
				quality,
				format: format || "Unknown",
				// processingTime
			});
		}
	}

	/**
	 * Log request details
	 */
	logRequest(requestDetails = {}) {
		const { url, userAgent, referer, ip, jpeg, bw, quality, contentType } =
			requestDetails;

		this.debug("Request received", {
			url: url ? this.truncateUrl(url) : "Unknown",
			client: {
				ip: ip || "Unknown",
				userAgent: userAgent ? this.truncateString(userAgent, 100) : "Unknown",
				referer: referer || "Direct",
			},
			compressionOptions: {
				forceJpeg: !!jpeg,
				grayscale: !!bw,
				quality: quality || 40,
			},
			contentType: contentType || "Unknown",
		});
	}

	/**
	 * Log bypass decisions
	 */
	logBypass(bypassDetails = {}) {
		const { url, size, reason } = bypassDetails;

		this.info("Bypassing: ", {
			url: url ? this.truncateUrl(url) : "Unknown",
			size: size ? this.formatBytes(size) : "Unknown",
			reason: reason || "Unknown",
		});
	}

	/**
	 * Log upstream fetch results
	 */
	logUpstreamFetch(fetchDetails = {}) {
		const {
			url,
			statusCode,
			success,
			// fetchTime,
			// size
		} = fetchDetails;

		const level = success ? "INFO" : "WARN";
		this._log(level, success ? "Get Image Ok: " : "Get Image Err", {
			url: url ? this.truncateUrl(url, 20) : "Unknown",
			statusCode: statusCode || "Unknown",
			// size: size ? this.formatBytes(size) : 'Unknown',
			// fetchTime: fetchTime ? `${fetchTime}ms` : 'Unknown'
		});
	}

	/**
	 * Helper: Truncate URL for logging
	 */
	truncateUrl(url, maxLength = 20) {
		if (!url || url.length <= maxLength) return url;
		return url.substring(0, maxLength - 3) + "...";
	}

	/**
	 * Helper: Truncate string for logging
	 */
	truncateString(str, maxLength = 30) {
		if (!str || str.length <= maxLength) return str;
		return str.substring(0, maxLength - 3) + "...";
	}
}

// Create singleton instance
const logger = new Logger(
	process.env.LOG_LEVEL || "INFO",
	process.env.LOG_ENABLED !== "false",
);

export default logger;

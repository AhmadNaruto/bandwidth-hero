// compress.js - OPTIMIZED: Enhanced structure, error handling, and compression logic
// compress.js - OPTIMIZED: Enhanced structure, error handling, and compression logic

const sharp = require("sharp");
const logger = require("./logger");

// Configuration constants
const CONFIG = {
	MAX_WIDTH: 480,
	MAX_JPEG_HEIGHT: 32767, // Sharp's JPEG height limit
	MAX_WEBP_HEIGHT: 16383, // WebP height limit
	MAX_INPUT_PIXELS: 268402689, // ~100MP limit
	GRAYSCALE_QUALITY_RANGE: { min: 10, max: 40 },
	DEFAULT_DIMENSIONS: { width: 480, height: 480 },
	DEFAULT_FORMAT: "webp",
};

async function compress(imagePath, useWebp, grayscale, quality, originalSize) {
	try {
		// 1. SAFE METADATA EXTRACTION
		const metadata = await getImageMetadata(imagePath);

		// 2. DIMENSION CALCULATION
		const { width: calculatedWidth, height: calculatedHeight } =
			calculateDimensions(metadata, CONFIG.MAX_WIDTH);

		// 3. FORMAT SELECTION
		const finalFormat = selectFormat(useWebp, calculatedHeight, CONFIG);

		// 4. QUALITY OPTIMIZATION
		const effectiveQuality = grayscale
			? Math.max(
					CONFIG.GRAYSCALE_QUALITY_RANGE.min,
					Math.min(quality, CONFIG.GRAYSCALE_QUALITY_RANGE.max),
				)
			: quality;

		logger.debug("Compression started", {
			originalSize,
			effectiveQuality,
			grayscale,
			calculatedDimensions: {
				width: calculatedWidth,
				height: calculatedHeight,
			},
			format: finalFormat,
		});

		// 5. IMAGE PROCESSING PIPELINE
		const { data, info } = await processImage(
			imagePath,
			finalFormat,
			effectiveQuality,
			grayscale,
			CONFIG,
		);

		logger.debug("Compression successful", {
			compressedSize: info.size,
			dimensions: { width: info.width, height: info.height },
			format: finalFormat,
			effectiveQuality,
		});

		// 6. SIZE VALIDATION & RESPONSE
		if (info.size > originalSize) {
			return createResponse(
				imagePath,
				metadata.format || CONFIG.DEFAULT_FORMAT,
				originalSize,
				0,
				"bypassed-larger",
			);
		}

		return createResponse(
			data,
			finalFormat,
			info.size,
			originalSize - info.size,
			"compressed",
			originalSize,
		);
	} catch (err) {
		logger.error("Compression failed", {
			error: err.message,
			stack: err.stack,
		});

		return {
			err,
			headers: null,
			output: null,
		};
	}
}

// HELPER FUNCTIONS
async function getImageMetadata(imagePath) {
	try {
		return await sharp(imagePath).metadata();
	} catch (error) {
		logger.warn("Metadata read failed, using defaults", {
			error: error.message,
		});
		return {
			width: CONFIG.DEFAULT_DIMENSIONS.width,
			height: CONFIG.DEFAULT_DIMENSIONS.height,
			format: CONFIG.DEFAULT_FORMAT,
		};
	}
}

function calculateDimensions(metadata, maxWidth) {
	if (!metadata.width || !metadata.height) {
		return CONFIG.DEFAULT_DIMENSIONS;
	}

	if (metadata.width <= maxWidth) {
		return { width: metadata.width, height: metadata.height };
	}

	const ratio = maxWidth / metadata.width;
	return {
		width: Math.round(metadata.width * ratio),
		height: Math.round(metadata.height * ratio),
	};
}

function selectFormat(useWebp, calculatedHeight, config) {
	if (calculatedHeight > config.MAX_JPEG_HEIGHT) {
		return "jpeg";
	}
	if (useWebp && calculatedHeight > config.MAX_WEBP_HEIGHT) {
		return "jpeg";
	}
	return useWebp ? "webp" : "jpeg";
}

async function processImage(imagePath, format, quality, grayscale, config) {
	const isJpeg = format === "jpeg";

	const sharpOptions = {
		sequentialRead: true,
		limitInputPixels: config.MAX_INPUT_PIXELS,
	};

	const formatOptions = {
		quality,
		progressive: true,
		optimizeScans: true,
		...(isJpeg
			? {
					mozjpeg: true,
					chromaSubsampling: "4:2:0",
					trellisQuantisation: true,
					overshootDeringing: true,
					quantisationTable: 3,
				}
			: {
					effort: 6,
					smartSubsample: true,
					nearLossless: false,
					lossless: false,
					sharpYuv: !grayscale,
					alphaQuality: quality,
					// preset: "drawing",
				}),
	};

	return sharp(imagePath, sharpOptions)
		.resize({
			kernel: sharp.kernel.lanczos2,
			width: config.MAX_WIDTH,
			fit: "inside",
			withoutEnlargement: true,
		})
		.grayscale(grayscale)
		.toFormat(format, formatOptions)
		.toBuffer({ resolveWithObject: true });
}

function createResponse(
	output,
	format,
	size,
	bytesSaved,
	status,
	originalSize = null,
) {
	const headers = {
		"content-type": `image/${format}`,
		"content-length": size,
		"x-compression-status": status,
		"x-bytes-saved": bytesSaved,
	};

	if (originalSize !== null) {
		headers["x-original-size"] = originalSize;
	}

	return {
		err: null,
		headers,
		output,
	};
}

module.exports = compress;

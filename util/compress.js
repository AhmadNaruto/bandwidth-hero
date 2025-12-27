// compress.js - MODIFIED: Switched WebP to AVIF logic for Mihon Fork

import sharp from "sharp";
import logger from "./logger.js";

// Configuration constants.
const CONFIG = {
	MAX_WIDTH: 400,
	MAX_JPEG_HEIGHT: 32767,
	MAX_AVIF_HEIGHT: 16383, // Limit dimensi AVIF mirip dengan WebP
	MAX_INPUT_PIXELS: 268402689,
	GRAYSCALE_QUALITY_RANGE: { min: 10, max: 40 },
	DEFAULT_DIMENSIONS: { width: 400, height: 400 },
	DEFAULT_FORMAT: "avif", // Format default sekarang AVIF

	JPEG_OPTIONS: {
		quality: 80,
		progressive: true,
		mozjpeg: true,
		chromaSubsampling: "4:2:0",
		trellisQuantisation: true,
		overshootDeringing: true,
		quantisationTable: 3,
	},
	// Konfigurasi AVIF yang dioptimalkan untuk performa serverless
	AVIF_OPTIONS: {
		// quality: 40, // AVIF 50 secara visual setara/lebih baik dari WebP 80
		effort: 2, // Nilai 4 adalah titik tengah terbaik antara kecepatan & kompresi
		chromaSubsampling: "4:4:4",
		bitdepth: 8,
		force: true,
	},
};

async function compress(imagePath, useAvif, grayscale, quality, originalSize) {
	try {
		const metadata = await getImageMetadata(imagePath);
		const { width: calculatedWidth, height: calculatedHeight } = calculateDimensions(metadata, CONFIG.MAX_WIDTH);

		// Menentukan format akhir (AVIF atau JPEG)
		const finalFormat = selectFormat(useAvif, calculatedHeight, CONFIG);

		const effectiveQuality = grayscale
			? Math.max(
					CONFIG.GRAYSCALE_QUALITY_RANGE.min,
					Math.min(quality, CONFIG.GRAYSCALE_QUALITY_RANGE.max),
				)
			: quality;

		logger.debug("Compression started (AVIF Mode)", {
			originalSize,
			effectiveQuality,
			format: finalFormat,
		});

		const { data, info } = await processImage(
			imagePath,
			finalFormat,
			effectiveQuality,
			grayscale,
			CONFIG,
		);

		// Jika hasil kompresi malah lebih besar, kirim file asli
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
		});
		return { err, headers: null, output: null };
	}
}

async function getImageMetadata(imagePath) {
	try {
		return await sharp(imagePath, {
			sequentialRead: true,
			limitInputPixels: CONFIG.MAX_INPUT_PIXELS,
		}).metadata();
	} catch (_) {
		return {
			width: CONFIG.DEFAULT_DIMENSIONS.width,
			height: CONFIG.DEFAULT_DIMENSIONS.height,
			format: CONFIG.DEFAULT_FORMAT,
		};
	}
}

function calculateDimensions(metadata, maxWidth) {
	if (!metadata.width || !metadata.height) return CONFIG.DEFAULT_DIMENSIONS;
	if (metadata.width <= maxWidth)
		return { width: metadata.width, height: metadata.height };
	const ratio = maxWidth / metadata.width;
	return {
		width: Math.round(metadata.width * ratio),
		height: Math.round(metadata.height * ratio),
	};
}
	
function selectFormat(useAvif, calculatedHeight, config) {
	if (calculatedHeight > config.MAX_JPEG_HEIGHT) return "jpeg";
	if (useAvif && calculatedHeight > config.MAX_AVIF_HEIGHT) return "jpeg";
	return useAvif ? "avif" : "jpeg";
}

async function processImage(imagePath, format, quality, grayscale, config) {
	const isJpeg = format === "jpeg";

	const formatOptions = isJpeg
		? { ...config.JPEG_OPTIONS, quality }
		: {
				...config.AVIF_OPTIONS,
				quality: quality, // AVIF lebih efisien di kualitas angka rendah
			};

	return sharp(imagePath, {
		sequentialRead: true,
		limitInputPixels: config.MAX_INPUT_PIXELS,
		failOnError: false,
	})
		.flatten({ background: { r: 255, g: 255, b: 255 } })
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
	if (originalSize !== null) headers["x-original-size"] = originalSize;
	return { err: null, headers, output };
}

export default compress;

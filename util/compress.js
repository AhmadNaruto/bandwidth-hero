// compress.js - FIXED: Add safety checks and optimize compression

// Compresses an image using Sharp library
const sharp = require("sharp");
const logger = require("./logger");

async function compress(imagePath, useWebp, grayscale, quality, originalSize) {
	const MAX_HEIGHT = 32767; // Sharp's maximum height limit
	const MAX_WIDTH = 700;
	const MAX_WEBP_HEIGHT = 16383;

	try {
		// ==== PERBAIKAN: Error handling untuk metadata dengan fallback ====
		// Jika gagal baca metadata (gambar corrupt/no-support), gunakan default
		let metadata;
		try {
			metadata = await sharp(imagePath).metadata();
		} catch (metaError) {
			logger.warn("Failed to read metadata, using safe defaults", {
				error: metaError.message,
			});
			// Default: gambar persegi 700px dengan format jpeg
			metadata = { width: MAX_WIDTH, height: MAX_WIDTH, format: "jpeg" };
		}

		// Calculate the dimensions that would result from our resize operation
		let calculatedWidth, calculatedHeight;

		if (metadata.width && metadata.height) {
			if (metadata.width <= MAX_WIDTH) {
				// Don't enlarge, so dimensions stay the same
				calculatedWidth = metadata.width;
				calculatedHeight = metadata.height;
			} else {
				// Calculate proportional resize that fits within 700 width
				const ratio = MAX_WIDTH / metadata.width;
				calculatedWidth = Math.round(metadata.width * ratio);
				calculatedHeight = Math.round(metadata.height * ratio);
			}
		} else {
			// Fallback if no metadata available
			calculatedWidth = MAX_WIDTH;
			calculatedHeight = MAX_WIDTH; // Assume square if no height info
		}

		// Determine format based on height check
		// Sharp punya batasan height yang berbeda untuk WebP vs JPEG
		let finalFormat;
		if (calculatedHeight > MAX_HEIGHT) {
			finalFormat = "jpeg"; // JPEG support height lebih tinggi
		} else if (useWebp && calculatedHeight > MAX_WEBP_HEIGHT) {
			finalFormat = "jpeg"; // WebP terbatas 16383px height
		} else {
			finalFormat = useWebp ? "webp" : "jpeg";
		}

		const isJpeg = finalFormat === "jpeg";

		// ==== PERBAIKAN: Quality adaptif berdasarkan grayscale ====
		// Grayscale bisa dikompres lebih agresif tanpa kehilangan visual quality
		// Karena tidak ada informasi warna, kita bisa turunkan quality lebih jauh
		const effectiveQuality = grayscale
			? Math.max(20, Math.min(quality, 35))
			: quality;

		logger.debug("START: ", {
			originalSize,
			// finalFormat,
			effectiveQuality,
			// grayscale,
			calculatedDimensions: {
				width: calculatedWidth,
				height: calculatedHeight,
			},
		});

		// Perform all operations in a single pipeline
		// sequentialRead: true = optimize memory usage untuk stream besar
		// limitInputPixels: batasi gambar terlalu besar (seperti 100MP foto)
		const { data, info } = await sharp(imagePath, {
			sequentialRead: true,
			limitInputPixels: 268402689, // Prevents processing extremely large images
		})
			.resize({
				kernel: sharp.kernel.lanczos3, // High quality resize algorithm
				width: MAX_WIDTH,
				fit: "inside", // Ensures the image fits within the dimensions without cropping
				withoutEnlargement: true, // Prevents enlarging images that are already smaller than 700px
			})
			.grayscale(grayscale)
			.toFormat(finalFormat, {
				quality: effectiveQuality,
				progressive: true, // Progressive JPEG/WebP untuk loading bertahap
				optimizeScans: true,
				// ==== PERBAIKAN: Pisahkan opsi format agar lebih jelas ====
				// JPEG-specific optimizations
				...(isJpeg && {
					mozjpeg: true, // Mozilla's JPEG optimizer
					chromaSubsampling: "4:2:0", // Reduce color resolution (good untuk kompresi)
					trellisQuantisation: true, // Advanced quantization
					overshootDeringing: true, // Reduce ringing artifacts
					quantisationTable: 3, // High compression table
				}),
				// WebP-specific optimizations
				...(!isJpeg && {
					effort: 6, // Maximum compression effort (0-6)
					smartSubsample: true, // Better chroma subsampling
					nearLossless: false, // Set false to guarantee size reduction
					alphaQuality: effectiveQuality, // Quality untuk channel alpha (transparansi)
				}),
			})
			.toBuffer({ resolveWithObject: true }); // Info = metadata hasil kompresi

		logger.debug("SUCCESS: ", {
			compressedSize: info.size,
			dimensions: { width: info.width, height: info.height },
			// format: finalFormat,
			effectiveQuality,
		});

		// ==== PERBAIKAN: Jika kompresi malah besar, return original ====
		// Kadang kompresi bisa hasilkan file lebih besar (misal: gambar sudah terkompres)
		// Dalam kasus ini, lebih baik kirim asli daripada buang waktu & bandwidth
		if (info.size > originalSize) {
			logger.warn("UNEXPECT SIZE: BYPASS", {
				originalSize,
				// compressedSize: info.size,
				increase: info.size - originalSize,
				percentageIncrease: (
					((info.size - originalSize) / originalSize) *
					100
				).toFixed(2),
				// format: finalFormat,
				// effectiveQuality,
				// grayscale
			});

			// ==== PERBAIKAN: Return original buffer dengan header yang benar ====
			// Penting: kirim metadata yang akurat agar client tahu ini original
			return {
				err: null,
				headers: {
					"content-type": `image/${metadata.format || "jpeg"}`,
					"content-length": originalSize,
					"x-original-size": originalSize,
					"x-bytes-saved": 0,
					"x-compression-status": "bypassed-larger",
				},
				output: imagePath, // Return original buffer
			};
		}

		// ==== PERBAIKAN: Return compressed dengan metadata yang lengkap ====
		// Header tambahan untuk monitoring & debugging
		return {
			err: null,
			headers: {
				"content-type": `image/${finalFormat}`,
				"content-length": info.size,
				"x-original-size": originalSize,
				"x-bytes-saved": originalSize - info.size,
				"x-compression-status": "compressed",
			},
			output: data, // Return compressed buffer
		};
	} catch (err) {
		logger.error("FAILED: ", {
			//originalSize,
			//useWebp,
			//grayscale,
			// quality,
			error: err.message,
			stack: err.stack,
		});

		// Return error object untuk handler di index.js
		return {
			err,
			headers: null,
			output: null,
		};
	}
}

module.exports = compress;

// shouldCompress.js - OPTIMIZED: Clear logic and configuration

// Configuration constants
const CONFIG = {
	MIN_COMPRESS_LENGTH: 2048, // 2KB minimum for compression
	MIN_TRANSPARENT_COMPRESS_LENGTH: 102400, // 100KB for transparent PNG/GIF
	MAX_ORIGINAL_SIZE: 5 * 1024 * 1024, // 5MB maximum for compression
	SUPPORTED_IMAGE_TYPES: /^image\/(jpeg|png|gif|webp|bmp|tiff)/i,
};

/**
 * Determines if an image should be compressed based on type, size, and transparency
 * @param {string} imageType - MIME type of the image
 * @param {number} size - Size in bytes
 * @param {boolean} isTransparent - Whether the image has transparency
 * @returns {boolean} - True if compression should proceed
 */
function shouldCompress(imageType, size, isTransparent) {
	// Validate input
	if (!imageType || typeof size !== "number") {
		return false;
	}

	// Check size boundaries
	if (size > CONFIG.MAX_ORIGINAL_SIZE || size < CONFIG.MIN_COMPRESS_LENGTH) {
		return false;
	}

	// Check if it's a supported image type
	if (!CONFIG.SUPPORTED_IMAGE_TYPES.test(imageType)) {
		return false;
	}

	// Handle transparent images
	if (isTransparent) {
		// Small transparent images might not benefit from compression
		return size >= CONFIG.MIN_COMPRESS_LENGTH;
	}

	// For non-transparent PNG/GIF, ensure they're large enough to compress
	if (imageType.endsWith("png") || imageType.endsWith("gif")) {
		return size >= CONFIG.MIN_TRANSPARENT_COMPRESS_LENGTH;
	}

	return true;
}

export default shouldCompress;

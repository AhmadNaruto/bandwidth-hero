// shouldCompress.js - REFACTORED: More concise and LSP-friendly version

const CONFIG = {
  MIN_COMPRESS_LENGTH: 2048,
  MIN_PNG_GIF_COMPRESS_LENGTH: 102400,
  MAX_ORIGINAL_SIZE: 5 * 1024 * 1024,
  SUPPORTED_IMAGE_TYPES: /^image\/(jpeg|png|gif|webp|bmp|tiff)$/,
};

/**
 * Determines if an image should be compressed based on type and size.
 * PNG/GIF images require larger sizes to benefit from compression.
 * @param {string} imageType - MIME type of the image
 * @param {number} size - Size in bytes
 * @param {boolean} isWebp - Whether WebP output format is requested (unused, kept for API compatibility)
 * @returns {boolean} - True if compression should proceed
 */
function shouldCompress(imageType, size, isWebp) {
  if (!imageType || typeof size !== "number") return false;
  if (size > CONFIG.MAX_ORIGINAL_SIZE || size < CONFIG.MIN_COMPRESS_LENGTH) return false;
  if (!CONFIG.SUPPORTED_IMAGE_TYPES.test(imageType)) return false;

  // PNG/GIF images need to be larger to benefit from compression
  // due to their lossless nature and potential transparency
  if (imageType.endsWith("png") || imageType.endsWith("gif")) {
    return size >= CONFIG.MIN_PNG_GIF_COMPRESS_LENGTH;
  }

  return true;
}

export default shouldCompress;
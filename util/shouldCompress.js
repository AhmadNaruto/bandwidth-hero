// shouldCompress.js - REFACTORED: More concise and LSP-friendly version

const CONFIG = {
  MIN_COMPRESS_LENGTH: 2048,
  MIN_TRANSPARENT_COMPRESS_LENGTH: 102400,
  MAX_ORIGINAL_SIZE: 5 * 1024 * 1024,
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
  if (!imageType || typeof size !== "number") return false;
  if (size > CONFIG.MAX_ORIGINAL_SIZE || size < CONFIG.MIN_COMPRESS_LENGTH) return false;
  if (!CONFIG.SUPPORTED_IMAGE_TYPES.test(imageType)) return false;
  
  // Handle transparent images
  if (isTransparent) return size >= CONFIG.MIN_COMPRESS_LENGTH;
  
  // For non-transparent PNG/GIF, ensure they're large enough to compress
  if (imageType.endsWith("png") || imageType.endsWith("gif")) {
    return size >= CONFIG.MIN_TRANSPARENT_COMPRESS_LENGTH;
  }

  return true;
}

export default shouldCompress;
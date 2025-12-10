const MIN_COMPRESS_LENGTH = 2048; // ==== PERBAIKAN: Naikkan dari 1KB ke 2KB (gambar <2KB tidak worth untuk dikompresi)
const MIN_TRANSPARENT_COMPRESS_LENGTH = 102400; // 100KB untuk PNG/GIF transparan
const MAX_ORIGINAL_SIZE = 5 * 1024 * 1024; // ==== PERBAIKAN: Tambah batas maksimum 5MB untuk mencegah timeout

function shouldCompress(imageType, size, isTransparent) {
	// ==== PERBAIKAN: Jangan kompres gambar terlalu besar atau terlalu kecil ====
	if (size > MAX_ORIGINAL_SIZE || size < MIN_COMPRESS_LENGTH) {
		return false;
	}

	return !(
		!imageType.startsWith("image") ||
		size === 0 ||
		(isTransparent && size < MIN_COMPRESS_LENGTH) ||
		(!isTransparent &&
			(imageType.endsWith("png") || imageType.endsWith("gif")) &&
			size < MIN_TRANSPARENT_COMPRESS_LENGTH)
	);
}

module.exports = shouldCompress;

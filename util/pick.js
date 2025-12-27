// pick.js - OPTIMIZED: Robust property picking utility

/**
 * Picks specific properties from an object
 * @param {Object} source - Source object to pick properties from
 * @param {Array<string>} properties - Array of property names to pick
 * @returns {Object} - New object with only the picked properties
 */
function pick(source, properties) {
	if (!source || typeof source !== "object" || !Array.isArray(properties)) {
		return {};
	}

	const result = {};
	// Kita buat list kunci yang ada di source dalam bentuk lowercase untuk pencarian cepat
	const sourceKeys = Object.keys(source);
	const lowerSourceKeys = sourceKeys.map((k) => k.toLowerCase());

	for (const prop of properties) {
		const targetProp = prop.toLowerCase();

		// Cari apakah ada kunci di source yang cocok (abaikan huruf besar/kecil)
		const actualKeyIndex = lowerSourceKeys.indexOf(targetProp);

		if (actualKeyIndex !== -1) {
			const actualKey = sourceKeys[actualKeyIndex];
			const value = source[actualKey];

			if (value !== undefined) {
				// Gunakan nama properti asli yang diminta oleh user (prop)
				result[prop] = value;
			}
		}
	}

	return result;
}

/**
 * Alternative implementation: Pick with validation and transformation
 * Uncomment if you need these advanced features
 */
// function pickWithOptions(source, properties, options = {}) {
//     const {
//         skipUndefined = true,
//         defaultValue = null,
//         transform = null
//     } = options;

//     const result = {};

//     for (const property of properties) {
//         let value = source[property];

//         // Handle undefined values
//         if (value === undefined) {
//             if (skipUndefined) continue;
//             value = defaultValue;
//         }
//
//         // Apply transformation if provided
//         if (transform && typeof transform === 'function') {
//             value = transform(value, property, source);
//         }
//
//         result[property] = value;
//     }
//
//     return result;
// }

export default pick;

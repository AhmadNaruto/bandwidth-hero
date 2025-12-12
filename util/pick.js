// pick.js - OPTIMIZED: Robust property picking utility

/**
 * Picks specific properties from an object
 * @param {Object} source - Source object to pick properties from
 * @param {Array<string>} properties - Array of property names to pick
 * @returns {Object} - New object with only the picked properties
 */
function pick(source, properties) {
	// Return empty object for invalid inputs
	if (
		!source ||
		typeof source !== "object" ||
		!properties ||
		!Array.isArray(properties)
	) {
		return {};
	}

	const result = {};
	const propertySet = new Set(properties);

	// Iterate over properties array instead of source object
	// This ensures we only check the properties we care about
	for (const property of propertySet) {
		// Check if property exists and is not inherited from prototype
		if (Object.prototype.hasOwnProperty.call(source, property)) {
			const value = source[property];

			// Skip undefined values (optional: include them if needed)
			if (value !== undefined) {
				result[property] = value;
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

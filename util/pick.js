// util/pick.js - FIX: No assignment in expression

// Picks specific properties from an object
module.exports = (object, properties) => {
	const picked = {};
    
    // Pastikan objek yang diiterasi bukan null atau undefined.
    // Gunakan objek kosong ({}) sebagai fallback.
	const targetObject = object || {}; 

	for (const key in targetObject) {
        // Gunakan targetObject di dalam loop
		if (Object.hasOwn(targetObject, key) && properties.includes(key)) {
			picked[key] = targetObject[key];
		}
	}
	return picked;
};

// pick.js - REFACTORED: More concise and LSP-friendly version

/**
 * Picks specific properties from an object with case-insensitive matching
 * @param {Object} source - Source object to pick properties from
 * @param {Array<string>} properties - Array of property names to pick
 * @returns {Object} - New object with only the picked properties
 */
function pick(source, properties) {
  if (!source || typeof source !== "object" || !Array.isArray(properties)) return {};

  const result = {};
  const sourceKeys = Object.keys(source);
  const sourceKeyMap = Object.fromEntries(sourceKeys.map(k => [k.toLowerCase(), k]));

  for (const prop of properties) {
    const targetProp = prop.toLowerCase();
    const actualKey = sourceKeyMap[targetProp];
    const value = actualKey ? source[actualKey] : undefined;

    if (value !== undefined) {
      result[prop] = value;
    }
  }

  return result;
}

export default pick;
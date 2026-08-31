/*
 *
 * Helper: `randomArrayItem`.
 *
 */
const randomArrayItem = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("randomArrayItem requires a non-empty array");
  }

  return items[Math.floor(Math.random() * items.length)];
};
export default randomArrayItem;

/*
 *
 * Helper: `createRandomAttachmentKey`.
 *
 */
const createRandomAttachmentKey = (minLength = 3, maxLength = 7) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  const length =
    Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;

  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
};

export default createRandomAttachmentKey;

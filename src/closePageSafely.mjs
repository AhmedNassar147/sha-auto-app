/*
 *
 * Helper: `closePageSafely`.
 *
 */
const closePageSafely = async (page) => {
  if (page && typeof page.close === "function") {
    await page.close().catch(() => {});
  }
};

export default closePageSafely;

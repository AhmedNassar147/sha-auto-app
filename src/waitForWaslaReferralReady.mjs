/*
 *
 * Helper: `waitForWaslaReferralReady`.
 *
 */
export default async function waitForWaslaReferralReady(
  page,
  ACTION_TEXTS,
  timeoutMs = 3_000,
) {
  const handle = await page.waitForFunction(
    (texts) => {
      let hasToken = false;
      try {
        const auth = JSON.parse(localStorage.getItem("persist:auth") || "{}");
        hasToken = Boolean(auth.token && JSON.parse(auth.token));
      } catch {}
      if (!hasToken) return false;
      return [...document.querySelectorAll("button")].some((button) => {
        const text = (button.textContent || "").replace(/\s+/g, " ").trim();
        return texts.includes(text) && button.getClientRects().length > 0;
      });
    },
    { timeout: timeoutMs },
    ACTION_TEXTS,
  );
  await handle.dispose();
}

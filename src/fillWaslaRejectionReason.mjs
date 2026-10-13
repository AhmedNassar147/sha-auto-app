import { BASE_WASLA_API_URL } from "./constants.mjs";

/** Select the configured lookup ID, never an arbitrary dropdown option. */
export default async function fillWaslaRejectionReason(page, modal, reasonId) {
  const reason = await page.evaluate(
    async ({ baseUrl, reasonId }) => {
      const auth = JSON.parse(localStorage.getItem("persist:auth") || "{}");
      const token = auth.token ? JSON.parse(auth.token) : null;
      const response = await fetch(`${baseUrl}/lookup/rejection-reasons`, {
        credentials: "include",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          culture: localStorage.getItem("i18nextLng") || "en",
        },
      });
      if (!response.ok)
        throw new Error(`Rejection lookup HTTP ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload.data;
      return rows?.find((row) => String(row.id) === String(reasonId)) || null;
    },
    { baseUrl: BASE_WASLA_API_URL, reasonId },
  );
  if (!reason?.name) throw new Error(`Rejection reason ${reasonId} not found`);
  const input = await modal.waitForSelector('input[name="rejectionReason"]', {
    timeout: 10_000,
  });
  await input.click({ clickCount: 3 });
  await input.type(reason.name);
  const option = await page.waitForFunction(
    (name) => {
      return [...document.querySelectorAll('[role="option"]')].find(
        (item) =>
          item.getBoundingClientRect().height > 0 &&
          item.textContent.trim() === name.trim(),
      );
    },
    { timeout: 10_000 },
    reason.name,
  );
  const element = option.asElement();
  if (!element) throw new Error("Rejection reason option is not clickable");
  await element.click();
}

/*
 *
 * Helper: `getLoginErrors`.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";

const legacyErrorSelector = ".validation-summary-errors ul li";

// Nafath's Chakra/Ark-UI error toast (see html/nafath.form-error.html), e.g.
// "رقم الهوية أو كلمة المرور المدخلة غير صحيحة" for wrong credentials. It
// auto-dismisses (~3.3s per the captured --duration), so this only catches
// it if called shortly after the submit that triggered it.
const nafathToastErrorDescriptionSelector =
  '[data-scope="toast"][data-part="root"][data-type="error"] [data-part="description"]';

/**
 * Extracts login error messages shown in the DOM after form submission —
 * both the legacy ASP.NET validation-summary list and Nafath's error toast.
 * @param {import('puppeteer').Page} page - Puppeteer page instance.
 * @returns {Promise<string[]>} Array of error messages.
 */
const getLoginErrors = async (page) => {
  try {
    const [legacyErrors, nafathErrors] = await Promise.all([
      page.$$eval(legacyErrorSelector, (items) =>
        items.map((li) => li?.textContent?.trim()).filter(Boolean),
      ),
      page.$$eval(nafathToastErrorDescriptionSelector, (items) =>
        items.map((el) => el?.textContent?.trim()).filter(Boolean),
      ),
    ]);

    return [...legacyErrors, ...nafathErrors].filter(Boolean);
  } catch (error) {
    createConsoleMessage("error", error, "getLoginErrors");
    return [];
  }
};

export default getLoginErrors;

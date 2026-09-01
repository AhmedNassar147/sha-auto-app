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

// Nafath's other (server-rendered) UI shows errors inline instead of via a
// toast — e.g. "اسم المستخدم او كلمة المرور غير صحيح" in #errorMessage (see
// html/new-nafath-login-error.html). This one is part of the rendered page
// rather than a transient toast, so — unlike the one above — it doesn't
// auto-dismiss and stays checkable well after the submit that triggered it.
const nafathInlineErrorSelector = "#errorMessage";

// Puppeteer throws this from $$eval/evaluate whenever a real navigation
// tears down the page's execution context mid-call — which, for this
// function, is routinely the case: it's called on a poll loop specifically
// while waiting for Nafath to navigate away. That's the success condition,
// not a failure, so it's treated as "nothing to report this tick" rather
// than logged as an error - unlike any other unexpected failure here, which
// still gets logged normally.
const isTransientNavigationError = (error) =>
  /Execution context was destroyed|Execution context is not available|Cannot find context with specified id/.test(
    error?.message || "",
  );

/**
 * Extracts login error messages shown in the DOM after form submission —
 * the legacy ASP.NET validation-summary list, Nafath's Chakra error toast,
 * and Nafath's server-rendered inline error.
 * @param {import('puppeteer').Page} page - Puppeteer page instance.
 * @returns {Promise<string[]>} Array of error messages.
 */
const getLoginErrors = async (page) => {
  try {
    const [legacyErrors, nafathToastErrors, nafathInlineErrors] =
      await Promise.all([
        page.$$eval(legacyErrorSelector, (items) =>
          items.map((li) => li?.textContent?.trim()).filter(Boolean),
        ),
        page.$$eval(nafathToastErrorDescriptionSelector, (items) =>
          items.map((el) => el?.textContent?.trim()).filter(Boolean),
        ),
        page.$$eval(nafathInlineErrorSelector, (items) =>
          items.map((el) => el?.textContent?.trim()).filter(Boolean),
        ),
      ]);

    return [
      ...legacyErrors,
      ...nafathToastErrors,
      ...nafathInlineErrors,
    ].filter(Boolean);
  } catch (error) {
    if (!isTransientNavigationError(error)) {
      createConsoleMessage("error", error, "getLoginErrors");
    }
    return [];
  }
};

export default getLoginErrors;

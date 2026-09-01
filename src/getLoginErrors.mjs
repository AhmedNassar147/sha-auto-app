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

// Puppeteer/CDP throws one of several different messages from $$eval/
// evaluate whenever a real navigation races the call mid-flight — which,
// for this function, is routinely the case: it's called on a poll loop
// specifically while waiting for Nafath to navigate away, so a navigation
// landing mid-call is the success condition, not a failure. Confirmed live
// so far: "Execution context was destroyed" (a plain navigation tearing
// down the context), and "Argument should belong to the same JavaScript
// world as target object" (a stale handle from the pre-navigation context
// getting reused after our own auto-click of the "انتقال" proceed button
// triggered one) — same underlying race, different CDP wording depending
// on exactly which internal step got interrupted. Treated as "nothing to
// report this tick" rather than logged as an error - unlike any other
// unexpected failure here, which still gets logged normally. This is
// inherently a little whack-a-mole (new CDP wording could surface later);
// widen the pattern rather than assume the list above is exhaustive.
const isTransientNavigationError = (error) =>
  /Execution context was destroyed|Execution context is not available|Cannot find context with specified id|same JavaScript world|Target closed|Session closed|Most likely the (page|frame) has been closed/.test(
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

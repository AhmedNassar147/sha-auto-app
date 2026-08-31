/*
 *
 * Helper: `confirmNafathTransition`.
 *
 * Right after leaving iam.gov.sa, an intermediate Chakra-styled page
 * (html/intgal-after-code.html) shows "تأكيد الانتقال" ("Confirm
 * Transition") - "أنت على وشك الانتقال إلى النفاذ الوطني الموحد <-> Seha" -
 * with an "انتقال" (Proceed) button and an "إلغاء" (Cancel) button. Clicking
 * "انتقال" continues on to seha.sa (eventually landing on the role picker
 * from selectFirstLoginAccount.mjs, or straight on the dashboard).
 *
 * The button's class (css-8z521n) is a Chakra/Emotion-generated hash that
 * isn't guaranteed to stay the same across builds/sessions, so it's never
 * used for selection. Matched instead by aria-label, falling back to the
 * visible text if aria-label ever changes or goes missing (seen before with
 * the two structurally different Nafath login UI variants) - both
 * currently read "انتقال", so either alone would work today, but checking
 * both means one of them changing doesn't silently break this.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";

const proceedButtonAriaLabel = "انتقال";
const proceedButtonText = "انتقال";

const APPEAR_TIMEOUT_MS = 8_000;

/**
 * Clicks the "انتقال" (Proceed) button on the post-Nafath transition
 * confirmation page, if it's showing. Best-effort - if the page doesn't
 * appear (or it's a UI variant that skips it entirely), this is a no-op,
 * not a failure.
 *
 * @param {import("puppeteer").Page} page
 * @returns {Promise<{
 *   success: boolean,
 *   skipped?: boolean,
 *   message?: string,
 * }>}
 */
const confirmNafathTransition = async (page) => {
  const proceedButtonHandle = await page
    .waitForFunction(
      (ariaLabel, text) => {
        const buttons = [...document.querySelectorAll("button")];

        return (
          buttons.find((button) => button.getAttribute("aria-label") === ariaLabel) ||
          buttons.find(
            (button) => button.textContent.replace(/\s+/g, " ").trim() === text,
          ) ||
          null
        );
      },
      { timeout: APPEAR_TIMEOUT_MS },
      proceedButtonAriaLabel,
      proceedButtonText,
    )
    .catch(() => null);

  if (!proceedButtonHandle) {
    return {
      success: true,
      skipped: true,
      message: "transition confirmation page not shown",
    };
  }

  try {
    await proceedButtonHandle.asElement()?.click();
  } catch (error) {
    createConsoleMessage(
      "error",
      `❌ Failed to click "${proceedButtonAriaLabel}": ${error.message}`,
      "confirmNafathTransition",
    );
    return { success: false, message: "failed to click proceed button" };
  }

  createConsoleMessage(
    "success",
    `✅ Confirmed Nafath transition (clicked "${proceedButtonAriaLabel}").`,
    "confirmNafathTransition",
  );

  return { success: true };
};

export default confirmNafathTransition;

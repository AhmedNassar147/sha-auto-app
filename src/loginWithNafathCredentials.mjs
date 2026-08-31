/*
 *
 * Helper: `loginWithNafathCredentials`.
 *
 * Nafath's login page has been observed as two different UIs — a React/Chakra
 * build at www.iam.gov.sa/sso (html/final-nafath-login-page.html, fields
 * #username/#password) and a plain server-rendered build at
 * www.iam.gov.sa/authservice/userauthservice (
 * html/second-final-nafath-with-2-inputs-page.html, fields #j_username/
 * #j_password — that page also litters hidden decoy `input[type=password]`
 * honeypot fields around the real one, so selectors must stay this specific
 * rather than ever falling back to a generic input[type=password] query).
 * Both default to a national-ID-only view; clicking "اسم المستخدم وكلمة
 * المرور" flips either one to the username+password view CLIENT_NAME/
 * CLIENT_PASSWORD are meant for — that toggle text, and the "تسجيل الدخول"
 * submit button text, are identical between both UIs.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import { screenshotsFolderDirectory } from "./constants.mjs";

const credentialInputSelectorSets = [
  { username: "#username", password: "#password" },
  { username: "#j_username", password: "#j_password" },
];

const usernamePasswordToggleText = "اسم المستخدم وكلمة المرور";
const submitButtonText = "تسجيل الدخول";

const FLIP_TIMEOUT_MS = 7_000;

// Runs inside the page, can't close over anything defined in this module.
// Button text isn't consistently whitespace-normalized between Nafath's two
// known UI variants (e.g. an icon tag with vs. without a following space),
// so both this and findButtonWithText below collapse whitespace before
// comparing rather than relying on an exact match.
const clickButtonByText = (text) => {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.replace(/\s+/g, " ").trim() === text,
  );

  button?.click();

  return !!button;
};

// Same lookup as clickButtonByText, but read-only — used to wait for a
// button to actually exist before clicking it, since the page can still be
// mid-render right after openNafathLoginPortal hands off.
const findButtonWithText = (text) =>
  [...document.querySelectorAll("button")].some(
    (item) => item.textContent?.replace(/\s+/g, " ").trim() === text,
  );

/**
 * Flips Nafath's SSO login form to username/password mode and submits
 * CLIENT_NAME/CLIENT_PASSWORD from the environment.
 *
 * @param {import("puppeteer").Page} page
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
const loginWithNafathCredentials = async (page) => {
  const userName = process.env.CLIENT_NAME;
  const password = process.env.CLIENT_PASSWORD;

  try {
    await page.waitForFunction(
      findButtonWithText,
      { timeout: FLIP_TIMEOUT_MS },
      usernamePasswordToggleText,
    );
  } catch (error) {
    await page.screenshot({
      path: `${screenshotsFolderDirectory}/nafath-toggle-not-found-${Date.now()}.png`,
    });
    createConsoleMessage(
      "error",
      `❌ "${usernamePasswordToggleText}" toggle button never appeared: ${error.message}`,
      "loginWithNafathCredentials",
    );
    return { success: false, message: "username/password toggle not found" };
  }

  const toggledView = await page.evaluate(
    clickButtonByText,
    usernamePasswordToggleText,
  );

  if (!toggledView) {
    createConsoleMessage(
      "error",
      `❌ Could not find "${usernamePasswordToggleText}" toggle button.`,
      "loginWithNafathCredentials",
    );
    return { success: false, message: "username/password toggle not found" };
  }

  const usernameSelectors = credentialInputSelectorSets.map(
    (set) => set.username,
  );

  try {
    await page.waitForFunction(
      (selectors) =>
        selectors.some((selector) => document.querySelector(selector)),
      { timeout: FLIP_TIMEOUT_MS },
      usernameSelectors,
    );
  } catch (error) {
    createConsoleMessage(
      "error",
      `❌ Form did not flip to username/password view: ${error.message}`,
      "loginWithNafathCredentials",
    );
    return { success: false, message: "username/password view did not appear" };
  }

  let activeSelectorSet;

  for (const set of credentialInputSelectorSets) {
    if (await page.$(set.username)) {
      activeSelectorSet = set;
      break;
    }
  }

  if (!activeSelectorSet) {
    createConsoleMessage(
      "error",
      `❌ Username input appeared then vanished before it could be read.`,
      "loginWithNafathCredentials",
    );
    return { success: false, message: "username input selector unresolved" };
  }

  await page.focus(activeSelectorSet.username);
  await page.keyboard.type(userName, { delay: 100 + Math.random() * 30 });

  await page.focus(activeSelectorSet.password);
  await page.keyboard.type(password, { delay: 100 + Math.random() * 35 });

  // On the Chakra UI the submit button starts `disabled` until both fields
  // have values; the server-rendered UI never disables it at all. Either
  // way, clicking a disabled button is a silent no-op, so wait for
  // `!button.disabled` before calling clickButtonByText — resolves
  // immediately on the UI that never disables it.
  try {
    await page.waitForFunction(
      (text) => {
        const button = [...document.querySelectorAll("button")].find(
          (item) => item.textContent?.replace(/\s+/g, " ").trim() === text,
        );
        return !!button && !button.disabled;
      },
      { timeout: FLIP_TIMEOUT_MS },
      submitButtonText,
    );
  } catch (error) {
    createConsoleMessage(
      "error",
      `❌ Submit button never became enabled: ${error.message}`,
      "loginWithNafathCredentials",
    );
    return { success: false, message: "submit button stayed disabled" };
  }

  const submitClicked = await page.evaluate(
    clickButtonByText,
    submitButtonText,
  );

  if (!submitClicked) {
    createConsoleMessage(
      "error",
      `❌ Could not find "${submitButtonText}" submit button.`,
      "loginWithNafathCredentials",
    );
    return { success: false, message: "submit button not found" };
  }

  createConsoleMessage(
    "success",
    `✅ Submitted Nafath username/password login.`,
    "loginWithNafathCredentials",
  );

  return { success: true };
};

export default loginWithNafathCredentials;

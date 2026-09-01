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
 *
 * Both default to a national-ID-only view — a single "رقم الهوية" input plus
 * a "تسجيل الدخول" submit button, which pushes an approval request to the
 * user's Nafath app. Clicking "اسم المستخدم وكلمة المرور" flips either UI to
 * the username+password view instead. Which path this takes is driven by
 * CLIENT_PASSWORD: set → flip to username+password and submit CLIENT_NAME/
 * CLIENT_PASSWORD (the original behavior); empty/unset → stay on the default
 * view and submit CLIENT_NAME as the national ID alone. The toggle text and
 * submit button text are identical between both UIs either way.
 *
 * The national-ID input has no stable id on the Chakra UI (React-generated,
 * e.g. "_r_c_" — changes per render), so it's matched by its placeholder
 * text instead; the server-rendered UI's #NAT_ID is a real stable id.
 *
 * After either path submits, Nafath may show a two-digit verification code
 * that the account holder must pick in their Nafath app to approve the
 * login — this can follow national-ID-only submission, but has also been
 * seen after username/password submission, so it's checked for after
 * either path rather than being specific to one. Seen in two different
 * UI shapes so far, neither with a stable selector directly on the code
 * itself, so each is read relative to a nearby stable anchor instead:
 *  - Chakra UI (html/code2.html — "يرجى فتح تطبيق نفاذ واختيار رقم الطلب
 *    الموضح أعلاه."): the code is an `<h2>` sibling of the cancel button's
 *    container; the cancel button's aria-label ("login.cancelButton") is a
 *    real i18n key rather than translatable text.
 *  - Server-rendered "second layout" UI (html/nafath-second-layout-code.html
 *    — "الرجاء فتح تطبيق نفاذ وتأكيد الطلب بإختيار الرقم أعلاه"): the code
 *    is a `<button class="c-btn c-btn--outline">` sibling of an empty
 *    `<form id="nRandNumForm">` placeholder — that id is the stable anchor
 *    here, since the surrounding classes/text aren't.
 * When found, it's spoken aloud (speakText) and sent over Telegram
 * (sendTelegramMessage) since a human has to act on it within a short
 * window.
 *
 * Everything downstream of submission — waiting for Nafath to either reject
 * the credentials or redirect back to seha.sa, confirming the "تأكيد
 * الانتقال" transition page, and picking the right seha.sa account on the
 * post-login role picker — lives here too, since it's all still part of
 * "log in via Nafath," not a separate concern from the credential submit
 * itself.
 *
 * Every failure path here (a selector that never appeared, a step that
 * timed out, a rejected/never-returned login) captures a screenshot + the
 * page HTML into results/errors via captureFailureArtifacts, so a session
 * that fails unattended can still be investigated afterward.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import { NAFATH_HOSTNAME } from "./constants.mjs";
import speakText from "./speakText.mjs";
import sleep from "./sleep.mjs";
import getLoginErrors from "./getLoginErrors.mjs";
import confirmNafathTransition from "./confirmNafathTransition.mjs";
import openSehaDashboardByProperAccount from "./openSehaDashboardByProperAccount.mjs";
import captureFailureArtifacts from "./captureFailureArtifacts.mjs";

const credentialInputSelectorSets = [
  { username: "#username", password: "#password" },
  { username: "#j_username", password: "#j_password" },
];

const nationalIdInputSelectors = [
  "#NAT_ID",
  'input[placeholder="الرجاء إدخال رقم الهوية"]',
];

const usernamePasswordToggleText = "اسم المستخدم وكلمة المرور";
const submitButtonText = "تسجيل الدخول";

const FLIP_TIMEOUT_MS = 7_000;
// Sized for the username/password path - Nafath responds near-instantly
// there (accept or reject), no human step involved.
const RETURN_TO_SEHA_TIMEOUT_MS = 20_000;
// Once a verification code is shown, a human has to physically unlock
// their phone, open the Nafath app, and tap the right number - that needs
// far more realistic time than the fast-path window above. Applied from
// the moment the code appears, not from submit, since detecting it can
// itself eat a few seconds of the fast-path window.
const APP_APPROVAL_GRACE_MS = 90_000;
const RETURN_TO_SEHA_POLL_MS = 500;

// Runs inside the page, can't close over anything defined in this module.
// Tries both known verification-code UI shapes (see the module doc comment
// above) and returns whichever one resolves a code first.
const readVerificationCode = () => {
  const chakraCancelButton = document.querySelector(
    '[aria-label="login.cancelButton"]',
  );
  const chakraCode = chakraCancelButton?.parentElement
    ?.querySelector("h2")
    ?.textContent?.trim();

  if (chakraCode) return chakraCode;

  const secondLayoutContainer =
    document.getElementById("nRandNumForm")?.parentElement;
  const secondLayoutCode = secondLayoutContainer
    ?.querySelector("button.c-btn.c-btn--outline")
    ?.textContent?.trim();

  return secondLayoutCode || null;
};

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

// On the Chakra UI the submit button starts `disabled` until its input(s)
// have values; the server-rendered UI never disables it at all. Either way,
// clicking a disabled button is a silent no-op, so this is always awaited
// before clickButtonByText(submitButtonText) — resolves immediately on the
// UI that never disables it.
const waitForSubmitButtonEnabled = (page) =>
  page.waitForFunction(
    (text) => {
      const button = [...document.querySelectorAll("button")].find(
        (item) => item.textContent?.replace(/\s+/g, " ").trim() === text,
      );
      return !!button && !button.disabled;
    },
    { timeout: FLIP_TIMEOUT_MS },
    submitButtonText,
  );

/**
 * Reports a spotted verification code out loud and over Telegram so a
 * human can act on it in time.
 *
 * @param {string} verificationCode
 * @param {(message: string) => Promise<any>} [sendTelegramMessage]
 * @returns {Promise<void>}
 */
const reportVerificationCode = async (
  verificationCode,
  sendTelegramMessage,
) => {
  createConsoleMessage(
    "success",
    `🔢 Nafath verification code: ${verificationCode} — open the Nafath app and select this number to approve.`,
    "loginWithNafathCredentials",
  );

  const spokenDigits = verificationCode.split("").join(" ");
  const telegramMessage =
    `🔢 *Nafath verification code:* \`${verificationCode}\`\n` +
    `Open the Nafath app and select this number to approve login.`;

  await Promise.allSettled([
    sendTelegramMessage?.(telegramMessage),
    speakText({
      text: `Code Is: ${spokenDigits}`,
      useMaleVoice: true,
      volume: 100,
      times: 5,
      delayMs: 3_000,
    }),
  ]);
};

/**
 * Polls after a Nafath credential submission for whichever happens first:
 * redirected away from Nafath (success), or a login error appearing on the
 * page (Nafath rejected the credentials) — and, along the way, the
 * two-digit verification-code screen, if Nafath shows one. All three are
 * checked on every pass rather than the code being waited out first, since
 * waiting on it exclusively would delay error detection long enough for
 * Nafath's Chakra error toast to auto-dismiss (~3.3s) before it's ever
 * checked, risking a rejected submission going undetected. The code is
 * reported (spoken + Telegram) as soon as it's seen, without pausing the
 * rest of the poll — the human has to react to it while this keeps
 * watching for the actual outcome.
 *
 * @param {import("puppeteer").Page} page
 * @param {(message: string) => Promise<any>} [sendTelegramMessage]
 * @returns {Promise<{
 *   redirectedAway: boolean,
 *   loginErrors: string[],
 *   verificationCode?: string,
 * }>}
 */
const waitForNafathOutcome = async (page, sendTelegramMessage) => {
  let deadline = Date.now() + RETURN_TO_SEHA_TIMEOUT_MS;

  let verificationCode;
  let reportPromise = Promise.resolve();

  while (Date.now() < deadline) {
    if (!page.url().toLowerCase().includes(NAFATH_HOSTNAME)) {
      await reportPromise;
      return { redirectedAway: true, loginErrors: [], verificationCode };
    }

    const loginErrors = await getLoginErrors(page);
    if (loginErrors.length) {
      await reportPromise;
      return { redirectedAway: false, loginErrors, verificationCode };
    }

    if (!verificationCode) {
      const code = await page.evaluate(readVerificationCode).catch(() => null);

      if (code) {
        verificationCode = code;
        reportPromise = reportVerificationCode(code, sendTelegramMessage);
        // A human now has to physically approve this on their phone -
        // extend the deadline to a realistic reaction window instead of
        // the short fast-path one meant for an instant server response.
        deadline = Math.max(deadline, Date.now() + APP_APPROVAL_GRACE_MS);
      }
    }

    await sleep(RETURN_TO_SEHA_POLL_MS);
  }

  await reportPromise;
  return { redirectedAway: false, loginErrors: [], verificationCode };
};

/**
 * Submits Nafath's SSO login form using whichever credentials are
 * available: CLIENT_NAME + CLIENT_PASSWORD (flips to the username/password
 * view first) when a password is set, or CLIENT_NAME alone as the national
 * ID (stays on the default view, triggering a Nafath app approval push)
 * when CLIENT_PASSWORD is empty/unset. Then waits for Nafath to either
 * reject the credentials or redirect back to seha.sa, reporting a
 * verification-code screen along the way if Nafath shows one; and, once
 * back on seha.sa, confirms the "تأكيد الانتقال" transition page and picks
 * the right account on the post-login role picker (both best-effort —
 * their absence isn't a failure, since not every session shows them).
 *
 * @param {import("puppeteer").Page} page
 * @param {(message: string) => Promise<any>} [sendTelegramMessage]
 * @returns {Promise<{
 *   success: boolean,
 *   message?: string,
 *   shouldCloseApp?: boolean,
 *   verificationCode?: string,
 * }>}
 */
const loginWithNafathCredentials = async (page, sendTelegramMessage) => {
  const userName = process.env.CLIENT_NAME;
  const password = process.env.CLIENT_PASSWORD;

  const submitResult = password
    ? await loginWithUsernameAndPassword(page, userName, password)
    : await loginWithNationalIdOnly(page, userName);

  if (!submitResult.success) {
    return submitResult;
  }

  const { redirectedAway, loginErrors, verificationCode } =
    await waitForNafathOutcome(page, sendTelegramMessage);

  if (loginErrors.length) {
    // Wrong/rejected credentials won't fix themselves on retry —
    // resubmitting the same ones repeatedly risks getting the Nafath
    // account locked out from repeated failed attempts, so this is fatal,
    // not retryable.
    createConsoleMessage(
      "error",
      loginErrors.join(", "),
      "❌ Nafath rejected the credentials",
    );
    await captureFailureArtifacts(page, "nafath-rejected-credentials");

    return {
      success: false,
      message: loginErrors.join(", "),
      shouldCloseApp: true,
      verificationCode,
    };
  }

  if (!redirectedAway) {
    const waitedMs = verificationCode
      ? RETURN_TO_SEHA_TIMEOUT_MS + APP_APPROVAL_GRACE_MS
      : RETURN_TO_SEHA_TIMEOUT_MS;
    const message = `Never redirected back from Nafath (waited up to ${waitedMs}ms)`;

    createConsoleMessage("error", message, "❌ loginWithNafathCredentials");
    await captureFailureArtifacts(page, "nafath-never-redirected");

    return { success: false, message, verificationCode };
  }

  // Nafath shows its own "تأكيد الانتقال" confirmation page (
  // html/intgal-after-code.html) right after leaving iam.gov.sa, before
  // ever reaching seha.sa — best-effort: if it's not showing, this is a
  // no-op.
  const { success: transitionConfirmed, message: transitionMessage } =
    await confirmNafathTransition(page);

  if (!transitionConfirmed) {
    createConsoleMessage(
      "error",
      transitionMessage,
      "❌ confirmNafathTransition failed",
    );
    await captureFailureArtifacts(page, "confirm-nafath-transition-failed");
  }

  // An account linked to multiple facilities lands on a role picker (
  // html/session-page.html) instead of straight on the dashboard —
  // best-effort: if it's not showing (single-facility account), this is a
  // no-op and the caller falls through to its own dashboard check as
  // normal.
  const { success: accountSelected, message: accountMessage } =
    await openSehaDashboardByProperAccount(page);

  if (!accountSelected) {
    createConsoleMessage(
      "error",
      accountMessage,
      "❌ openSehaDashboardByProperAccount failed",
    );
    await captureFailureArtifacts(page, "select-seha-account-failed");
  }

  return { success: true, verificationCode };
};

/**
 * @param {import("puppeteer").Page} page
 * @param {string} nationalId
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
const loginWithNationalIdOnly = async (page, nationalId) => {
  try {
    await page.waitForFunction(
      (selectors) =>
        selectors.some((selector) => document.querySelector(selector)),
      { timeout: FLIP_TIMEOUT_MS },
      nationalIdInputSelectors,
    );
  } catch (error) {
    createConsoleMessage(
      "error",
      `❌ National ID input never appeared: ${error.message}`,
      "loginWithNafathCredentials",
    );
    await captureFailureArtifacts(page, "national-id-input-not-found");
    return { success: false, message: "national ID input not found" };
  }

  let nationalIdSelector;

  for (const selector of nationalIdInputSelectors) {
    if (await page.$(selector)) {
      nationalIdSelector = selector;
      break;
    }
  }

  if (!nationalIdSelector) {
    createConsoleMessage(
      "error",
      `❌ National ID input appeared then vanished before it could be read.`,
      "loginWithNafathCredentials",
    );
    await captureFailureArtifacts(page, "national-id-input-vanished");
    return { success: false, message: "national ID input selector unresolved" };
  }

  await page.focus(nationalIdSelector);
  await page.keyboard.type(nationalId, { delay: 100 + Math.random() * 30 });

  try {
    await waitForSubmitButtonEnabled(page);
  } catch (error) {
    createConsoleMessage(
      "error",
      `❌ Submit button never became enabled: ${error.message}`,
      "loginWithNafathCredentials",
    );
    await captureFailureArtifacts(page, "national-id-submit-disabled");
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
    await captureFailureArtifacts(page, "national-id-submit-not-found");
    return { success: false, message: "submit button not found" };
  }

  createConsoleMessage(
    "success",
    `✅ Submitted Nafath national-ID login, waiting for app approval.`,
    "loginWithNafathCredentials",
  );

  return { success: true };
};

/**
 * @param {import("puppeteer").Page} page
 * @param {string} userName
 * @param {string} password
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
const loginWithUsernameAndPassword = async (page, userName, password) => {
  try {
    await page.waitForFunction(
      findButtonWithText,
      { timeout: FLIP_TIMEOUT_MS },
      usernamePasswordToggleText,
    );
  } catch (error) {
    createConsoleMessage(
      "error",
      `❌ "${usernamePasswordToggleText}" toggle button never appeared: ${error.message}`,
      "loginWithNafathCredentials",
    );
    await captureFailureArtifacts(page, "username-password-toggle-not-found");
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
    await captureFailureArtifacts(page, "username-password-toggle-click-failed");
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
    await captureFailureArtifacts(page, "username-password-view-not-found");
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
    await captureFailureArtifacts(page, "username-input-vanished");
    return { success: false, message: "username input selector unresolved" };
  }

  await page.focus(activeSelectorSet.username);
  await page.keyboard.type(userName, { delay: 100 + Math.random() * 30 });

  await page.focus(activeSelectorSet.password);
  await page.keyboard.type(password, { delay: 100 + Math.random() * 35 });

  try {
    await waitForSubmitButtonEnabled(page);
  } catch (error) {
    createConsoleMessage(
      "error",
      `❌ Submit button never became enabled: ${error.message}`,
      "loginWithNafathCredentials",
    );
    await captureFailureArtifacts(page, "username-password-submit-disabled");
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
    await captureFailureArtifacts(page, "username-password-submit-not-found");
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

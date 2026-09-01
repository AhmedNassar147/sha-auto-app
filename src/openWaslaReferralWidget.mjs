/*
 *
 * Helper: `openWaslaReferralWidget`.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import captureFailureArtifacts from "./captureFailureArtifacts.mjs";
import sleep from "./sleep.mjs";
import {
  WASLA_REFERRAL_CONTENT_IFRAME_SELECTOR,
  WASLA_REFERRAL_IFRAME_TIMEOUT_MS,
  sidebarMenuItemSelector,
} from "./constants.mjs";

const submenuTitleSelector = ".ant-menu-submenu-title";
const submenuPopupItemSelector = ".ant-menu-sub > li";
const waslaItemTexts = ["وصلة", "connection"];

// Sized per-attempt, not for the whole wait - see the retry loop below.
const POPUP_TIMEOUT_MS = 3_000;
const POPUP_OPEN_ATTEMPTS = 3;
const POPUP_RETRY_DELAY_MS = 800;

/**
 * AntD only opens this flyout on real hover state, plain page.hover()
 * sometimes doesn't register it, so the enter/over events are dispatched
 * by hand on both the <li> and its inner title (found via manual console
 * testing, see html/sidebar.js). Runs inside the page via page.evaluate,
 * so it can't close over anything defined in this module.
 *
 * @param {string[]} selectors
 * @returns {boolean} Whether every selector resolved to an element.
 */
const dispatchHoverEvents = (selectors) => {
  const elements = selectors
    .map((selector) => document.querySelector(selector))
    .filter(Boolean);

  const eventTypes = [
    "pointerover",
    "pointerenter",
    "mouseover",
    "mouseenter",
    "mousemove",
  ];

  elements.forEach((element) => {
    eventTypes.forEach((type) => {
      element.dispatchEvent(
        new MouseEvent(type, {
          bubbles: !type.endsWith("enter"),
          cancelable: true,
          view: window,
        }),
      );
    });
  });

  return elements.length === selectors.length;
};

/**
 * Clicks through the sidebar → "الخدمات" submenu → "وصلة" and waits until
 * #contentIframe is in the DOM. Doesn't resolve the iframe's Frame — use
 * getWaslaReferralFrame.mjs for that once this resolves successfully.
 *
 * @param {object} params
 * @param {import("puppeteer").Page} params.page
 * @param {import("ghost-cursor").GhostCursor} [params.cursor] - Optional;
 *   when provided, moved over the sidebar item before the hover events are
 *   dispatched.
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
const openWaslaReferralWidget = async ({ page, cursor }) => {
  const servicesMenuItemSelector = `${sidebarMenuItemSelector}:last-of-type`;
  const servicesMenuTitleSelector = `${servicesMenuItemSelector} ${submenuTitleSelector}`;

  const servicesMenuItem = await page.$(servicesMenuItemSelector);

  if (!servicesMenuItem) {
    createConsoleMessage(
      "error",
      `❌ Could not find the services sidebar menu item.`,
      "openWaslaReferralWidget",
    );
    await captureFailureArtifacts(page, "services-menu-item-not-found");
    return { success: false, message: "services menu item not found" };
  }

  const t0 = Date.now();

  // Right after a fresh dashboard load, the sidebar can exist in the DOM
  // (hence the page.$ check above passing) while the SPA is still finishing
  // its own mount/hydration - a hover dispatched into that gap doesn't
  // register with AntD's flyout logic at all (confirmed live: the popup
  // never opened on the very first attempt right after landing on a fresh
  // #/Dashboard, then opened normally on the next full retry ~15s later).
  // Re-dispatching a few times, a beat apart, catches that settle window
  // without permanently slowing down the common case where it's already
  // ready and opens on the first attempt.
  let popupOpened = false;
  let lastPopupError;
  let popupOpenAttempts = 0;

  for (let attempt = 1; attempt <= POPUP_OPEN_ATTEMPTS; attempt++) {
    popupOpenAttempts = attempt;

    if (cursor) {
      // moveSpeed is deliberately high here (default GhostCursor pacing
      // costs ~900ms for this move, measured live) - the hover is actually
      // triggered by the manual dispatchHoverEvents call right after, not
      // by the cursor reaching the element, so this move only needs to be
      // fast cover for the pointer having "arrived" rather than a slow,
      // fully human-paced path.
      await cursor
        .move(servicesMenuItemSelector, { moveSpeed: 250 })
        .catch(() => {});
    }

    await page.evaluate(dispatchHoverEvents, [
      servicesMenuItemSelector,
      servicesMenuTitleSelector,
    ]);

    try {
      await page.waitForSelector(submenuPopupItemSelector, {
        visible: true,
        timeout: POPUP_TIMEOUT_MS,
      });
      popupOpened = true;
      break;
    } catch (error) {
      lastPopupError = error;
      if (attempt < POPUP_OPEN_ATTEMPTS) {
        await sleep(POPUP_RETRY_DELAY_MS);
      }
    }
  }

  if (!popupOpened) {
    createConsoleMessage(
      "error",
      `❌ Services submenu popup did not open after ${popupOpenAttempts} attempts: ${lastPopupError?.message}`,
      "openWaslaReferralWidget",
    );
    await captureFailureArtifacts(page, "services-submenu-not-opened");
    return { success: false, message: "services submenu did not open" };
  }

  const t2 = Date.now();

  const waslaItemClicked = await page.evaluate(
    ({ submenuPopupItemSelector, waslaItemTexts }) => {
      const items = [...document.querySelectorAll(submenuPopupItemSelector)];
      const waslaItem =
        items.find((item) =>
          waslaItemTexts.includes(item.textContent?.trim()),
        ) || items[1];

      waslaItem?.click();

      return !!waslaItem;
    },
    { submenuPopupItemSelector, waslaItemTexts },
  );

  if (!waslaItemClicked) {
    createConsoleMessage(
      "error",
      `❌ Could not find "waslaItemTexts=${waslaItemTexts.join(", ")}" to click.`,
      "openWaslaReferralWidget",
    );
    await captureFailureArtifacts(page, "wasla-item-not-found");
    return { success: false, message: "wasla items not found" };
  }

  const t3 = Date.now();

  try {
    await page.waitForSelector(WASLA_REFERRAL_CONTENT_IFRAME_SELECTOR, {
      timeout: WASLA_REFERRAL_IFRAME_TIMEOUT_MS,
    });
  } catch (error) {
    createConsoleMessage(
      "error",
      `❌ Wasla widget iframe did not appear: ${error.message}`,
      "openWaslaReferralWidget",
    );
    await captureFailureArtifacts(page, "wasla-iframe-not-appeared");
    return { success: false, message: "wasla iframe did not appear" };
  }

  const t4 = Date.now();

  createConsoleMessage(
    "success",
    `✅ Wasla widget opened. timings(ms): hoverToPopupOpen=${t2 - t0} (attempts=${popupOpenAttempts}) clickWasla=${t3 - t2} popupClickToIframe=${t4 - t3} total=${t4 - t0}`,
    "openWaslaReferralWidget",
  );

  return { success: true };
};

export default openWaslaReferralWidget;

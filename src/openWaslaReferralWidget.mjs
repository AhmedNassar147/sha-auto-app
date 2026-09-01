/*
 *
 * Helper: `openWaslaReferralWidget`.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import {
  WASLA_REFERRAL_CONTENT_IFRAME_SELECTOR,
  WASLA_REFERRAL_IFRAME_TIMEOUT_MS,
  sidebarMenuItemSelector,
} from "./constants.mjs";

const submenuTitleSelector = ".ant-menu-submenu-title";
const submenuPopupItemSelector = ".ant-menu-sub > li";
const waslaItemTexts = ["وصلة", "connection"];

const POPUP_TIMEOUT_MS = 8_000;

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
    return { success: false, message: "services menu item not found" };
  }

  const t0 = Date.now();

  if (cursor) {
    // moveSpeed is deliberately high here (default GhostCursor pacing costs
    // ~900ms for this move, measured live) - the hover is actually triggered
    // by the manual dispatchHoverEvents call right after, not by the cursor
    // reaching the element, so this move only needs to be fast cover for the
    // pointer having "arrived" rather than a slow, fully human-paced path.
    await cursor.move(servicesMenuItemSelector, { moveSpeed: 200 }).catch(() => {});
  }

  const t1 = Date.now();

  await page.evaluate(dispatchHoverEvents, [
    servicesMenuItemSelector,
    servicesMenuTitleSelector,
  ]);

  try {
    await page.waitForSelector(submenuPopupItemSelector, {
      visible: true,
      timeout: POPUP_TIMEOUT_MS,
    });
  } catch (error) {
    createConsoleMessage(
      "error",
      `❌ Services submenu popup did not open: ${error.message}`,
      "openWaslaReferralWidget",
    );
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
    return { success: false, message: "wasla iframe did not appear" };
  }

  const t4 = Date.now();

  createConsoleMessage(
    "success",
    `✅ Wasla widget opened. timings(ms): cursorMove=${t1 - t0} hoverToPopupOpen=${t2 - t1} clickWasla=${t3 - t2} popupClickToIframe=${t4 - t3} total=${t4 - t0}`,
    "openWaslaReferralWidget",
  );

  return { success: true };
};

export default openWaslaReferralWidget;

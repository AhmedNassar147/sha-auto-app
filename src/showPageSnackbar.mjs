/*
 *
 * Helper: `showPageSnackbar`.
 *
 * Injects a MUI-styled Snackbar+Alert-like status indicator into the given
 * page - purely visual, for a human operator watching the live browser to
 * see the direct-API submit attempt's progress/outcome without needing to
 * check Telegram/console. Styled to match MUI's own Snackbar (bottom-left
 * anchor, MUI's default anchorOrigin) + "filled" Alert (solid severity
 * color) look, so it blends in with the rest of the Wasla app's own
 * MUI-based UI rather than looking like a foreign injected element.
 *
 * Each call replaces any snackbar this helper already showed (by element
 * id), so a "submitting..." call followed by a "done" call swaps cleanly
 * instead of stacking. Left on screen rather than auto-dismissed, since
 * the tab itself is left open afterward for a human to review.
 *
 * Severity keys match createConsoleMessage.mjs's own ("warn", not
 * "warning") so a value can be passed to either helper interchangeably
 * without silently falling through to a default.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";

const SNACKBAR_ELEMENT_ID = "__wasla_over_snackbar__";

const SEVERITY_STYLES = {
  info: { background: "#0288d1", icon: "ℹ" },
  success: { background: "#2e7d32", icon: "✓" },
  error: { background: "#d32f2f", icon: "✕" },
  warn: { background: "#ed6c02", icon: "!" },
};

/**
 * @param {import("puppeteer").Page} page
 * @param {{
 *   message: string,
 *   severity?: "info" | "success" | "error" | "warn",
 * }} options
 * @returns {Promise<void>}
 */
const showPageSnackbar = async (page, { message, severity = "info" }) => {
  const { background, icon } =
    SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;

  await page
    .evaluate(
      (id, text, bg, iconChar) => {
        const existing = document.getElementById(id);
        if (existing) existing.remove();

        const el = document.createElement("div");
        el.id = id;
        el.style.cssText = `
          position: fixed;
          bottom: 24px;
          left: 24px;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 288px;
          max-width: 568px;
          padding: 6px 16px;
          border-radius: 4px;
          box-shadow: 0px 3px 5px -1px rgba(0,0,0,0.2), 0px 6px 10px 0px rgba(0,0,0,0.14), 0px 1px 18px 0px rgba(0,0,0,0.12);
          background-color: ${bg};
          color: #fff;
          font-family: Roboto, Helvetica, Arial, sans-serif;
          font-size: 0.875rem;
          font-weight: 400;
          line-height: 1.43;
        `;

        const iconSpan = document.createElement("span");
        iconSpan.textContent = iconChar;
        iconSpan.style.cssText =
          "font-size: 1.25rem; line-height: 1; flex-shrink: 0;";

        const textSpan = document.createElement("span");
        textSpan.textContent = text;

        el.appendChild(iconSpan);
        el.appendChild(textSpan);
        document.body.appendChild(el);
      },
      SNACKBAR_ELEMENT_ID,
      message,
      background,
      icon,
    )
    .catch((error) => {
      // Best-effort, purely visual - never let a DOM-injection hiccup
      // (page closed/navigated mid-flow) break the actual submit flow, but
      // still leave a trace rather than swallowing it silently.
      createConsoleMessage(
        "warn",
        error?.message || error,
        "⚠️ showPageSnackbar failed",
      );
    });
};

export default showPageSnackbar;

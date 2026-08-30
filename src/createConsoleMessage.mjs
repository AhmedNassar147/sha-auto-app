/*
 *
 * Helper: `createConsoleMessage`.
 *
 */
import chalk from "chalk";

const LOG_STYLES = {
  info: { label: "INFO", color: chalk.cyan },
  success: { label: "SUCCESS", color: chalk.green },
  warn: { label: "WARN", color: chalk.yellow },
  error: { label: "ERROR", color: chalk.red },
};

const LOGGERS = {
  info: console.log,
  success: console.log,
  warn: console.warn,
  error: console.error,
};

const getTimestamp = () =>
  new Date().toLocaleTimeString("en-GB", { hour12: false });

const stringifyMessage = (message) => {
  if (message instanceof Error) {
    return message.stack || message.message;
  }

  if (typeof message === "object" && message !== null) {
    return JSON.stringify(message, null, 2);
  }

  return String(message);
};

/**
 * @typedef {"info" | "success" | "warn" | "error"} ConsoleMessageType
 */

/**
 * Logs a single timestamped, color-coded line to the console.
 *
 * @param {ConsoleMessageType} [type="info"] - Severity, selects color/label
 *   and whether console.log/warn/error is used.
 * @param {string | Error | Record<string, unknown>} message - Text to log,
 *   an Error (logs its stack/message), or a plain object (logged as JSON).
 * @param {string} [prefix] - Optional label printed before the message.
 * @returns {void}
 */
const createConsoleMessage = (type = "info", message, prefix) => {
  const { label, color } = LOG_STYLES[type] || LOG_STYLES.info;

  const line = [
    chalk.dim(`[${getTimestamp()}]`),
    color.bold(`[${label}]`),
    prefix && color(prefix),
    color(stringifyMessage(message)),
  ]
    .filter(Boolean)
    .join(" ");

  (LOGGERS[type] || console.log)(line);
};

export default createConsoleMessage;

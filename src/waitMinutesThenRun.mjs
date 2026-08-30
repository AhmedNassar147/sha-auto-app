/*
 *
 * Helper: `waitMinutesThenRun`.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
// import { openChromeIfNeeded } from "./realChromeHelpers.mjs";

const waitMinutesThenRun = (
  referralId,
  caseWillBeSubmitMSAt,
  asyncAction,
  sendTelegramMessage,
) => {
  let timeoutIdMain;
  let timeoutIdWarn;
  let cancelled = false;

  const delayMain = caseWillBeSubmitMSAt - Date.now();

  const OPEN_BROWSER_OFFSET = 5 * 60 * 1000;
  const delayOpeningBrowser = delayMain - OPEN_BROWSER_OFFSET;

  // const notifyTelegram = async (messages = []) => {
  //   if (typeof sendTelegramMessage !== "function") return;

  //   const cleanMessages = messages.filter(Boolean);
  //   if (!cleanMessages.length) return;

  //   await sendTelegramMessage(
  //     [
  //       `📋 *Referral Monitor*`,
  //       `🆔 *Case ID:* \`${referralId}\``,
  //       ...cleanMessages,
  //     ].join("\n\n"),
  //   );
  // };

  // const runOpenChrome = async () => {
  //   if (cancelled) return;

  //   try {
  //     const result = await openChromeIfNeeded();

  //     if (result?.messages?.length) {
  //       await notifyTelegram(result.messages);
  //     }
  //   } catch (err) {
  //     const message = `🔴 Error opening Chrome: ${err.message}`;
  //     createConsoleMessage(message, "error");
  //     await notifyTelegram([message]);
  //   }
  // };

  const runAction = async () => {
    if (cancelled) return;

    try {
      await asyncAction();
    } catch (err) {
      createConsoleMessage("error", err, "Error in asyncAction:");
      // await notifyTelegram([`🔴 Error in asyncAction: ${err.message}`]);
    }
  };

  const cancel = () => {
    cancelled = true;
    clearTimeout(timeoutIdMain);
    clearTimeout(timeoutIdWarn);
  };

  // ---- Open Chrome 4 minutes before submission ----
  // if (delayOpeningBrowser <= 0) {
  //   runOpenChrome();
  // } else {
  //   timeoutIdWarn = setTimeout(runOpenChrome, delayOpeningBrowser);
  // }

  // ---- Main execution at submission time ----
  if (delayMain <= 0) {
    runAction();
    return { cancel };
  }

  timeoutIdMain = setTimeout(runAction, delayMain);

  return { cancel };
};

export default waitMinutesThenRun;

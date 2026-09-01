/*
 *
 * Helper: `createReloadAndCheckIfShouldCreateNewPage`.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import closePageSafely from "./closePageSafely.mjs";

const createReloadAndCheckIfShouldCreateNewPage =
  (pauseController, pausableSleep, INTERVAL) =>
  async (page, logString = "", interval = false) => {
    const _interval = typeof interval === "number" ? interval : INTERVAL;

    try {
      const intervalTime = _interval + Math.random() * 8000;

      await pauseController.waitIfPaused();

      if (!page || !page?.reload) {
        await pausableSleep(intervalTime);

        createConsoleMessage(
          "warn",
          `Will recreate page on next loop iteration, refreshing in ${
            intervalTime / 1000
          }s...`,
        );
        return true;
      }

      createConsoleMessage(
        "info",
        `✅ ${logString} refreshing in ${intervalTime / 1000}s...`,
      );
      await pausableSleep(intervalTime);

      await pauseController.waitIfPaused();
      await page.reload({ waitUntil: "domcontentloaded" });
    } catch (err) {
      const intervalTime = _interval + Math.random() * 11_000;

      // page.reload() failed - the page is likely dead/unusable, and the
      // caller is about to discard its reference (page = null) and open a
      // fresh one next iteration. Close it here first, otherwise it's left
      // behind as an orphaned tab instead of being replaced.
      await closePageSafely(page);
      await pausableSleep(intervalTime);

      createConsoleMessage(
        "error",
        err,
        `Will recreate page on next loop iteration, refreshing in ${
          intervalTime / 1000
        }s...`,
      );
      return true;
    }
  };

export default createReloadAndCheckIfShouldCreateNewPage;

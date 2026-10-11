import sleep from "./sleep.mjs";

/** Bounded retries for read-only operations interrupted by navigation/network.
 * Does not retry HTTP authorization/validation errors or closed browsers.
 */
export default async function retryWaslaRead({ read, refreshContext, onRetry,
  attempts = 3, wait = sleep }) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let result;
    try {
      if (attempt > 1) await refreshContext();
      result = await read();
    } catch (error) {
      result = { success: false, error: error.message, patientDetailsError: error.message };
    }
    const error = result?.error || result?.patientDetailsError ||
      (result?.success === false ? result.message : "");
    if (!error || attempt === attempts ||
        !/Execution context was destroyed|Execution context is not available|Cannot find context|same JavaScript world|detached Frame|frame was detached|Failed to fetch|net::ERR_|Wasla token not available/i.test(error)) {
      return result;
    }
    onRetry?.({ attempt, error });
    await wait(attempt * 800);
  }
}

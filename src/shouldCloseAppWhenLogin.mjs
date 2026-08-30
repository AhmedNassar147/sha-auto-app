/*
 *
 * Helper: `shouldCloseAppWhenLogin`.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import getLoginErrors from "./getLoginErrors.mjs";

const shouldCloseAppWhenLogin = async (page) => {
  const errors = await getLoginErrors(page);

  const errorsLength = errors?.length ?? 0;

  if (errorsLength) {
    createConsoleMessage(
      "warn",
      `❌ Login errors: ${errors.join(", ")} sending errors to client...`,
    );

    const isErrorAboutLockedOut =
      errorsLength === 1 && errors[0].includes("locked out");

    const shouldCloseApp = errorsLength > 1 || !isErrorAboutLockedOut;

    await page.screenshot({
      path: `screenshots/login-error-${Date.now()}.png`,
    });

    return {
      shouldCloseApp,
      isErrorAboutLockedOut,
    };
  }

  return {
    shouldCloseApp: false,
  };
};

export default shouldCloseAppWhenLogin;

/*
 *
 * Helper: `getSehaSessionExpiry`.
 *
 * seha.sa stores its own session token, "JWTUserToken", in two places: as
 * an HttpOnly cookie (confirmed live via DevTools - app-images/seha-cookies
 * .png - so not readable from page JS) and, separately, as a plain
 * localStorage entry on the same page (confirmed via a captured live
 * session - not HttpOnly, so it IS readable via page.evaluate). It's a
 * standard JWT, so its payload carries a real `exp` claim (Unix seconds) -
 * this reads that directly off the dashboard page itself, not the Wasla
 * widget iframe (which has its own, separate `persist:auth` token and no
 * cookies at all - see app-images/wasla-seha-cookies.png - that's a
 * different session with a different lifetime, not this one).
 *
 * No signature verification is done or needed here: this only reads a
 * client-visible claim to decide when to proactively refresh, it isn't
 * used to authenticate or authorize anything.
 *
 */
const getSehaSessionExpiry = async (page) => {
  return page
    .evaluate(() => {
      try {
        const token = localStorage.getItem("JWTUserToken");
        if (!token) return null;

        const payloadSegment = token.split(".")[1];
        if (!payloadSegment) return null;

        const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
        const json = atob(base64);
        const payload = JSON.parse(json);
        console.log("getSehaSessionExpiry: payload:", payload);

        return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
      } catch {
        return null;
      }
    })
    .catch(() => null);
};

export default getSehaSessionExpiry;

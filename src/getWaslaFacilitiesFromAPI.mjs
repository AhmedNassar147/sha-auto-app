import { baseReferraAPiUrl } from "./constants.mjs";

/** Read facility responses inside a logged-in Wasla page/frame. No mutations. */
export default async function getWaslaFacilitiesFromAPI(context, navigationId) {
  return context.evaluate(
    async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const auth = JSON.parse(localStorage.getItem("persist:auth"));
        const token = auth?.token ? JSON.parse(auth.token) : null;
        if (!token)
          return { success: false, error: "Wasla token not available" };
        let organizationId = null;
        try {
          const encoded = token
            .split(".")[1]
            .replace(/-/g, "+")
            .replace(/_/g, "/");
          const claims = JSON.parse(
            atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
          );
          organizationId = claims.organization_id ?? claims.org ?? null;
        } catch {}
        const response = await fetch(url, {
          signal: controller.signal,
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            culture: localStorage.getItem("i18nextLng") || "en",
          },
        });
        const text = await response.text();
        if (!response.ok)
          return { success: false, error: `HTTP ${response.status}: ${text}` };
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          return { success: false, error: "Facilities response is not JSON" };
        }
        const facilities = Array.isArray(data) ? data : data?.data;
        if (!Array.isArray(facilities))
          return { success: false, error: "Facilities response has no array" };
        return { success: true, facilities, organizationId };
      } catch (error) {
        return { success: false, error: error.message };
      } finally {
        clearTimeout(timeout);
      }
    },
    `${baseReferraAPiUrl}/${encodeURIComponent(navigationId)}/facilities`,
  );
}

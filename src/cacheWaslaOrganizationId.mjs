import updateEnvFile from "./updateEnvFile.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";

/** Extract only the organization claim; never persist/log the JWT itself.
 * Decoding does not verify the token or confer approval permissions.
 */
export default async function cacheWaslaOrganizationId(context) {
  if (process.env.WASLA_ORG_ID) return process.env.WASLA_ORG_ID;

  const id = await context.evaluate(() => {
    try {
      const auth = JSON.parse(localStorage.getItem("persist:auth"));
      const token = auth?.token ? JSON.parse(auth.token) : null;
      if (!token) return null;
      const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const claims = JSON.parse(
        atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
      );
      const org = claims.organization_id ?? claims.org;
      return /^\d+$/.test(String(org)) ? String(org) : null;
    } catch {
      return null;
    }
  });
  if (id) {
    try {
      updateEnvFile({ WASLA_ORG_ID: id });
    } catch (error) {
      process.env.WASLA_ORG_ID = id;
      createConsoleMessage(
        "warn",
        `Could not persist WASLA_ORG_ID: ${error.message}`,
        "cacheWaslaOrganizationId",
      );
    }
  }
  return id;
}

/*
 *
 * Helper: `sendNtfyMessage`.
 *
 */
import getCurrentUserNtfyID from "./getCurrentUserNtfyID.mjs";
import { waitForPublicActionBaseUrl } from "./startCloudflareTunnel.mjs";

const sendNtfyMessage = async (message, referralId, withActions) => {
  const notifierID = getCurrentUserNtfyID();

  let actions = undefined;

  if (withActions && referralId) {
    const baseUrl = await waitForPublicActionBaseUrl();
    actions = [
      `http, Accept, ${baseUrl}/action?referralId=${referralId}&action=accept`,
      `http, Reject, ${baseUrl}/action?referralId=${referralId}&action=reject`,
      `http, Cancel, ${baseUrl}/action?referralId=${referralId}&action=cancel`,
      // `http, Online, ${baseUrl}/action?referralId=${referralId}&action=online`,
    ].join("; ");
  }

  return await fetch(`https://ntfy.sh/${notifierID}`, {
    method: "POST",
    body: message,
    headers: {
      Title: "CNHI",
      // https://github.com/cityssm/node-ntfy-publish/blob/main/emoji.js
      Tags: "rotating_light",
      // https://github.com/cityssm/node-ntfy-publish/blob/main/priorities.js
      Priority: "5", // Add this line for max priority,
      // Icon: "https://referralprogram.globemedsaudi.com/assets/MOHlogo-a80cbf2a.png",
      ...(actions
        ? {
            Actions: actions,
          }
        : null),
    },
  });
};

export default sendNtfyMessage;

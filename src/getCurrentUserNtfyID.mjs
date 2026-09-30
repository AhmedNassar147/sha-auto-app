/*
 *
 * Helper: `getCurrentUserNtfyID`.
 *
 */
const getCurrentUserNtfyID = (tagChatId) => {
  const { NTFY_BASE_ID, CLIENT_WHATSAPP_NUMBER, TG_CHAT_ID } = process.env;

  let phoneNumber = CLIENT_WHATSAPP_NUMBER;

  if (TG_CHAT_ID === "6585807478") {
    phoneNumber = process.env[`TG_PHONE_NUMBER_${TG_CHAT_ID}`];
  }

  if (tagChatId) {
    phoneNumber = process.env[`TG_PHONE_NUMBER_${tagChatId}`];
  }

  return `${phoneNumber}_${NTFY_BASE_ID}`;
};

export default getCurrentUserNtfyID;

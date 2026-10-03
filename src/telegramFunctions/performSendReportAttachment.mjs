/*
 *
 * Helper: `performSendReportAttachment`.
 *
 * Shared core for both installTelegramBotApi.mjs's `/attach` slash command
 * and the inline "📎 Report" button (sent alongside every watcher-chat
 * status update, see checkReferralSelectedStatus.mjs) - looks up the case's
 * cached report/merged attachment (base64, stored on its patients row by
 * installTelegramBotApi.mjs's saveAttachmentFileToDb) and resends it.
 * Takes `bot` explicitly since this standalone file can't close over the
 * one installTelegramBotApi.mjs creates (same reason performArrivalConfirmation/
 * performWithdrawal take `browser` explicitly).
 *
 */
import createConsoleMessage from "../createConsoleMessage.mjs";
import { getPatientByNavigationId, getPatient } from "../db.mjs";

/**
 * @param {object} params
 * @param {import("node-telegram-bot-api")} params.bot
 * @param {string} params.idArg - navigationId or referralId.
 * @param {string | number} params.chatId - Chat to send the document to.
 * @param {number} [params.msgId] - Message id to reply to, if any.
 * @returns {Promise<{ success: boolean, message: string }>}
 */
const performSendReportAttachment = async ({ bot, idArg, chatId, msgId }) => {
  if (!idArg || !/^[A-Za-z0-9]+$/.test(idArg)) {
    return { success: false, message: `⛔ Invalid ID \`${idArg}\`.` };
  }

  // Accepts either id - navigationId or referralId, same lookup as
  // /arrived and /withdraw.
  const storedPatient = getPatientByNavigationId(idArg) || getPatient(idArg);

  if (!storedPatient) {
    return {
      success: false,
      message: `⛔ No record found for ID \`${idArg}\`.`,
    };
  }

  const {
    referralId,
    attachmentFileBase64,
    attachmentFileName,
    attachmentFileMimeType,
  } = storedPatient;

  if (!attachmentFileBase64) {
    return {
      success: false,
      message: `⛔ No cached attachment file for referralId=\`${referralId}\`.`,
    };
  }

  try {
    await bot.sendDocument(
      chatId,
      Buffer.from(attachmentFileBase64, "base64"),
      {
        reply_to_message_id: msgId,
        caption: `📎 ${attachmentFileName || `Report-of_${referralId}`}`,
      },
      {
        filename: attachmentFileName || `${referralId}_attachment`,
        contentType: attachmentFileMimeType || "application/pdf",
      },
    );
  } catch (error) {
    createConsoleMessage(
      "error",
      error?.message || error,
      `sendDocument report referralId=${referralId}`,
    );
    return {
      success: false,
      message: `⛔ Failed to send attachment for referralId=\`${referralId}\`.`,
    };
  }

  return {
    success: true,
    message: `✅ Attachment sent for referralId=\`${referralId}\`.`,
  };
};

export default performSendReportAttachment;

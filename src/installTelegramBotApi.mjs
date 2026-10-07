/*
 *
 * Helper: `installTelegramBotApi`.
 *
 */
import TelegramBot from "node-telegram-bot-api";
import { unlink } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import createConsoleMessage from "./createConsoleMessage.mjs";
import {
  getCaseFile,
  upsertCaseFile,
  buildCaseFileKey,
  getPatient,
  updatePatients,
  getCasesForReport,
} from "./db.mjs";
import updateEnvFile from "./updateEnvFile.mjs";
import mergeAllToPdf from "./mergeFilesToOne.mjs";
import compressPdfGentlly from "./compressPdfGentlly.mjs";
import formatFilesToTelegram from "./formatFilesToTelgram.mjs";
import sleep from "./sleep.mjs";
import generateAcceptancePdfLetters from "./generatePdfs.mjs";
import getCurrentActionLetterFile from "./getCurrentActionLetterFile.mjs";
import notifyUserWithNewCase from "./notifyUserWithNewCase.mjs";
// import createAndSendInvoiceReport from "./createAndSendInvoiceReport.mjs";
import formatPatientToTelegramOrWA from "./formatPatientToTelegramOrWA.mjs";
import { USER_ACTION_TYPES, WASLA_STATUS_TYPES } from "./constants.mjs";
import handleUserActionOnCase from "./handleUserActionOnCase.mjs";
import sendNtfyMessage from "./sendNtfyMessage.mjs";
import getOrgLabel from "./getOrgLabel.mjs";
import performArrivalConfirmation from "./telegramFunctions/performArrivalConfirmation.mjs";
import performWithdrawal from "./telegramFunctions/performWithdrawal.mjs";
import performSendReportAttachment from "./telegramFunctions/performSendReportAttachment.mjs";

const execAsync = promisify(exec);

const ONLINE_CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;

const COMMANDS = {
  add: {
    value: /\/add/,
    description: "add yourself for authorization",
    command: "add",
  },
  me: {
    value: /\/me/,
    description: "make yourself active to receive and control cases",
    command: "me",
  },
  wait: {
    value: /\/wait(?:\s+(\d+))?$/,
    description:
      "Get or set the pre-fire buffer (SLEEP_BEFORE_ACCEPT_OR_REJECT_MS). Examples: /wait OR /wait 400",
    command: "wait",
  },
  cases: {
    value: /\/cases(?:\s+(.+))?$/,
    description:
      "List today/yesterday's cases. Examples: /cases (both days) OR /cases t (today only) OR /cases y (yesterday only) OR /cases a (approved only) OR /cases t a",
    command: "cases",
  },
  confirmArrival: {
    value: /\/arrived (.+)/,
    description:
      "Confirm arrival. Example: /arrived 13509 OR /arrived 13509 1210 OR /arrived 5AW0BELHL51HPFI 1210 note",
    command: "arrived",
  },
  withdrawReferral: {
    value: /\/withdraw (.+)/,
    description:
      "Withdraw acceptance. Example: /withdraw 13509 OR /withdraw 5AW0BELHL51HPFI reason",
    command: "withdraw",
  },
  getReferralAttachment: {
    value: /\/report (.+)/,
    description:
      "Get the referral Report. Example: /report 13509 OR /report 5AW0BELHL51HPFI",
    command: "report",
  },
  getReferralLetter: {
    value: /\/letter (.+)/,
    description:
      "Long press → get letter, Example: /letter a 5AW0BELHL51HPFI OR /letter r 5AW0BELHL51HPFI OR /letter r 5AW0BELHL51HPFI reason",
    command: "letter",
  },
  f_accept: {
    value: /\/f_accept$/,
    description: "get first patient to be accepted with time left details",
    command: "f_accept",
  },
  who: {
    value: /\/who/,
    description: "check who is on duty",
    command: "who",
  },
  activate: {
    value: /\/activate\s+(\d+)$/,
    description: "Activate another authorized user by chat ID",
    command: "activate",
  },
  getUsers: {
    value: /\/get_users$/,
    description: "List all authorized users and show active one",
    command: "get_users",
  },
  updateCode: {
    value: /\/update_code$/,
    description: "pull latest code from main and restart the server",
    command: "update_code",
  },
  getInvoiceFile: {
    value: /\/invoice(?:\s+(.*))?$/,
    description:
      "Get invoice report. Examples: /invoice or /invoice -f or /invoice -f -s",
    command: "invoice",
  },
  updateCmds: {
    value: /\/update_commands/,
    description: "update bot commands",
    command: "update_commands",
  },
  clearCmds: {
    value: /\/clear_commands/,
    description: "clear bot commands",
    command: "clear_commands",
  },
};

const buildButtons = (referralId) => ({
  inline_keyboard: [
    [
      { text: "✅ Accept", callback_data: `accept_${referralId}` },
      { text: "❌ Reject", callback_data: `reject_${referralId}` },
      { text: "❌ Cancel", callback_data: `cancel_${referralId}` },
    ],
    [
      { text: "🔕 No Reply", callback_data: `noreply_${referralId}` },
      { text: "⏳ Left Time", callback_data: `lefttime_${referralId}` },
      { text: "🟢 Online", callback_data: `online_${referralId}` },
    ],
  ],
});

const escapeTelegramHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const restoreTelegramHtmlTags = (value = "") =>
  value
    .replace(
      /&lt;(\/?(?:b|strong|i|em|u|s|strike|del|code|pre))&gt;/g,
      (_, tag) => {
        return `<${tag}>`;
      },
    )
    // The plain-tag regex above only matches attribute-less tags, so
    // <a href="...">, escaped the same way by escapeTelegramHtml, never
    // matched it and stayed as literal "<a href=...>" text instead of a
    // clickable link (seen live in a Telegram case-link message).
    .replace(/&lt;a href="([^"]*)"&gt;/g, (_, href) => `<a href="${href}">`)
    .replace(/&lt;\/a&gt;/g, "</a>");

const markdownToHtml = (value = "") => {
  const codes = [];

  value = value.replace(/`([^`]+?)`/g, (_, content) => {
    const token = `__CODE_BLOCK_${codes.length}__`;
    codes.push(`<code>${content}</code>`);
    return token;
  });

  value = value.replace(/\*(.*?)\*/g, "<b>$1</b>");

  codes.forEach((code, i) => {
    value = value.replace(`__CODE_BLOCK_${i}__`, code);
  });

  return value;
};

const prepareMessage = (message = "") => {
  let text = escapeTelegramHtml(message);
  text = markdownToHtml(text);
  text = restoreTelegramHtmlTags(text);

  return {
    text,
    parse_mode: "HTML",
  };
};

const getAllowedList = () =>
  process.env.TG_CHAT_IDS?.split(",")
    .map((id) => id.trim())
    .filter(Boolean) || [];

const getMessageData = (msg) => {
  const chatId = String(msg.chat.id);
  const fromName =
    msg.from.first_name || msg.chat.first_name || msg.from.last_name;

  return {
    chatId,
    fromName,
    msgId: msg.message_id,
  };
};

const getIfNotAuthorizedMessage = (msg, checkAdminChatId) => {
  const { chatId, fromName, msgId } = getMessageData(msg);
  const allowedList = getAllowedList();
  const isAuthorized = allowedList.includes(chatId);
  const adminChatId = process.env.ADMIN_CHAT_ID;

  let unAuthorizedMessage = isAuthorized
    ? undefined
    : `⛔ \`${fromName}\` you are not Authorized.`;

  if (!unAuthorizedMessage && checkAdminChatId && chatId !== adminChatId) {
    unAuthorizedMessage = `⛔ This command is restricted, it only responds to Ahmed.`;
  }

  return {
    chatId,
    msgId,
    fromName,
    allowedList,
    unAuthorizedMessage,
  };
};

const makeLetterGenerationAndReturnFile = async ({
  browser,
  patientData,
  reason,
  referralId,
  actionType,
}) => {
  try {
    const isAcceptanceLetter = actionType === USER_ACTION_TYPES.ACCEPT;

    const _patientData = {
      referralId,
      ...patientData,
      __reasonName__: !isAcceptanceLetter && !!reason ? reason : undefined,
    };

    await generateAcceptancePdfLetters(
      browser,
      [_patientData],
      isAcceptanceLetter,
    );

    const { fileData, filePath } = await getCurrentActionLetterFile(
      referralId,
      actionType,
      true,
    );

    try {
      await unlink(filePath);
    } catch (error) {
      createConsoleMessage(
        "error",
        error,
        `❌ makeLetterGenerationAndReturnFile failed when removing filePath=${filePath} :`,
      );
    }

    return fileData;
  } catch (error) {
    createConsoleMessage(
      "error",
      error,
      "❌ makeLetterGenerationAndReturnFile failed:",
    );
    return null; // caller already handles null
  }
};

const getActiveChatID = () => process.env.TG_CHAT_ID;

const installTelegramBotApi = async (TG_TOKEN, patientsStore, browser) => {
  const bot = new TelegramBot(TG_TOKEN, { polling: true, filepath: false });

  createConsoleMessage("info", "🤖 Telegram Case Bot is running...");

  if (!getActiveChatID()) {
    createConsoleMessage(
      "warn",
      "⚠️ TG_CHAT_ID not set — send /me to the bot first",
    );
  }

  const getChatName = async (chatId) => {
    try {
      const chat = await bot.getChat(chatId);
      return chat.first_name || chat.last_name || chat.username || chatId;
    } catch {
      return chatId;
    }
  };

  const pendingContactRequests = new Map();
  const pendingOnlineChecks = new Map();

  const sendBotMessage = async (chatId, message, options = {}) => {
    const { parse_mode, text } = prepareMessage(message);

    return await bot.sendMessage(chatId, text, {
      parse_mode: parse_mode,
      ...(options || null),
    });
  };

  const processNextOnlineCheck = async (referralId) => {
    const pending = pendingOnlineChecks.get(referralId);

    if (!pending || pending.confirmed) return;

    const allowedList = getAllowedList();

    if (!allowedList.length) {
      pendingOnlineChecks.delete(referralId);
      return;
    }

    const nextIndex = (pending.currentIndex + 1) % allowedList.length;
    const nextChatId = allowedList[nextIndex];

    if (!nextChatId || pending.sentChatIds.includes(nextChatId)) {
      await Promise.all(
        pending.sentChatIds.map((chatId) =>
          sendBotMessage(
            chatId,
            `⚠️ No one confirmed online for Referral ID: \`${referralId}\`.`,
          ).catch(() => null),
        ),
      );

      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }

      pendingOnlineChecks.delete(referralId);
      return;
    }

    pending.currentIndex = nextIndex;
    pending.sentChatIds.push(nextChatId);

    await sendTelegramMessage(
      pending.message,
      pending.files,
      referralId,
      nextChatId,
      true,
    );

    const patientData = patientsStore.getPatientByReferralId(referralId);
    await notifyUserWithNewCase(patientData);

    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }

    pending.timeoutId = setTimeout(() => {
      processNextOnlineCheck(referralId);
    }, ONLINE_CONFIRM_TIMEOUT_MS);
  };

  /**
   * Best-effort caches a case's report/merged attachment as base64 on its
   * patients row - unlike /letter's tgFileId cache, this never expires and
   * doesn't depend on Telegram at all (works via /attach or the Report
   * button regardless of which channel first delivered the case, Telegram,
   * ntfy, or WhatsApp). A write failure (e.g. the row not existing yet)
   * shouldn't affect the actual send, so this only logs.
   *
   * @param {object} params
   * @param {string} params.referralId
   * @param {Buffer} params.buffer
   * @param {string} params.filename
   * @param {string} params.mimeType
   * @returns {void}
   */
  const saveAttachmentFileToDb = ({
    referralId,
    buffer,
    filename,
    mimeType,
  }) => {
    try {
      updatePatients({
        referralId,
        attachmentFileBase64: buffer.toString("base64"),
        attachmentFileName: filename,
        attachmentFileMimeType: mimeType,
      });
    } catch (error) {
      createConsoleMessage(
        "warn",
        error?.message || error,
        `⚠️ saveAttachmentFileToDb failed for referralId=${referralId}`,
      );
    }
  };

  const sendTelegramMessage = async (
    message,
    _files = [],
    targetReferralIdForButtons,
    overrideChatId = null,
    skipOnlineCheckCreation = false,
    extraReplyMarkup = null,
  ) => {
    const TG_CHAT_ID = overrideChatId || getActiveChatID();

    if (!TG_CHAT_ID) {
      createConsoleMessage(
        "warn",
        "⚠️ sendTelegramMessage skipped — send /start to the bot first",
      );
      return;
    }

    try {
      let messageId = undefined;

      if (message) {
        const res = await sendBotMessage(TG_CHAT_ID, message, {
          disable_notification: false,
          ...((targetReferralIdForButtons || extraReplyMarkup) && {
            reply_markup: targetReferralIdForButtons
              ? buildButtons(targetReferralIdForButtons)
              : extraReplyMarkup,
          }),
        });

        messageId = res.message_id;

        if (targetReferralIdForButtons && !skipOnlineCheckCreation) {
          const allowedList = getAllowedList();

          const startIndex = Math.max(allowedList.indexOf(TG_CHAT_ID), 0);

          const timeoutId = setTimeout(() => {
            processNextOnlineCheck(targetReferralIdForButtons);
          }, ONLINE_CONFIRM_TIMEOUT_MS);

          pendingOnlineChecks.set(targetReferralIdForButtons, {
            referralId: targetReferralIdForButtons,
            message,
            files: _files,
            confirmed: false,
            confirmedBy: null,
            sentChatIds: [TG_CHAT_ID],
            currentIndex: startIndex,
            timeoutId,
          });
        }
      }

      const { docs, photos, excelFiles } = await formatFilesToTelegram(_files);

      if (excelFiles.length) {
        // Send PDFs individually
        for (const doc of excelFiles) {
          await bot.sendDocument(
            TG_CHAT_ID,
            doc.buffer,
            { reply_to_message_id: messageId, caption: doc.caption },
            { filename: doc.filename, contentType: doc.mimeType },
          );
        }
      }

      if (photos.length === 0 && docs.length === 0) {
        return;
      }

      if (photos.length === 0 && docs.length === 1) {
        const [{ buffer, filename, mimeType, caption }] = docs;
        await bot.sendDocument(
          TG_CHAT_ID,
          buffer,
          { reply_to_message_id: messageId, caption: caption },
          { filename: filename, contentType: mimeType },
        );

        if (targetReferralIdForButtons) {
          saveAttachmentFileToDb({
            referralId: targetReferralIdForButtons,
            buffer,
            filename,
            mimeType,
          });
        }

        return;
      }

      if (photos.length === 1 && docs.length === 0) {
        const [{ buffer, filename, mimeType, caption }] = photos;
        await bot.sendPhoto(
          TG_CHAT_ID,
          buffer,
          { reply_to_message_id: messageId, caption: caption },
          { filename: filename, contentType: mimeType },
        );

        if (targetReferralIdForButtons) {
          saveAttachmentFileToDb({
            referralId: targetReferralIdForButtons,
            buffer,
            filename,
            mimeType,
          });
        }

        return;
      }

      const { baseName } =
        [...docs, ...photos].find(
          ({ filename, baseName }) => !!(filename && baseName),
        ) ?? {};

      const finalMergedFileName = `${baseName || targetReferralIdForButtons}_merged.pdf`;

      const merged = await mergeAllToPdf(
        photos || [],
        docs || [],
        finalMergedFileName,
      );

      const { compressedMerged } = await compressPdfGentlly(merged, {
        unlinkFilesFinally: true,
      });

      await bot.sendDocument(
        TG_CHAT_ID,
        compressedMerged,
        {
          reply_to_message_id: messageId,
          caption: baseName || "",
        },
        {
          filename: finalMergedFileName,
          contentType: "application/pdf",
        },
      );

      if (targetReferralIdForButtons) {
        saveAttachmentFileToDb({
          referralId: targetReferralIdForButtons,
          buffer: compressedMerged,
          filename: finalMergedFileName,
          mimeType: "application/pdf",
        });
      }

      // Send photos as album (batches of 10)
      for (let i = 0; i < photos.length; i += 10) {
        const batch = photos.slice(i, i + 10);
        await bot.sendMediaGroup(
          TG_CHAT_ID,
          batch.map((f, idx) => ({
            type: "photo",
            media: f.buffer,
            fileOptions: { contentType: f.mimeType, filename: f.filename },
          })),
          {
            reply_to_message_id: messageId,
          },
        );
      }

      // Send PDFs individually
      for (const doc of docs) {
        await bot.sendDocument(
          TG_CHAT_ID,
          doc.buffer,
          { reply_to_message_id: messageId, caption: doc.caption },
          { filename: doc.filename, contentType: doc.mimeType },
        );
      }
    } catch (error) {
      createConsoleMessage("error", error, "❌ sendTelegramMessage failed:");
    }
  };

  /**
   * Mirrors an /arrived or /withdraw result to the watcher chat, unless
   * that's already where it was triggered from (clicking the Confirm
   * Arrival/Withdraw button, whose message only ever lives in the watcher
   * chat - see checkReferralSelectedStatus.mjs/handleSubmitReferral.mjs)
   * - otherwise the watcher would get the same result message twice.
   *
   * @param {string} triggeringChatId - The chat the action was actually
   *   run from (the slash command's own chatId, or the callback_query's
   *   messageChatId for a button click).
   * @param {string} message
   * @returns {Promise<void>}
   */
  const notifyWatcherIfDifferentChat = async (triggeringChatId, message) => {
    const { VERIFICATION_CODE_WATCHER_CHAT_ID } = process.env;

    if (!VERIFICATION_CODE_WATCHER_CHAT_ID) return;
    if (
      String(triggeringChatId) === String(VERIFICATION_CODE_WATCHER_CHAT_ID)
    ) {
      return;
    }

    await sendTelegramMessage(
      message,
      [],
      undefined,
      VERIFICATION_CODE_WATCHER_CHAT_ID,
      true,
    ).catch(() => {});
  };

  /**
   * Sends a letter to the given chat and caches its Telegram file_id under
   * its own (action-specific) key - a Telegram file_id can only ever be
   * minted by actually sending the file somewhere, there's no "upload
   * without sending" option. Used by the callback_query handler's
   * onAcceptOrRejectForFileUpload to cache both the taken action's letter
   * and (best-effort) the other one.
   *
   * @param {object} params
   * @param {string} params.referralId
   * @param {string} params.letterAction - "accept" or "reject".
   * @param {string} params.messageChatId
   * @param {number} params.msgId
   * @returns {Promise<string | null>} The Telegram file_id, or null if the
   *   letter wasn't available or the send failed.
   */
  const sendAndCacheLetter = async ({
    referralId,
    letterAction,
    messageChatId,
    msgId,
  }) => {
    const { fileData } =
      (await getCurrentActionLetterFile(referralId, letterAction, true).catch(
        () => null,
      )) || {};

    if (!fileData) {
      createConsoleMessage(
        "error",
        `❌ fileData not found for action=${letterAction} and referralId=${referralId}`,
      );
      return null;
    }

    const fileName = `${letterAction}_${referralId}`;

    const documentResponse = await bot
      .sendDocument(
        messageChatId,
        fileData,
        { reply_to_message_id: msgId, caption: `📎 ${fileName}` },
        { filename: `${fileName}.pdf`, contentType: "application/pdf" },
      )
      .catch((err) => {
        createConsoleMessage(
          "error",
          err?.message || err,
          `sendDocument ${fileName}`,
        );

        return null;
      });

    const fileId = documentResponse?.document?.file_id;

    if (fileId) {
      upsertCaseFile(referralId, letterAction, fileId);
    } else if (documentResponse) {
      // sendDocument resolved but the response had no file_id - distinct
      // from the already-logged send failure above (that one rejects).
      createConsoleMessage(
        "error",
        `❌ sendDocument for ${fileName} resolved without a file_id`,
      );
    }

    return fileId ?? null;
  };

  const safeOnText = (regex, handler) => {
    bot.onText(regex, async (msg, match) => {
      try {
        await handler(msg, match);
      } catch (error) {
        createConsoleMessage(
          "error",
          error,
          `❌ command handler failed for "${msg.text}":`,
        );

        await sendBotMessage(
          String(msg.chat.id),
          `⛔ Something went wrong handling this command: ${error?.message || error}`,
        ).catch(() => null);
      }
    });
  };

  async function setupCommands() {
    const commands = Object.values(COMMANDS)
      .filter((item) => item.command !== "add")
      .map((item) => ({
        command: item.command,
        description: item.description,
      }));

    const TG_CHAT_ID = getActiveChatID();

    await bot.setMyCommands(commands, { scope: { type: "default" } });

    // also set for the active chat specifically so it takes precedence
    if (TG_CHAT_ID) {
      await bot.setMyCommands(commands, {
        scope: { type: "chat", chat_id: TG_CHAT_ID },
      });
    }

    createConsoleMessage("info", "commandsSet");
  }

  safeOnText(COMMANDS.me.value, async (msg) => {
    const { chatId, fromName, unAuthorizedMessage } =
      getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    const activeChatId = getActiveChatID();

    if (activeChatId === chatId) {
      await sendBotMessage(
        chatId,
        `✅ Hi, \`${fromName}\` you are already active.`,
      );
      return;
    }

    updateEnvFile({
      TG_CHAT_ID: chatId,
      TG_CHAT_USER_NAME: fromName,
      CLIENT_WHATSAPP_NUMBER: process.env[`TG_PHONE_NUMBER_${chatId}`],
    });

    await sleep(1000);

    if (activeChatId) {
      await sendBotMessage(
        activeChatId,
        `🔔 \`${fromName}\` is now active and will receive cases. You are off duty.`,
      );
    }
    await sendBotMessage(
      chatId,
      `✅ Hi, \`${fromName}\` you are active now, cases will be sent for you here, Chat ID \`${chatId}\` has been saved automatically.`,
    );

    const allPatients = patientsStore.getAllPatients();

    if (allPatients?.length) {
      await sendBotMessage(
        chatId,
        `<b>Current patients:</b>\n<pre>Here are the current (${allPatients.length}) patients to process</pre>`,
      );

      const applicablePatients = allPatients.filter(
        (patient) => patient?.referralEndTimestamp >= Date.now(),
      );

      const formatedPatients = applicablePatients.map((patient) =>
        formatPatientToTelegramOrWA(patient, true),
      );

      await Promise.all(
        formatedPatients.map(({ message, files, referralId }) =>
          sendTelegramMessage(message, files, referralId, chatId, true),
        ),
      );
    }
  });

  safeOnText(COMMANDS.activate.value, async (msg, match) => {
    const { unAuthorizedMessage, chatId, fromName, allowedList } =
      getIfNotAuthorizedMessage(msg, true);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    const targetChatId = match?.[1];

    if (!allowedList.includes(targetChatId)) {
      return await sendBotMessage(
        chatId,
        `⛔ Chat ID \`${targetChatId}\` is not authorized.`,
      );
    }

    const previousChatId = getActiveChatID();

    if (previousChatId === targetChatId) {
      return await sendBotMessage(
        chatId,
        `⛔ Chat ID \`${targetChatId}\` is already active.`,
      );
    }

    const targetName = await getChatName(targetChatId);

    updateEnvFile({
      TG_CHAT_ID: targetChatId,
      TG_CHAT_USER_NAME: targetName,
      CLIENT_WHATSAPP_NUMBER: process.env[`TG_PHONE_NUMBER_${targetChatId}`],
    });

    await sleep(1000);

    await sendBotMessage(
      chatId,
      `✅ Activated \`${targetName}\` (\`${targetChatId}\`).`,
    );

    await sendBotMessage(
      targetChatId,
      `🟢 Ahmed Just put you on duty, You are now active and will receive cases.`,
    ).catch(() => null);

    if (previousChatId && previousChatId !== targetChatId) {
      await sendBotMessage(
        previousChatId,
        `⚪ You are no longer active.\n` +
          `🔔 \`${fromName}\` switched active duty to \`${targetName}\`.`,
      ).catch(() => null);
    }
  });

  safeOnText(COMMANDS.who.value, async (msg) => {
    const { unAuthorizedMessage, chatId } = getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      return sendBotMessage(chatId, unAuthorizedMessage);
    }

    const activeChatId = getActiveChatID();

    if (!activeChatId) {
      return sendBotMessage(chatId, `⚠️ No one is currently on duty.`);
    }

    const chatName = await getChatName(activeChatId);

    await sendBotMessage(
      chatId,
      `👮 *Duty Status*\n` +
        `────────────────────────\n` +
        `🟢 *Active:* \`${chatName || "Unknown"}\` — \`${activeChatId}\``,
    );
  });

  bot.on("contact", async (msg) => {
    try {
      const chatId = String(msg.chat.id);
      const pending = pendingContactRequests.get(chatId);

      if (!pending) return;

      const phoneNumber = msg.contact?.phone_number;

      if (!phoneNumber) {
        await sendBotMessage(chatId, "❌ No phone number received.");
        return;
      }

      // Optional but recommended: make sure user shared HIS OWN phone
      if (msg.contact.user_id && msg.contact.user_id !== msg.from.id) {
        await sendBotMessage(chatId, "❌ Please share your own phone number.");
        return;
      }

      pendingContactRequests.delete(chatId);

      const { allowedList, fromName } = pending;

      updateEnvFile({
        TG_CHAT_IDS: [
          ...new Set([...allowedList, chatId].filter(Boolean)),
        ].join(","),
        [`TG_PHONE_NUMBER_${chatId}`]: phoneNumber,
      });
      await setupCommands();
      await sleep(1000);

      await sendBotMessage(
        chatId,
        `✅ Hi, \`${fromName}\` you are added now, Please send /me to get activated, Chat ID \`${chatId}\` has been saved automatically. Phone: \`${phoneNumber}\``,
        {
          reply_markup: {
            remove_keyboard: true,
          },
        },
      );
    } catch (error) {
      createConsoleMessage("error", error, `❌ "contact" handler failed:`);
    }
  });

  safeOnText(COMMANDS.add.value, async (msg) => {
    const { allowedList, chatId, fromName, unAuthorizedMessage } =
      getIfNotAuthorizedMessage(msg);

    if (!unAuthorizedMessage) {
      await sendBotMessage(
        chatId,
        `⛔ Hi, \`${fromName}\` you are already Authorized.`,
      );
      return;
    }

    pendingContactRequests.set(chatId, {
      allowedList,
      fromName,
    });

    await bot.sendMessage(chatId, "Share your phone number", {
      reply_markup: {
        keyboard: [
          [
            {
              text: "Share Phone",
              request_contact: true,
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  });

  safeOnText(COMMANDS.getUsers.value, async (msg) => {
    const { unAuthorizedMessage, chatId, allowedList } =
      getIfNotAuthorizedMessage(msg, true);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    if (!allowedList.length) {
      return await sendBotMessage(chatId, `⚠️ No authorized users found.`);
    }

    const activeChatId = getActiveChatID();

    const users = await Promise.all(
      allowedList.map(async (id) => {
        const name = await getChatName(id);

        const isActive = id === activeChatId;

        return `${isActive ? "🟢" : "⚪"} ` + `\`${name}\` → \`${id}\``;
      }),
    );

    await sendBotMessage(
      chatId,
      `👥 *Authorized Users*\n` +
        `────────────────────────\n\n` +
        users.join("\n\n"),
    );
  });

  safeOnText(COMMANDS.wait.value, async (msg, match) => {
    const { chatId, unAuthorizedMessage, fromName } =
      getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    const raw = match?.[1];

    const currentWait = process.env.SLEEP_BEFORE_ACCEPT_OR_REJECT_MS;

    // GET CURRENT
    if (!raw) {
      return await sendBotMessage(
        chatId,
        `✅ Current pre-fire buffer is \`${currentWait}\`ms.`,
      );
    }

    // SET NEW
    const value = parseInt(raw, 10);

    const minValue = 0;

    if (!Number.isFinite(value) || value < minValue) {
      return await sendBotMessage(
        chatId,
        `⛔ Invalid value \`${raw}\`.\nIt should be a number greater than or equal to ${minValue}.\nUsage:\n/wait\n/wait 400`,
      );
    }

    if (currentWait === String(value)) {
      return await sendBotMessage(
        chatId,
        `⛔ Pre-fire buffer is already \`${value}\`ms.`,
      );
    }

    updateEnvFile({ SLEEP_BEFORE_ACCEPT_OR_REJECT_MS: value });

    await sendBotMessage(
      chatId,
      `✅ Pre-fire buffer updated from \`${currentWait}\`ms to \`${value}\`ms.`,
    );

    const activeChatId = getActiveChatID();

    if (activeChatId !== chatId) {
      await sendBotMessage(
        activeChatId,
        `🔔 \`${fromName}\` changed the pre-fire buffer from \`${currentWait}\`ms to \`${value}\`ms.`,
      );
    }
  });

  safeOnText(COMMANDS.cases.value, async (msg, match) => {
    const { chatId, unAuthorizedMessage } = getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    const tokens = (match?.[1] || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const validTokens = ["t", "y", "a"];
    const invalidTokens = tokens.filter(
      (token) => !validTokens.includes(token),
    );

    if (invalidTokens.length) {
      return await sendBotMessage(
        chatId,
        `⛔ Unknown flag(s): \`${invalidTokens.join(", ")}\`.\nUsage:\n/cases\n/cases t\n/cases y\n/cases a\n/cases t a`,
      );
    }

    const dayFilter = tokens.includes("y")
      ? "yesterday"
      : tokens.includes("t")
        ? "today"
        : "all";
    const onlyApproved = tokens.includes("a");

    const cases = getCasesForReport({ dayFilter, onlyApproved });

    const dayLabel =
      dayFilter === "today"
        ? "Today's"
        : dayFilter === "yesterday"
          ? "Yesterday's"
          : "Today + Yesterday's";
    const approvedLabel = onlyApproved ? " (approved only)" : "";

    if (!cases.length) {
      return await sendBotMessage(
        chatId,
        `📭 No cases found for ${dayLabel}${approvedLabel}.`,
      );
    }

    const caseBlocks = cases.map((patient, index) => {
      const statusLabel =
        WASLA_STATUS_TYPES[Number(patient.status)] || patient.status || "-";
      const claimedBadge =
        patient.claimed === "Yes"
          ? "✅ Yes"
          : patient.claimed === "No"
            ? "❌ No"
            : "⏳ Pending";

      return (
        `(${index + 1})- \`${patient.navigationId || "-"}\` · ID: \`${patient.referralId}\`\n` +
        `${patient.patientName || "-"}\n` +
        `ReferralDate: ${patient.referralDate || "-"}\n` +
        `ReferralEndDate: ${patient.referralEndDate || "-"}\n` +
        `${statusLabel} — Claimed: ${claimedBadge}`
      );
    });

    const header = `📋 *${dayLabel} Cases${approvedLabel}* (${cases.length})\n────────────────────────\n\n`;

    // Telegram caps a single message at 4096 chars - this list can easily
    // exceed that on a busy day, so blocks are packed into as few messages
    // as fit rather than always sending one (likely-truncated-by-Telegram)
    // message.
    const MAX_MESSAGE_LENGTH = 3500;
    const chunks = [];
    let currentChunk = header;

    for (const block of caseBlocks) {
      if (
        currentChunk !== header &&
        currentChunk.length + block.length + 2 > MAX_MESSAGE_LENGTH
      ) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      currentChunk += `${block}\n\n`;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    for (const chunk of chunks) {
      await sendBotMessage(chatId, chunk);
    }
  });

  safeOnText(COMMANDS.f_accept.value, async (msg, match) => {
    const { unAuthorizedMessage, chatId, fromName, msgId } =
      getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    const firstGoingToAccept = patientsStore.getFirstGoingToAccept(true);

    if (!firstGoingToAccept) {
      return await sendBotMessage(
        chatId,
        `⛔ Currently there is no patient going to be accepted.`,
        {
          reply_to_message_id: msgId,
        },
      );
    }

    const { referralId, patientName } = firstGoingToAccept;
    const { message, timeMs } = patientsStore.getReferralLeftTime(referralId);

    await sendBotMessage(
      chatId,
      `✅ Referral ID: \`${referralId}\` Patient: ${patientName}\n` +
        `${message}`,
      {
        reply_to_message_id: msgId,
      },
    );
  });

  safeOnText(COMMANDS.getReferralLetter.value, async (msg, match) => {
    const { unAuthorizedMessage, chatId, fromName, msgId } =
      getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    const raw = (match[1] || "").trim();

    const parts = raw.split(/\s+/); // split by spaces
    const action = parts[0]?.toLowerCase(); // "a" or "r"
    const referralId = parts[1]; // "5AW0BELHL51HPFI"
    const reason = (parts.slice(2) || []).join(" "); // "some reason" or ""

    if (!["a", "r"].includes(action)) {
      return sendBotMessage(
        chatId,
        `⛔ Invalid action \`${action}\`.\nUse *a* for accept or *r* for reject.\nExample: \`/letter a 5AW0BELHL51HPFI\``,
      );
    }

    // Wasla referral ids are alphanumeric (e.g. "5AW0BELHL51HPFI"), unlike
    // the old GlobeMed system's purely numeric ones this check used to
    // assume - a digits-only regex here rejected every real Wasla id.
    if (!referralId || !/^[A-Za-z0-9]+$/.test(referralId)) {
      return sendBotMessage(
        chatId,
        `⛔ Invalid referral ID \`${referralId}\`.\nExample: \`/letter a 5AW0BELHL51HPFI\``,
      );
    }

    const actionType =
      action === "a" ? USER_ACTION_TYPES.ACCEPT : USER_ACTION_TYPES.REJECT;

    if (!reason) {
      const record = getCaseFile(buildCaseFileKey(referralId, actionType));
      const { tgFileId } = record || {};

      if (tgFileId) {
        try {
          const fileMessage = `✅ Cached letter served for Referral ID: \`${referralId}\` and action: \`${actionType}\`.`;
          await sendBotMessage(chatId, fileMessage, {
            reply_to_message_id: msgId,
          });

          await bot.sendDocument(chatId, tgFileId, {
            reply_to_message_id: msgId,
            caption: `📎 ${actionType}_${referralId}`,
          });

          createConsoleMessage("info", fileMessage);

          return;
        } catch (err) {
          createConsoleMessage(
            "warn",
            err?.message || err,
            `cached file resend failed referralId=${referralId}`,
          );
        }
      }
    }

    let patientData = patientsStore.getPatientByReferralId(referralId);

    if (!patientData) {
      // The in-memory store evicts a case once it's resolved, but its data
      // (patientName, nationality, specialty, mobileNumber, etc. - now all
      // persisted columns, see db.mjs) still lives in the DB row - no need
      // to open a new tab and re-fetch from the live Wasla API for data we
      // already saved at collection time.
      const storedPatient = getPatient(referralId);

      if (!storedPatient) {
        return await sendBotMessage(
          chatId,
          `⛔ No record found for referralId=\`${referralId}\`.`,
          {
            reply_to_message_id: msgId,
          },
        );
      }

      // The DB row's own `createdAt` column is row-insertion bookkeeping
      // (see db.mjs's toDbRow comment), not the real referral date -
      // that's `referralDate` - but makeLetterGenerationAndReturnFile
      // expects a `createdAt` field to derive the letter's printed date.
      patientData = {
        ...storedPatient,
        createdAt: storedPatient.referralDate,
      };
    }

    const fileBuffer = await makeLetterGenerationAndReturnFile({
      actionType,
      browser,
      patientData,
      reason,
      referralId,
    });

    if (!fileBuffer) {
      return await sendBotMessage(
        chatId,
        `⛔ Could not generate the letter for referralId=\`${referralId}\`, please try again`,
        {
          reply_to_message_id: msgId,
        },
      );
    }

    const fileName = `letter_${actionType}_${referralId}`;

    await bot.sendDocument(
      chatId,
      fileBuffer,
      { reply_to_message_id: msgId, caption: `📎 ${fileName}` },
      { filename: `${fileName}.pdf`, contentType: "application/pdf" },
    );
  });

  safeOnText(COMMANDS.confirmArrival.value, async (msg, match) => {
    const { unAuthorizedMessage, chatId, msgId } =
      getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    const raw = (match[1] || "").trim();
    const parts = raw.split(/\s+/);
    const idArg = parts[0];

    // Since notes are also optional free text, whether the second token IS
    // a time is decided (both here and inside performArrivalConfirmation)
    // by whether it looks like one (all digits, 3-4 of them) - anything
    // else is treated as the start of notes instead.
    const maybeTime = parts[1];
    const timeGiven = !!maybeTime && /^\d{3,4}$/.test(maybeTime);
    const notes = (timeGiven ? parts.slice(2) : parts.slice(1)).join(" ");

    const { message } = await performArrivalConfirmation({
      browser,
      idArg,
      maybeTime,
      notes,
    });

    await notifyWatcherIfDifferentChat(chatId, message);

    return sendBotMessage(chatId, message, { reply_to_message_id: msgId });
  });

  safeOnText(COMMANDS.withdrawReferral.value, async (msg, match) => {
    const { unAuthorizedMessage, chatId, msgId } =
      getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    const raw = (match[1] || "").trim();
    const parts = raw.split(/\s+/);
    const idArg = parts[0];
    const notes = parts.slice(1).join(" ");

    const { message } = await performWithdrawal({ browser, idArg, notes });

    await notifyWatcherIfDifferentChat(chatId, message);

    return sendBotMessage(chatId, message, { reply_to_message_id: msgId });
  });

  safeOnText(COMMANDS.getReferralAttachment.value, async (msg, match) => {
    const { unAuthorizedMessage, chatId, msgId } =
      getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    const idArg = (match[1] || "").trim().split(/\s+/)[0];

    const { success, message } = await performSendReportAttachment({
      bot,
      idArg,
      chatId,
      msgId,
    });

    if (!success) {
      return sendBotMessage(chatId, message, { reply_to_message_id: msgId });
    }
  });

  // safeOnText(COMMANDS.getInvoiceFile.value, async (msg, match) => {
  //   const { unAuthorizedMessage, chatId, msgId } = getIfNotAuthorizedMessage(
  //     msg,
  //     true,
  //   );

  //   if (unAuthorizedMessage) {
  //     await sendBotMessage(chatId, unAuthorizedMessage, {
  //       reply_to_message_id: msgId,
  //     });
  //     return;
  //   }

  //   const args = (match?.[1] || "").split(/\s+/).filter(Boolean);

  //   const allowedArgs = ["-f", "-s"];
  //   const invalidArgs = args.filter((arg) => !allowedArgs.includes(arg));

  //   if (invalidArgs.length) {
  //     await sendBotMessage(
  //       chatId,
  //       `⛔ Invalid arguments: ${invalidArgs.join(", ")}\n\nAllowed:\n/invoice\n/invoice -f\n/invoice -f -s`,
  //       {
  //         reply_to_message_id: msgId,
  //       },
  //     );

  //     return;
  //   }

  //   const isFinal = args.includes("-f");
  //   const skipValidation = args.includes("-s");

  //   if (skipValidation && !isFinal) {
  //     await sendBotMessage(
  //       chatId,
  //       `⛔ "-s" can only be used with "-f"\n\nExamples:\n/invoice -f\n/invoice -f -s`,
  //       {
  //         reply_to_message_id: msgId,
  //       },
  //     );

  //     return;
  //   }

  //   try {
  //     await sendBotMessage(chatId, `✅ Preparing Invoice Report....`, {
  //       reply_to_message_id: msgId,
  //     });

  //     const { message, files } = await createAndSendInvoiceReport(
  //       browser,
  //       !isFinal,
  //       skipValidation,
  //     );

  //     await sendTelegramMessage(message, files, null, chatId, true);
  //   } catch (error) {
  //     await sendBotMessage(chatId, `⛔ Error: ${error?.message || error}`, {
  //       reply_to_message_id: msgId,
  //     });
  //   }
  // });

  safeOnText(COMMANDS.updateCode.value, async (msg) => {
    const { unAuthorizedMessage, chatId } = getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      return await sendBotMessage(chatId, unAuthorizedMessage);
    }

    const gitOptions = { cwd: process.cwd() };

    try {
      await sendBotMessage(chatId, `🔄 Checking for updates...`);

      // 1. Check for local uncommitted changes
      const { stdout: localChangesRaw } = await execAsync(
        "git status --porcelain",
        gitOptions,
      );
      const localChanges = localChangesRaw.trim();

      if (localChanges) {
        return sendBotMessage(
          chatId,
          `⚠️ Local changes detected — cannot pull:\n<pre>${localChanges}</pre>\n\n` +
            `Please tell Ahmed Nassar to fix this.`,
        );
      }

      // 2. Get current commit
      const { stdout: beforeHashRaw } = await execAsync(
        "git rev-parse --short HEAD",
        gitOptions,
      );
      const beforeHash = beforeHashRaw.trim();

      // 3. Fetch latest from remote
      await execAsync("git fetch origin", gitOptions);

      // 4. Check if already up to date
      const { stdout: statusRaw } = await execAsync(
        "git status -uno",
        gitOptions,
      );
      const isUpToDate = statusRaw.trim().includes("Your branch is up to date");

      if (isUpToDate) {
        return sendBotMessage(
          chatId,
          `✅ Already up to date. No restart needed.\n\`Commit: ${beforeHash}\``,
        );
      }

      // 5. Get commits that WILL change (before pulling)
      const { stdout: logPreviewRaw } = await execAsync(
        "git log HEAD..origin/main --oneline",
        gitOptions,
      );
      const logPreview = logPreviewRaw.trim();

      // 6. Notify user BEFORE pulling — message sends before nodemon restarts

      await sendBotMessage(
        chatId,
        `✅ Code updated successfully!\n\n` +
          `📦 <b>Changes:</b>\n<pre>${logPreview || "No log available"}</pre>\n\n` +
          `🔁 <b>Current commit:</b> <code>${beforeHash}</code>\n\n` +
          `⏳ Pulling and restarting server...\n\n` +
          `🔁 <b>Please check if the app is running after restart</b>`,
      );

      await sleep(1000); // wait after second message before pulling
      await execAsync("git pull --rebase origin main", gitOptions);
    } catch (err) {
      createConsoleMessage("error", err, "❌ updatecode failed:");
      await sendBotMessage(
        chatId,
        `❌ Update failed:\n<pre>${err.message}</pre>`,
      );
    }
  });

  safeOnText(COMMANDS.clearCmds.value, async (msg) => {
    const { unAuthorizedMessage, chatId } = getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    await bot.deleteMyCommands({ scope: { type: "default" } });
    await bot.deleteMyCommands({ scope: { type: "all_private_chats" } });
    await bot.deleteMyCommands({ scope: { type: "all_group_chats" } });
    await bot.deleteMyCommands({
      scope: { type: "all_chat_administrators" },
    });

    await bot.deleteMyCommands({
      scope: {
        type: "chat",
        chat_id: chatId,
      },
    });

    await sendBotMessage(
      chatId,
      "Commands cleared for this chat. Reopen the bot chat.",
    );
  });

  safeOnText(COMMANDS.updateCmds.value, async (msg) => {
    const { unAuthorizedMessage, chatId } = getIfNotAuthorizedMessage(msg);
    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }
    await setupCommands();

    await sendBotMessage(chatId, `✅ Bot commands updated.`);
  });

  const createReply = (queryId, chatId, replyMesgId) => async (message) => {
    try {
      await bot.answerCallbackQuery(queryId, {
        text: message,
        show_alert: false,
      });
    } catch (err) {
      // Query expired — ignore silently
      createConsoleMessage(
        "warn",
        `⚠️ answerCallbackQuery expired: ${err.message}`,
      );
    }

    if (chatId) {
      // 2. Reply to the original case message
      await sendBotMessage(chatId, message, {
        disable_notification: false,
        reply_to_message_id: replyMesgId,
      });
    }
  };

  let lastPollingErrorNtfyAt = 0;

  bot.on("polling_error", async (err) => {
    const telegramError = err?.message || String(err);

    const locationName = getOrgLabel() || "unknown";

    const baseMessage = `⚠️ At ${locationName} Telegram polling error:\n${telegramError}\n\n`;

    const isTelegramTimeoutError = /ETIMEDOUT/i.test(telegramError);

    const message = isTelegramTimeoutError
      ? baseMessage +
        `1- Close the app and clear the patient data if found.\n` +
        `2- Go to .env file and set USE_NTFY_AS_CASE_PROVIDER=Y\n` +
        `3- Restart the app.`
      : baseMessage +
        "Something went wrong with Telegram polling. Please restart the app.";

    createConsoleMessage("warn", telegramError, "⚠️ Telegram polling error:");

    const now = Date.now();

    if (now - lastPollingErrorNtfyAt > 60_000) {
      try {
        await sendNtfyMessage(message);
        lastPollingErrorNtfyAt = now;
      } catch (error) {
        createConsoleMessage(
          "error",
          error,
          "Failed to send polling error ntfy",
        );
      }
    }
  });

  const confirmOnlineIfPending = async ({
    referralId,
    chatId,
    fromName,
    reply,
    silent,
  }) => {
    const currentActiveChatId = getActiveChatID();
    const pending = pendingOnlineChecks.get(referralId);

    const isSameChat = currentActiveChatId === chatId;

    if (!pending) {
      if (isSameChat) {
        return true;
      }

      const chatName = currentActiveChatId
        ? await getChatName(currentActiveChatId)
        : "another user";

      if (!isSameChat) {
        await reply(
          `⚠️ This online confirmation is expired, ${chatName} is active now.`,
        );
      }

      return false;
    }

    if (pending.confirmed) {
      const confirmedBy = pending.confirmedBy;
      const chatName = confirmedBy
        ? await getChatName(confirmedBy)
        : "Another user";

      if (confirmedBy === chatId) {
        return true;
      }

      if (confirmedBy !== chatId) {
        await reply(`⚠️ ${chatName} confirmed online and active now.`);
      }

      return false;
    }

    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }

    pending.confirmed = true;
    pending.confirmedBy = chatId;
    pendingOnlineChecks.delete(referralId);

    if (currentActiveChatId !== chatId) {
      updateEnvFile({
        TG_CHAT_ID: chatId,
        TG_CHAT_USER_NAME: fromName,
        CLIENT_WHATSAPP_NUMBER: process.env[`TG_PHONE_NUMBER_${chatId}`],
      });
    }

    const previousChatIds = pending.sentChatIds.filter(
      (sentChatId) => sentChatId !== chatId,
    );

    await Promise.all(
      previousChatIds.map((sentChatId) =>
        sendBotMessage(
          sentChatId,
          `🔔 \`${fromName}\` confirmed online for Referral ID: \`${referralId}\`.\nYou are marked as not active for this case.`,
        ).catch(() => null),
      ),
    );

    if (!silent) {
      await reply(
        `✅ Online Confirmed. You are now active for Referral ID: ${referralId}`,
      );
    }

    return true;
  };

  bot.on("callback_query", async (query) => {
    try {
      const { data, message, id } = query;

      const chatId = String(query.from.id);
      const messageChatId = String(message.chat.id);

      const msgId = message.message_id;
      const fromName =
        query.from?.first_name ||
        query.from?.last_name ||
        query.from?.username ||
        getMessageData(message).fromName ||
        chatId;

      const reply = createReply(id, messageChatId, msgId);

      if (!chatId) {
        const _message = `❌ chatId=${chatId} not found`;
        createConsoleMessage("error", _message);

        return reply(_message);
      }

      const allowedList = getAllowedList();

      // ✅ Add this inside callback_query to restrict access
      if (!allowedList.includes(chatId)) {
        const _message = `❌ chatId=${chatId} not allowed`;
        createConsoleMessage("error", _message);
        return reply(_message);
      }
      const [action, referralId] = data?.split("_") || [];

      // Separate from handleUserActionOnCase's fixed action set
      // (accept/reject/cancel/noreply/online/lefttime) - this is the
      // "Confirm Arrival" button sent alongside the watcher-chat status
      // update once a case is Confirmed/claimed (see
      // checkReferralSelectedStatus.mjs), sharing its core logic with the
      // /arrived slash command via performArrivalConfirmation.
      if (action === "arrived") {
        const { message: arrivalMessage } = await performArrivalConfirmation({
          browser,
          idArg: referralId,
        });

        await notifyWatcherIfDifferentChat(messageChatId, arrivalMessage);

        return reply(arrivalMessage);
      }

      // Same deal as "arrived" above - the "Withdraw" button sent
      // alongside it, sharing its core logic with the /withdraw slash
      // command via performWithdrawal.
      if (action === "withdraw") {
        const { message: withdrawMessage } = await performWithdrawal({
          browser,
          idArg: referralId,
        });

        await notifyWatcherIfDifferentChat(messageChatId, withdrawMessage);

        return reply(withdrawMessage);
      }

      // The "📎 Report" button sent alongside every watcher-chat status
      // update (see checkReferralSelectedStatus.mjs) - resends whatever
      // report/merged attachment file was cached for this case (same
      // lookup /attach uses), regardless of claimed status.
      if (action === "report") {
        const { message: reportMessage } = await performSendReportAttachment({
          bot,
          idArg: referralId,
          chatId: messageChatId,
          msgId,
        });

        return reply(reportMessage);
      }

      const {
        message: _message,
        success,
        skipMessage,
      } = await handleUserActionOnCase({
        patientsStore,
        referralId,
        action,
        onAcceptOrRejectForFileUpload: async () => {
          const currentFileId = await sendAndCacheLetter({
            referralId,
            letterAction: action,
            messageChatId,
            msgId,
          });

          if (!currentFileId) {
            // sendAndCacheLetter already logged the specific reason to the
            // console - this is just the operator-facing notification.
            return await reply(
              `❌ fileData not found for action=${action} and referralId=${referralId}`,
            );
          }

          // Also cache the OTHER action's letter (e.g. reject, right
          // after an accept) - a doctor can change their mind later
          // (accept now, reject with a custom reason after), and the
          // /letter cache only ever had whichever action was taken here,
          // never the other one. Best-effort - doesn't block or fail this
          // handler (the real action already succeeded), but still tells
          // the operator the secondary cache didn't get populated.
          const otherAction =
            action === USER_ACTION_TYPES.ACCEPT
              ? USER_ACTION_TYPES.REJECT
              : USER_ACTION_TYPES.ACCEPT;

          const otherFileId = await sendAndCacheLetter({
            referralId,
            letterAction: otherAction,
            messageChatId,
            msgId,
          }).catch(() => null);

          if (!otherFileId) {
            await reply(
              `⚠️ Could not cache the ${otherAction} letter for referralId=${referralId} (the ${action} above still went through fine).`,
            );
          }
        },
        onAnotherAction: () =>
          confirmOnlineIfPending({
            referralId,
            chatId,
            fromName,
            reply,
            // silent: true,
            silent: false,
          }),
        onOnlineAction: () =>
          confirmOnlineIfPending({
            referralId,
            chatId,
            fromName,
            reply,
            silent: false,
          }),
      });

      if (_message && !skipMessage) {
        reply(_message);
      }
    } catch (error) {
      createConsoleMessage(
        "error",
        error,
        `❌  Error handling incoming callback_query:`,
      );
    }
  });

  return sendTelegramMessage;
};

export default installTelegramBotApi;

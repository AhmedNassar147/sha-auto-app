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
import { getCaseFile, upsertCaseFile } from "./db.mjs";
import updateEnvFile from "./updateEnvFile.mjs";
import mergeAllToPdf from "./mergeFilesToOne.mjs";
import compressPdfGentlly from "./compressPdfGentlly.mjs";
import formatFilesToTelegram from "./formatFilesToTelgram.mjs";
import sleep from "./sleep.mjs";
import generateAcceptancePdfLetters from "./generatePdfs.mjs";
import makeUserLoggedInOrOpenHomePage from "./makeUserLoggedInOrOpenHomePage.mjs";
import getPatientReferralDataFromAPI from "./getPatientReferralDataFromAPI.mjs";
import getCurrentActionLetterFile from "./getCurrentActionLetterFile.mjs";
import closePageSafely from "./closePageSafely.mjs";
import notifyUserWithNewCase from "./notifyUserWithNewCase.mjs";
// import createAndSendInvoiceReport from "./createAndSendInvoiceReport.mjs";
import formatPatientToTelegramOrWA from "./formatPatientToTelegramOrWA.mjs";
import { HOME_PAGE_URL, USER_ACTION_TYPES } from "./constants.mjs";
import handleUserActionOnCase from "./handleUserActionOnCase.mjs";
import sendNtfyMessage from "./sendNtfyMessage.mjs";

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
    description: "Get or set wait time. Examples: /wait OR /wait 2050",
    command: "wait",
  },
  auto_wait: {
    value: /\/auto_wait(?:\s+(\S+))?$/,
    description:
      "Get or set auto wait. Examples: /auto_wait OR /auto_wait 1 OR /auto_wait 0",
    command: "auto_wait",
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
    description: "pull latest code from master and restart the server",
    command: "update_code",
  },
  getReferralLetter: {
    value: /\/letter (.+)/,
    description:
      "Long press → get letter, Example: /letter a 12345 OR /letter r 12345 OR /letter r 12345 reason",
    command: "letter",
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
  value.replace(
    /&lt;(\/?(?:b|strong|i|em|u|s|strike|del|code|pre))&gt;/g,
    (_, tag) => {
      return `<${tag}>`;
    },
  );

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

  const sendTelegramMessage = async (
    message,
    _files = [],
    targetReferralIdForButtons,
    overrideChatId = null,
    skipOnlineCheckCreation = false,
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
          ...(targetReferralIdForButtons && {
            reply_markup: buildButtons(targetReferralIdForButtons),
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

    const currentWait = process.env.WAIT_FOR_ACCEPT_MS;

    // GET CURRENT
    if (!raw) {
      return await sendBotMessage(
        chatId,
        `✅ Current wait time is \`${currentWait}\`ms.`,
      );
    }

    // SET NEW
    const value = parseInt(raw, 10);

    const minValue = 1800;

    if (!Number.isFinite(value) || value < minValue) {
      return await sendBotMessage(
        chatId,
        `⛔ Invalid value \`${raw}\`.\nIt should be a number greater than or equal to ${minValue}.\nUsage:\n/wait\n/wait 2050`,
      );
    }

    if (currentWait === String(value)) {
      return await sendBotMessage(
        chatId,
        `⛔ waitTime is already \`${value}\`ms.`,
      );
    }

    updateEnvFile({ WAIT_FOR_ACCEPT_MS: value });

    await sendBotMessage(
      chatId,
      `✅ waitTime updated from \`${currentWait}\`ms to \`${value}\`ms.`,
    );

    const activeChatId = getActiveChatID();

    if (activeChatId !== chatId) {
      await sendBotMessage(
        activeChatId,
        `🔔 \`${fromName}\` changed waitTime from \`${currentWait}\`ms to \`${value}\`ms.`,
      );
    }
  });

  safeOnText(COMMANDS.auto_wait.value, async (msg, match) => {
    const { unAuthorizedMessage, chatId, fromName } =
      getIfNotAuthorizedMessage(msg);

    if (unAuthorizedMessage) {
      await sendBotMessage(chatId, unAuthorizedMessage);
      return;
    }

    const value = match?.[1];

    if (value && !["1", "0"].includes(value)) {
      return await sendBotMessage(
        chatId,
        `⛔ Invalid value \`${value}\`.\nUsage:\n/auto_wait\n/auto_wait 1\n/auto_wait 0`,
      );
    }

    const currentAutoWaitState = process.env.ENABLE_AUTO_WAITING;

    const isAutoWaitingActive = currentAutoWaitState === "1";

    if (!value) {
      return await sendBotMessage(
        chatId,
        `✅ Auto waiting is \`${isAutoWaitingActive ? "enabled" : "disabled"}\`.`,
      );
    }

    const isActive = value === "1";
    const isSame = currentAutoWaitState === value;
    const status = isActive ? "enabled" : "disabled";

    if (isSame) {
      return await sendBotMessage(
        chatId,
        `⛔ Auto waiting is already \`${status}\`.`,
      );
    }

    updateEnvFile({ ENABLE_AUTO_WAITING: value });

    await sendBotMessage(chatId, `✅ Auto waiting updated to \`${status}\`.`);

    const activeChatId = getActiveChatID();

    if (activeChatId !== chatId) {
      await sendBotMessage(
        activeChatId,
        `🔔 \`${fromName}\` changed \`autoWait\` to \`${status}\`.`,
      );
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
    const referralId = parts[1]; // "125225"
    const reason = (parts.slice(2) || []).join(" "); // "some reason" or ""

    if (!["a", "r"].includes(action)) {
      return sendBotMessage(
        chatId,
        `⛔ Invalid action \`${action}\`.\nUse *a* for accept or *r* for reject.\nExample: \`/letter a 125225\``,
      );
    }

    if (!referralId || !/^\d+$/.test(referralId)) {
      return sendBotMessage(
        chatId,
        `⛔ Invalid referral ID \`${referralId}\`.\nExample: \`/letter a 125225\``,
      );
    }

    const actionType =
      action === "a" ? USER_ACTION_TYPES.ACCEPT : USER_ACTION_TYPES.REJECT;

    if (!reason) {
      const record = getCaseFile(referralId);
      const {
        action: recordAction,
        referralId: recordReferralId,
        tgFileId,
      } = record || {};

      if (
        tgFileId &&
        recordAction === actionType &&
        recordReferralId === referralId
      ) {
        try {
          const fileMessage = `✅ Cached letter served for Referral ID: \`${referralId}\` and action: \`${recordAction}\`.`;
          await sendBotMessage(chatId, fileMessage, {
            reply_to_message_id: msgId,
          });

          await bot.sendDocument(chatId, tgFileId, {
            reply_to_message_id: msgId,
            caption: `📎 ${recordAction}_${referralId}`,
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

    const patientData = patientsStore.getPatientByReferralId(referralId);

    if (!patientData) {
      await sendBotMessage(
        chatId,
        "⛔ Patient removed from the store, searching the app....",
      );
    }

    let fileBuffer = null;

    if (patientData) {
      fileBuffer = await makeLetterGenerationAndReturnFile({
        actionType,
        browser,
        patientData,
        reason,
        referralId,
      });
    }

    if (!fileBuffer) {
      const { isLoggedIn, newPage, isErrorAboutLockedOut } =
        await makeUserLoggedInOrOpenHomePage({
          browser,
          startingPageUrl: HOME_PAGE_URL,
          noCursor: true,
          noBundleCheck: true,
          sendTelegramMessage,
        });

      if (isErrorAboutLockedOut) {
        await closePageSafely(newPage);

        return await sendBotMessage(
          chatId,
          `⛔ Could not loginin, We are blocked`,
          {
            reply_to_message_id: msgId,
          },
        );
      }

      if (!isLoggedIn) {
        await closePageSafely(newPage);
        return await sendBotMessage(
          chatId,
          `⛔ Could not loginin, Please check the app`,
          {
            reply_to_message_id: msgId,
          },
        );
      }

      const fetchedPatientData = await getPatientReferralDataFromAPI(
        newPage,
        referralId,
        true,
      );

      await closePageSafely(newPage);

      const { patientDetailsError, patientInfoError } =
        fetchedPatientData || {};

      if (patientDetailsError || patientInfoError || !fetchedPatientData) {
        return await sendBotMessage(
          chatId,
          fetchedPatientData
            ? `⛔ Could Find the patient in the app, please try again`
            : `⛔ Error: ${patientDetailsError || patientInfoError}`,
          {
            reply_to_message_id: msgId,
          },
        );
      }

      fileBuffer = await makeLetterGenerationAndReturnFile({
        actionType,
        browser,
        patientData: fetchedPatientData,
        reason,
        referralId,
      });
    }

    if (!fileBuffer) {
      return await sendBotMessage(
        chatId,
        `⛔ Could Find the patient while searching the app, please try again`,
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
        "git log HEAD..origin/master --oneline",
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
      await execAsync("git pull --rebase origin master", gitOptions);
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

    const { BRANCH_NAME, CLIENT_ID } = process.env;
    const locationName = BRANCH_NAME || CLIENT_ID || "unknown";

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

      const {
        message: _message,
        success,
        skipMessage,
      } = await handleUserActionOnCase({
        patientsStore,
        referralId,
        action,
        onAcceptOrRejectForFileUpload: async () => {
          const { fileData } =
            (await getCurrentActionLetterFile(referralId, action, true)) || {};

          if (!fileData) {
            const _message = `❌ fileData not found for action=${action} and referralId=${referralId}`;
            createConsoleMessage("error", _message);
            return await reply(_message);
          }

          const fileName = `${action}_${referralId}`;

          const actionDocumentResponse = await bot
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

          const fileId = actionDocumentResponse?.document?.file_id;

          if (fileId) {
            upsertCaseFile(referralId, action, fileId);
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

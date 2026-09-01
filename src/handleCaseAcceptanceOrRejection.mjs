/**
 *
 * Helper: `handleCaseAcceptanceOrRejection`.
 *
 */
import makeUserLoggedInOrOpenHomePage from "./makeUserLoggedInOrOpenHomePage.mjs";
import waitUntilCanTakeActionByWindow from "./waitUntilCanTakeActionByWindow.mjs";
import closePageSafely from "./closePageSafely.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import sleep from "./sleep.mjs";
import summarizeLogsAfterAcceptance from "./summarizeLogsAfterAcceptance.mjs";
import checkRecaptchaQuota from "./checkRecaptchaQuota.mjs";
import {
  FAKE_REJECT_PROBE,
  HOME_PAGE_URL,
  USER_ACTION_TYPES,
  APP_URL,
  LETTER_LAYOUT_ABBREVIATIONS,
} from "./constants.mjs";
import sendNtfyMessage from "./sendNtfyMessage.mjs";
import updateEnvFile from "./updateEnvFile.mjs";
import shuffleArray from "./shuffleArray.mjs";
import getCurrentActionLetterFile from "./getCurrentActionLetterFile.mjs";
import getExtraTimeBasedLogs, {
  analyzeReferralTimingPatterns,
} from "./getExtraTimeBasedLogs.mjs";
import randomArrayItem from "./randomArrayItem.mjs";
import writePollLogsData from "./writePollLogsData.mjs";

// prepareButtonWillBeClickableWhen and autoAcceptAfterMs are driven by the
// RECAPTCHA_ACCEPT_DELAY / AUTO_ACCEPT_DELAY env vars (see their initial
// assignment below), not fixed here. A fitted rtt-scaled formula was tried
// and dropped: with only a handful of confirmed-good reference cases
// (referralId 384041, 384034, 384006), each version matched the case it was
// calibrated on and broke on the next one once it arrived. Revisit once
// more confirmed cases have accumulated in results/poll-logs.

const getRttExtraWait = (rtt) => {
  if (!Number.isFinite(rtt)) return 0;
  // referralId 384006 (rtt=516, a trusted claimed=yes case) shows no bonus
  // at high rtt - matches its real autoAcceptAfterMs of 1990 exactly.
  if (rtt > 140) return 0;
  if (rtt >= 95 && rtt <= 140) return +2;
  if (rtt >= 90) return +1;
  // if (rtt >= 86) return +1;
  // extremely responsive session
  if (rtt < 70) return -1;

  return 0;
};

const getRttHalf = (rtt) => (Number.isFinite(rtt) ? Math.round(rtt / 2) : 0);

const createRandomAttachmentKey = (minLength = 3, maxLength = 7) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  const length =
    Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;

  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
};

export const navigateToNewDetailsPage = async ({
  page,
  referralId,
  _routerKey,
  shouldOpenNewWindow,
}) => {
  const routerKey = _routerKey || Math.random().toString(36).slice(2, 8);

  await page.evaluate(
    ({ referralId, routerKey, shouldOpenNewWindow, APP_URL }) => {
      const targetWindow = shouldOpenNewWindow
        ? window.open(APP_URL, "_blank")
        : window;

      if (!targetWindow) {
        return;
      }

      const navigate = () => {
        try {
          targetWindow?.focus();
        } catch {}
        targetWindow.history.pushState(
          {
            usr: { referralId: referralId, type: "Referral" },
            key: routerKey,
            idx: targetWindow.history.state?.idx + 1 || 1,
          },
          "",
          "/referral/details",
        );

        targetWindow.dispatchEvent(
          new PopStateEvent("popstate", {
            state: targetWindow.history.state,
          }),
        );
      };

      if (shouldOpenNewWindow) {
        const timer = setInterval(() => {
          try {
            if (
              targetWindow &&
              targetWindow.location.origin === window.location.origin
            ) {
              clearInterval(timer);
              navigate();
            }
          } catch {}
        }, 20);
      } else {
        navigate();
      }
    },
    { referralId, routerKey, APP_URL, shouldOpenNewWindow },
  );
};

const FILE_NAMES = [
  "Letter",
  "Form",
  "File",
  "Acceptance",
  "ViewAcc",
  "Document",
  "Letter Form",
  "Letter Acc",
  "Letter File",
  "DocFile",
  "ReportAcc",
  "patientAcc",
  "CaseLetter",
  "ItemFile",
  "Case Acceptance",

  "Approval",
  "Approval Letter",
  "Approval Form",
  "Approval File",
  "Acceptance Form",
  "Acceptance Letter",
  "Acceptance Report",
  "Acceptance Document",
  "Acceptance File",
  "Referral Letter",
  "Referral Form",
  "Referral File",
  "Referral Document",
  "Medical Letter",
  "Patient Letter",
  "Case File",
  "Case Approval",
  "Referral Approval",
  "Confirmation",
  "Confirmation Letter",
  "Confirmation Form",
  "Confirmation File",
  "Referral Acc",
  "Patient Report",

  "Acquire Document",
  "Acquire Letter",
  "Acquire Form",
  "Acquire Report",
];

const handleCaseAcceptanceOrRejection =
  ({
    actionType,
    broadcast,
    sendTelegramMessage,
    continueFetchingPatientsIfPaused,
    browser,
    patientStore,
  }) =>
  async (patient) => {
    const {
      referralId,
      referralEndTimestamp,
      providerName,
      endDateBasedServerDateMs,
      referralEndDate,
      patientName,
      letterType,
    } = patient;

    try {
      const {
        CLIENT_NAME,
        WAIT_FOR_ACCEPT_MS,
        ENABLE_AUTO_WAITING,
        USES_CACHED_TOKEN_FLOW,
        ID_PROVIDER,
        AUTO_ACCEPT,
        AUTO_ACCEPT_DELAY,
        RECAPTCHA_ACCEPT_DELAY,
        USE_OLD_FLOW,
        PREPARE_EXPIRE_MS,
      } = process.env;

      // Client-side cutoff (scripts/fix-final-new-last-ready-case.mjs) after
      // which the Prepare button turns red as a "you're now late" cue. Only
      // 3 real reaction-time samples exist so far (referralId 384278 won at
      // 1286ms, 384277/384286 lost at 1575/1847ms) - 1200 is a starting
      // point, not a validated value. Env-tunable so it doesn't need a
      // userscript redeploy to adjust as more samples come in.
      let prepareExpireMs = Number(PREPARE_EXPIRE_MS || 1200);

      const isAcceptanceAction = actionType === USER_ACTION_TYPES.ACCEPT;
      const isFakeReject = actionType === FAKE_REJECT_PROBE;

      const usesCachedTokenFlow = USES_CACHED_TOKEN_FLOW || "0";
      const useCachedTokenFlow =
        usesCachedTokenFlow === "1" && isAcceptanceAction;

      const isUsingAutoAccept = AUTO_ACCEPT === "1";
      const useOldFlow = USE_OLD_FLOW === "1";

      const { fileData: filebase64 } = await getCurrentActionLetterFile(
        referralId,
        isFakeReject ? USER_ACTION_TYPES.REJECT : actionType,
      );

      const routerKey = Math.random().toString(36).slice(2, 8);

      const patientFileName =
        (patientName || "").trim().split(/\s+/)[0] || "Patient";

      let files;

      if (isAcceptanceAction) {
        const attachmentKey = createRandomAttachmentKey();

        const abbreviation =
          Math.random() < 0.8
            ? LETTER_LAYOUT_ABBREVIATIONS[letterType]
            : undefined;

        const formattedKey =
          Math.random() < 0.67 ? `(${attachmentKey})` : attachmentKey;

        const attachmentSeparator = Math.random() < 0.52 ? "-" : " ";

        const formattedAttachmentKey = shuffleArray(
          [formattedKey, abbreviation].filter(Boolean),
        ).join(attachmentSeparator);

        const randomKey =
          Math.random() < 0.6 ? formattedAttachmentKey : abbreviation;

        const shouldUseRandomKeyAsSeparatePart = Math.random() < 0.7;

        const documentName = randomArrayItem(FILE_NAMES);

        const formattedDocumentName = [
          documentName,
          shouldUseRandomKeyAsSeparatePart ? undefined : randomKey,
        ]
          .filter(Boolean)
          .join(" ");

        const fileNameParts = [
          patientFileName,
          shouldUseRandomKeyAsSeparatePart ? randomKey : undefined,
          formattedDocumentName,
          referralId,
        ].filter(Boolean);

        files = [
          {
            fileName: `${shuffleArray(fileNameParts).join(" ")}.pdf`,
            fileData: filebase64,
            fileExtension: 0,
            userCode: CLIENT_NAME,
            idAttachmentType: 14,
            languageCode: 1,
          },
        ];
      }

      const idProvider = ID_PROVIDER || CLIENT_NAME.split("-")[0];

      let autoAcceptAfterMs = Number(AUTO_ACCEPT_DELAY || 0);

      let prepareButtonWillBeClickableWhen = useCachedTokenFlow
        ? // ? randomDelayInRange(1100, 1300)
          Math.max(1063, Number(RECAPTCHA_ACCEPT_DELAY || 1065))
        : 0;

      // const onLastSeconds = () => {
      //   if (isFakeReject || !isAcceptanceAction) return;

      //   broadcast({
      //     type: "prepare-rcpt",
      //     data: {
      //       referralId,
      //     },
      //   });
      // };

      const onZeroSecond = async (shouldIncreaseWait) => {
        if (isFakeReject || !isAcceptanceAction) return;

        // autoAcceptAfterMs = shouldIncreaseWait
        //   ? autoAcceptAfterMs + 3
        //   : autoAcceptAfterMs;

        const broadcastData = {
          type: "case-acceptance-or-rejection",
          data: {
            referralId,
            actionType,
            routerKey,
            files,
            idProvider,
            providerName,
            usesCachedTokenFlow: useCachedTokenFlow ? "1" : "0",
            ...(useOldFlow
              ? {
                  autoAcceptAfterMs:
                    useCachedTokenFlow && isUsingAutoAccept
                      ? autoAcceptAfterMs
                      : 0,
                }
              : null),
          },
        };

        broadcast(broadcastData);

        if (useOldFlow && prepareButtonWillBeClickableWhen) {
          // after details page loaded in real browser we fire prepare-rcpt
          setTimeout(
            () =>
              broadcast({
                type: "prepare-rcpt",
                data: {
                  referralId,
                },
              }),
            prepareButtonWillBeClickableWhen,
          );
        }
      };

      const handleFinalSignal = async () => {
        if (useCachedTokenFlow) {
          broadcast({
            type: "ready-case",
            data: {
              referralId,
            },
          });
        }
      };

      const { newPage: page } = await makeUserLoggedInOrOpenHomePage({
        browser,
        startingPageUrl: HOME_PAGE_URL,
        noCursor: true,
        noBundleCheck: true,
        sendTelegramMessage,
      });

      await navigateToNewDetailsPage({
        page,
        referralId,
        _routerKey: routerKey,
      });

      const currentUrl = page.url().toLowerCase();

      const remainingMs = referralEndTimestamp - Date.now();

      createConsoleMessage(
        "info",
        `Navigated to details page referralId=${referralId} remainingMs=${remainingMs} and URL=${currentUrl}`,
      );

      let extraBotMessages = [];

      if (isFakeReject) {
        extraBotMessages.push(
          `This is a fake reject probe, Please ignore the message, referralId=${referralId}`,
        );
      }

      const rawWaitTime = WAIT_FOR_ACCEPT_MS || "";

      let baseWaitingTime = +rawWaitTime;

      if (Number.isNaN(baseWaitingTime)) {
        const value = rawWaitTime.match(/(\d+)s/)?.[1] || 0;
        baseWaitingTime = +value;
        extraBotMessages.push(
          `Found non numeric waitTime of \`${rawWaitTime}\`, Please set it as number not with characters where referralId=\`${referralId}\``,
        );
      }

      if (!Number.isFinite(baseWaitingTime) || baseWaitingTime <= 0) {
        baseWaitingTime = 2000;
        extraBotMessages.push(
          `Didn't find the waitTime=\`${WAIT_FOR_ACCEPT_MS}\` we forced to use \`${baseWaitingTime}\` for this case, Please set the proper waitTime from bot via \`/wait some time\``,
        );
      }

      extraBotMessages.push(
        `Time remaining before loop: ${referralEndTimestamp - Date.now()}`,
      );

      let recaptchaQuotaCheck = {
        frameFound: false,
        quotaExceeded: false,
        frameUrl: null,
      };

      try {
        recaptchaQuotaCheck = await checkRecaptchaQuota(page);
      } catch (error) {
        createConsoleMessage("error", error, "Failed to check recaptcha quota");
      }

      const recaptchaQuotaExceeded = recaptchaQuotaCheck.quotaExceeded
        ? "Y"
        : "N";

      let clockSkewAnomalyMessage = undefined;

      const {
        zeroSeenAt,
        zeroSeenLocalAt,
        readySeenAt,
        extraBackendDelayMs,
        readySeenAtLocalMs,
        rtt,
        timesWhenOneSecondStartedAndEnded,
        loopCountWhenSecondIsOne,
        // newWorkFlowZeroProps,
        // _status,
        diffBetweenZeroAndReadyLocals,
        lastSecondFnFiredWhenDiffWas,
        readyDiff,
      } = await waitUntilCanTakeActionByWindow({
        page,
        referralId,
        onZeroSecond,
        useCachedTokenFlow,
        referralEndTimestamp,
        // onLastSeconds,
      });

      const diff = referralEndTimestamp - readySeenAt;

      let waitingTimeBeforeSendPrepareSignal = 0;
      let autoAcceptIncreasedBy = 0;
      let prepareSignalSentAt = 0;
      const waitBasedRtt = getRttExtraWait(rtt);

      if (isAcceptanceAction && !useOldFlow) {
        // Post-"ready" sleep before sending prepare-rcpt, driven by
        // readyDiff (localNow - server's reported whole second at "ready").
        // Low readyDiff means our reading landed early relative to the
        // server's second, so there's more of PREPARE_BUTTON_TARGET_MS left
        // to wait out; high readyDiff means we're already past it, so no
        // extra wait is needed. readyDiff can swing very negative when
        // polling straddles a server-second boundary unexpectedly (e.g.
        // referralId 384179: readyDiff=-1523) - WAIT_CAP_MS keeps that from
        // turning into a multi-second sleep that would blow the deadline.
        const MAX_WAIT = 27;
        const WAIT_CAP_MS =
          readyDiff <= 800 ? MAX_WAIT : readyDiff < 910 ? 26 : 25;

        waitingTimeBeforeSendPrepareSignal = Math.max(
          16,
          Math.min(
            WAIT_CAP_MS,
            prepareButtonWillBeClickableWhen - (readyDiff ?? 0),
          ),
        );

        autoAcceptAfterMs += waitBasedRtt;

        const {
          isCurrentDiffNegative,
          lastCaseDiff,
          gapMin,
          lastCaseRTT,
          isCurrentCaseDangerZone,
        } = await analyzeReferralTimingPatterns(referralEndTimestamp, diff);

        const isThisCaseShownInTimeOfLastCaseDone = gapMin < 14;

        if (isCurrentCaseDangerZone) {
          autoAcceptIncreasedBy =
            diff === -1000
              ? rtt >= 170
                ? 3
                : 5 + (gapMin > 45 || gapMin < 30 ? 1 : 0) + (rtt > 90 ? 1 : 0)
              : 3;
        }

        if (
          !isCurrentCaseDangerZone &&
          lastCaseDiff === 0 &&
          isCurrentDiffNegative
        ) {
          autoAcceptIncreasedBy =
            lastCaseRTT >= 170 ? 4 : waitBasedRtt > 1 ? 1 : 2;
        }

        // -1000/-2000 => 0
        if (lastCaseDiff < 0 && isCurrentDiffNegative) {
          autoAcceptIncreasedBy =
            lastCaseRTT >= 170 ? 4 : waitBasedRtt > 1 ? 1 : 2;
        }

        // -1000 => 0
        if (lastCaseDiff < 0 && !isCurrentDiffNegative) {
          // isThisCaseShownInTimeOfLastCaseDone
          //   ? 0
          //   :
          autoAcceptIncreasedBy = waitBasedRtt > 1 ? 1 : 2;
        }

        // 0 => 0
        if (lastCaseDiff >= 0 && !isCurrentDiffNegative) {
          autoAcceptIncreasedBy = waitBasedRtt > 1 ? 1 : 2;
        }

        if (!isCurrentCaseDangerZone && gapMin > 40) {
          autoAcceptIncreasedBy += waitBasedRtt > 0 ? 1 : 2;
        }

        autoAcceptAfterMs += autoAcceptIncreasedBy;

        autoAcceptAfterMs =
          useCachedTokenFlow && isUsingAutoAccept ? autoAcceptAfterMs : 0;

        // prepareButtonWillBeClickableWhen = PREPARE_BUTTON_TARGET_MS;

        // readyDiff should track diffBetweenZeroAndReadyLocals + rtt/2
        // within normal polling noise (both describe roughly the same
        // elapsed time, just against different clocks). A large gap between
        // them means readyDiff landed in one of its anomalous swings for
        // this case - WAIT_CAP_MS above already contains the fallout on the
        // sleep, but it's worth flagging for manual review regardless.
        const clockSkewAnomalyMs = Number.isFinite(readyDiff)
          ? readyDiff - ((diffBetweenZeroAndReadyLocals || 0) + getRttHalf(rtt))
          : null;

        if (clockSkewAnomalyMs !== null && Math.abs(clockSkewAnomalyMs) > 300) {
          createConsoleMessage(
            "warn",
            `referralId=${referralId} clockSkewAnomalyMs=${clockSkewAnomalyMs} ` +
              `(readyDiff=${readyDiff}, diffBetweenZeroAndReadyLocals=${diffBetweenZeroAndReadyLocals}, rtt=${rtt})`,
          );

          clockSkewAnomalyMessage = `clockSkewAnomalyMs=${clockSkewAnomalyMs} (readyDiff=${readyDiff}, diffBetweenZeroAndReadyLocals=${diffBetweenZeroAndReadyLocals}, rtt=${rtt})`;
        }

        await sleep(waitingTimeBeforeSendPrepareSignal);

        prepareExpireMs =
          MAX_WAIT - waitingTimeBeforeSendPrepareSignal + prepareExpireMs;

        prepareSignalSentAt = Date.now();
        broadcast({
          type: "prepare-rcpt",
          data: {
            referralId,
            autoAcceptAfterMs,
            prepareExpireMs,
          },
        });
      }

      const totalRemainingDelay =
        prepareButtonWillBeClickableWhen + autoAcceptAfterMs;

      let extraWait = 0;

      const { computedExtraBotMessages, computedExtraWait } =
        await getExtraTimeBasedLogs({
          referralId,
          referralEndTimestamp,
          diff,
          extraBackendDelayMs,
          rtt,
          baseWaitingTime,
          // forceReduceWait: !!recaptchaQuotaCheck?.quotaExceeded,
        });

      if (ENABLE_AUTO_WAITING === "1") {
        extraWait = computedExtraWait;
        extraBotMessages = extraBotMessages.concat(computedExtraBotMessages);
      }

      const waitTime = baseWaitingTime + extraWait;
      const approvalMessage = `*${actionType} ${referralId}*  waitTime: ${waitTime / 1000}s`;

      const notificationResults = await Promise.allSettled([
        isUsingAutoAccept
          ? Promise.resolve()
          : sleep(totalRemainingDelay).then(handleFinalSignal),
        sleep(waitTime).then(() => sendTelegramMessage(approvalMessage)),
        sleep(Math.max(0, waitTime - 37)).then(() =>
          sendNtfyMessage(approvalMessage),
        ),
        summarizeLogsAfterAcceptance({
          referralId,
          waitTime: autoAcceptAfterMs,
          extraWait: autoAcceptIncreasedBy,
          referralEndTimestamp,
          endDateBasedServerDateMs,
          zeroSeenAt,
          readySeenAt,
          readySeenAtLocalMs,
          extraBackendDelayMs,
          referralEndDate,
          rtt,
          status: isAcceptanceAction ? "" : "not-clicked",
          claimed: isAcceptanceAction ? "" : "No",
          extraWaitMessage: `${computedExtraBotMessages.join("_AND_")} | prepareSignalSentAt=${prepareSignalSentAt} `,
          recaptchaQuotaExceeded,
        }),
      ]);

      for (const result of notificationResults) {
        if (result.status === "rejected") {
          const message = `⚠️ Notification failed: ${result.reason?.message || result.reason}`;
          createConsoleMessage("error", message);
          extraBotMessages.push(message);
        }
      }

      // console.log(JSON.stringify(_status, null, 2));

      const isTimeChanged = waitTime !== baseWaitingTime;

      const envUpdates = {
        recaptchaQuotaExceeded,
        ...(useOldFlow
          ? null
          : {
              AUTO_ACCEPT_DELAY: autoAcceptAfterMs - waitBasedRtt,
              RECAPTCHA_ACCEPT_DELAY: prepareButtonWillBeClickableWhen,
            }),
        // DOES_SYSTEM_REDUCE_WAIT:
      };

      if (isTimeChanged) {
        envUpdates.WAIT_FOR_ACCEPT_MS = waitTime;

        extraBotMessages.push(
          `⚠️ waitTime auto-updated from \`${baseWaitingTime}\` to \`${waitTime}\` where referralId=\`${referralId}\``,
        );
      }

      await closePageSafely(page);
      updateEnvFile(envUpdates);

      if (isAcceptanceAction) {
        patientStore.addNonClaimableCase(referralId, referralEndTimestamp);
      }

      await writePollLogsData({
        actionType,
        extraBackendDelayMs,
        loopCountWhenSecondIsOne,
        readySeenAt,
        readySeenAtLocalMs,
        referralId,
        rtt,
        waitTime,
        zeroSeenAt,
        timesWhenOneSecondStartedAndEnded,
        autoAcceptAfterMs,
        prepareButtonWillBeClickableWhen,
        lastSecondFnFiredWhenDiffWas,
        clockSkewAnomalyMessage,
        waitingTimeBeforeSendPrepareSignal,
        waitBasedRtt,
        autoAcceptIncreasedBy,
        prepareExpireMs,
      });

      extraBotMessages.push(
        `<b>reCAPTCHA frame found:</b> ${recaptchaQuotaCheck.frameFound}\n` +
          `<b>reCAPTCHA quota exceeded:</b> ${recaptchaQuotaCheck.quotaExceeded}\n` +
          `<b>Frame URL:</b> ${recaptchaQuotaCheck.frameUrl || "Not found"}`,
      );

      extraBotMessages.push(
        `<b>referralId:</b> ${referralId}\n` +
          `<b>zeroSeenLocalAt:</b> ${zeroSeenLocalAt}\n` +
          `<b>totalRemainingDelay:</b> ${totalRemainingDelay} MS\n` +
          `<b>readyDiff:</b> ${readyDiff} MS\n` +
          `<b>diffBetweenZeroAndReadyLocals:</b> ${diffBetweenZeroAndReadyLocals} MS\n` +
          `<b>lastSecondFnFiredWhenDiffWas:</b> ${lastSecondFnFiredWhenDiffWas} MS\n` +
          `<b>waitBasedRtt:</b> ${waitBasedRtt} MS\n` +
          `<b>waitingTimeBeforeSendPrepareSignal:</b> ${waitingTimeBeforeSendPrepareSignal} MS\n` +
          `<b>autoAcceptAfterMs:</b> ${autoAcceptAfterMs} MS\n`,
      );

      if (extraBotMessages.length) {
        await sleep(250);
        await sendTelegramMessage(extraBotMessages.join("\n\n"));
      }

      createConsoleMessage(
        "warn",
        `patient=${referralId}, computedExtraWait=${computedExtraWait} computedExtraBotMessages=${computedExtraBotMessages.join("\n")}`,
      );

      // continueFetchingPatientsIfPaused();
    } catch (error) {
      createConsoleMessage(
        "error",
        error,
        `failed when ${actionType} patient=${referralId}`,
      );
    }
  };

export default handleCaseAcceptanceOrRejection;

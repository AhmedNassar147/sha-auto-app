/*
 * Helper: waitUntilCanTakeActionByWindow
 */
import { baseWaslaHeaders } from "./constants.mjs";

async function waitUntilCanTakeActionByWindow({
  page,
  referralId,
  onZeroSecond,
  onLastSeconds,
}) {
  const now = Date.now();
  let fnName = null;

  if (onZeroSecond) {
    fnName = `onZeroSecond_${now}`;
    await page.exposeFunction(fnName, onZeroSecond);
  }

  let onLastSecondsFnName = null;

  if (onLastSeconds) {
    onLastSecondsFnName = `onLastSeconds_${now}`;
    await page.exposeFunction(onLastSecondsFnName, onLastSeconds);
  }

  return await page.evaluate(
    async ({ baseWaslaHeaders, referralId, fnName, onLastSecondsFnName }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const pollLogs = [];

      let loopCountWhenSecondIsOne = 0;
      let onZeroSecondCalled = false;

      let zeroSeenLocalAt = 0;
      let zeroSeenAt = 0;
      let readySeenAt = 0;
      let readySeenAtLocalMs = 0;

      let leftTimeWhenLastSecondsCalled = 0;

      let lastPollLocalNow = 0;
      let lastServerNow = null;
      let sameServerSecondIndex = 0;

      let newWorkFlowZeroProps = {};
      let _status = [];
      let diffBetweenZeroAndReadyLocals = 0;

      let lastSecondFnFired = false;
      let lastSecondFnFiredWhenDiffWas = 0;
      let readyDiff = 0;

      const pushPollLog = (entry) => {
        pollLogs.push(entry);
      };

      async function fetchDetailsOnce(attempt) {
        const requestStartsAt = Date.now();

        try {
          const r = await fetch(`/referrals/details?_=${Date.now()}`, {
            method: "POST",
            headers: {
              ...baseWaslaHeaders,
              "Cache-Control": "no-store",
              Pragma: "no-cache",
            },
            body: JSON.stringify({ referralId: referralId }),
            cache: "no-store",
            credentials: "include",
          });

          const localNow = Date.now();
          const rtt = localNow - requestStartsAt;

          if (!r?.ok) {
            return {
              ok: false,
              reason: `HTTP ${r.status}`,
              localNow,
              serverNow: null,
              totalMsLeft: -1,
              rtt,
            };
          }

          const serverDateRaw = r.headers.get("Date");
          const serverNow = serverDateRaw
            ? new Date(serverDateRaw).getTime()
            : null;

          const diff = serverNow ? localNow - serverNow : null;

          const gapFromPreviousPollMs = lastPollLocalNow
            ? requestStartsAt - lastPollLocalNow
            : null;

          if (serverNow === lastServerNow) {
            sameServerSecondIndex += 1;
          } else {
            sameServerSecondIndex = 1;
            lastServerNow = serverNow;
          }

          lastPollLocalNow = localNow;

          const j = await r.json().catch(() => null);
          const { canTakeAction, canUpdate, status, message } = j?.data ?? {};

          let totalMsLeft = -1;

          if (message) {
            const match = message.match(
              /(\d+)\s*(?:minute(?:\(s\))?|mins?|min)\s+and\s+(\d+)\s*(?:second(?:\(s\))?|secs?|sec)/,
            );

            if (!match) {
              return {
                ok: false,
                reason: "unparsed-message",
                message,
                serverDateRaw,
                serverNow,
                localNow,
                totalMsLeft,
                rtt,
              };
            }

            const minsLeft = parseInt(match[1], 10) || 0;
            const secsLeft = parseInt(match[2], 10) || 0;

            totalMsLeft = minsLeft * 60_000 + secsLeft * 1_000;

            const baseLog = {
              attempt,
              requestStartsAt,
              responseReceivedAt: localNow,
              serverDateRaw,
              serverNow,
              localNow,
              diff,
              rtt,
              gapFromPreviousPollMs,
              sameServerSecondIndex,
              totalMsLeft,
              message,
            };

            if (totalMsLeft === 1000) {
              loopCountWhenSecondIsOne += 1;
              pushPollLog({
                phase: "one",
                ...baseLog,
              });
            }

            if (totalMsLeft === 0 && !onZeroSecondCalled && fnName) {
              const _rtt = rtt || 0;
              const shouldIncreaseWait =
                serverNow === localNow || (_rtt >= 80 && _rtt <= 140);
              await window[fnName]?.(shouldIncreaseWait);
              onZeroSecondCalled = true;
              zeroSeenAt = serverNow || localNow;
              zeroSeenLocalAt = localNow;
              if (loopCountWhenSecondIsOne) {
                pushPollLog({
                  phase: "actual-zero",
                  ...baseLog,
                  shouldIncreaseWait,
                });
              }
            }
          }

          // status === "P"
          const baseOk = Boolean(canTakeAction && canUpdate && !!status);

          const ok = baseOk && !message;
          // Boolean(canTakeAction && canUpdate) && !message;

          diffBetweenZeroAndReadyLocals = localNow - zeroSeenLocalAt;

          // const shouldFireOnLastSecond =
          //   ok ||
          //   (!ok &&
          //     !!zeroSeenLocalAt &&
          //     diffBetweenZeroAndReadyLocals >= 1000 &&
          //     diffBetweenZeroAndReadyLocals <= 1070);

          // if (
          //   shouldFireOnLastSecond &&
          //   !lastSecondFnFired &&
          //   onLastSecondsFnName &&
          //   zeroSeenLocalAt
          // ) {
          //   lastSecondFnFired = true;
          //   lastSecondFnFiredWhenDiffWas = diffBetweenZeroAndReadyLocals;
          //   await window[onLastSecondsFnName]?.();
          // }

          _status.push({
            status,
            totalMsLeft,
            ok,
          });

          if (ok) {
            if (!onZeroSecondCalled && fnName) {
              await window[fnName]?.();
              onZeroSecondCalled = true;
              zeroSeenAt = serverNow || localNow;
              zeroSeenLocalAt = localNow;
            }

            diffBetweenZeroAndReadyLocals = localNow - zeroSeenLocalAt;

            if (loopCountWhenSecondIsOne) {
              pushPollLog({
                phase: "ready",
                attempt,
                requestStartsAt,
                responseReceivedAt: localNow,
                serverDateRaw,
                serverNow,
                localNow,
                diff,
                rtt,
                gapFromPreviousPollMs,
                sameServerSecondIndex,
                totalMsLeft,
                diffBetweenZeroAndReadyLocals,
                message: null,
              });

              readyDiff = diff;
            }

            readySeenAt = serverNow || localNow;
            readySeenAtLocalMs = localNow;
          }

          return {
            ok,
            reason: ok ? "ready" : "not-ready",
            message: message || null,
            serverDateRaw,
            serverNow,
            localNow,
            totalMsLeft,
            rtt,
          };
        } catch (error) {
          return {
            ok: false,
            reason: error?.name || "err in catch",
            errorMessage: error?.message || String(error),
            serverNow: null,
            localNow: null,
            totalMsLeft: -1,
            rtt: null,
          };
        }
      }

      const getPollDelay = (totalMsLeft) => {
        if (totalMsLeft <= 1000) return 0;
        if (totalMsLeft <= 3000) return 75;
        if (totalMsLeft <= 10000) return 165;
        return 500;
      };

      const tStart = performance.now();
      let attempts = 0;

      while (true) {
        attempts += 1;

        const { totalMsLeft, ok, localNow, message, rtt } =
          await fetchDetailsOnce(attempts);

        if (ok) {
          return {
            isOk: true,
            reason: "ready",
            message,
            elapsedMs: Math.round(performance.now() - tStart),
            attempts,
            claimableLocalTime: localNow,
            zeroSeenAt,
            zeroSeenLocalAt,
            readySeenAt,
            rtt,
            extraBackendDelayMs:
              zeroSeenAt && readySeenAt ? readySeenAt - zeroSeenAt : null,
            readySeenAtLocalMs,
            leftTimeWhenLastSecondsCalled,
            loopCountWhenSecondIsOne,
            timesWhenOneSecondStartedAndEnded: pollLogs,
            newWorkFlowZeroProps,
            _status,
            diffBetweenZeroAndReadyLocals,
            lastSecondFnFiredWhenDiffWas,
            readyDiff,
          };
        }

        const delay = getPollDelay(totalMsLeft);

        if (delay > 0) {
          await sleep(delay);
        }
      }
    },
    {
      baseWaslaHeaders,
      referralId,
      fnName,
      onLastSecondsFnName,
    },
  );
}

export default waitUntilCanTakeActionByWindow;

// {
//     "data": {
//         "requestDate": "2026-08-24T22:14:06",
//         "creationDate": "2026-08-24T19:16:04",
//         "ihalatyReference": "32902843",
//         "providerName": "TADAWI MEDICALhospital- khamis Mushayt",
//         "longitude": null,
//         "latitude": null,
//         "providerCode": "H523753",
//         "providerZoneCode": "15",
//         "providerCityCode": null,
//         "providerRegionCode": null,
//         "providerZone": "Asir",
//         "referralCause": "Bed Unavailable",
//         "requestedBedType": "Neonatal Intensive Care Unit (NICU)",
//         "claimType": null,
//         "doctor": null,
//         "estimationCost": 0,
//         "category": "HP",
//         "sourceProvider": "Al-Khamis Maternity and Children Hospital",
//         "referralTypeCode": "2",
//         "refType": "Emergency",
//         "requiredSpecialtyCode": "630",
//         "er": false,
//         "specialtyCode": "630",
//         "specialty": "Neonatology",
//         "mobileNumber": null,
//         "claimReference": null,
//         "lengthOfStay": 0,
//         "referralCauseDetails": {
//             "id": 35750,
//             "note": "NICU",
//             "isPublic": true,
//             "isActive": true,
//             "owner": null,
//             "canDelete": null,
//             "creationDate": null
//         },
//         "referralAdditionalInformation": null,
//         "status": "A",
//         "canUpdate": true,
//         "requiredSpecialty": "Neonatology",
//         "message": "",
//         "isPrivate": false,
//         "canTakeAction": true,
//         "quotaExceededMessage": "",
//         "assigningUser": "",
//         "creationUser": "",
//         "runQuotaAutomation": null,
//         "runPriorityAutomation": null
//     },
//     "statusCode": "Success",
//     "errorMessage": null
// }

// {
//     "data": {
//         "requestDate": "2026-08-24T22:14:06",
//         "creationDate": "2026-08-24T19:16:04",
//         "ihalatyReference": "32902843",
//         "providerName": "TADAWI MEDICALhospital- khamis Mushayt",
//         "longitude": null,
//         "latitude": null,
//         "providerCode": "H523753",
//         "providerZoneCode": "15",
//         "providerCityCode": null,
//         "providerRegionCode": null,
//         "providerZone": "Asir",
//         "referralCause": "Bed Unavailable",
//         "requestedBedType": "Neonatal Intensive Care Unit (NICU)",
//         "claimType": null,
//         "doctor": null,
//         "estimationCost": 0,
//         "category": "HP",
//         "sourceProvider": "Al-Khamis Maternity and Children Hospital",
//         "referralTypeCode": "2",
//         "refType": "Emergency",
//         "requiredSpecialtyCode": "630",
//         "er": false,
//         "specialtyCode": "630",
//         "specialty": "Neonatology",
//         "mobileNumber": null,
//         "claimReference": null,
//         "lengthOfStay": 0,
//         "referralCauseDetails": {
//             "id": 35750,
//             "note": "NICU",
//             "isPublic": true,
//             "isActive": true,
//             "owner": null,
//             "canDelete": null,
//             "creationDate": null
//         },
//         "referralAdditionalInformation": null,
//         "status": "A",
//         "canUpdate": true,
//         "requiredSpecialty": "Neonatology",
//         "message": "",
//         "isPrivate": false,
//         "canTakeAction": true,
//         "quotaExceededMessage": "",
//         "assigningUser": "",
//         "creationUser": "",
//         "runQuotaAutomation": null,
//         "runPriorityAutomation": null
//     },
//     "statusCode": "Success",
//     "errorMessage": null
// }

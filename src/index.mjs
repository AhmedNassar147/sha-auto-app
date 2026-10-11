import dotenv from "dotenv";
dotenv.config();

import fs from "node:fs";
import https from "node:https";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";

import puppeteer from "puppeteer";
import cron from "node-cron";

import PatientStore from "./PatientStore.mjs";
import readJsonFile from "./readJsonFile.mjs";

import waitForWaitingCountWithInterval, {
  continueFetchingPatientsIfPaused,
  pauseFetchingPatients,
} from "./waitForWaitingCountWithInterval.mjs";

import generateFolderIfNotExisting from "./generateFolderIfNotExisting.mjs";

import processSendPatientsToClient from "./processSendPatientsToClient.mjs";
// import createAndSendWeeklyReport from "./createAndSendWeeklyReport.mjs";

import {
  waitingPatientsFolderDirectory,
  COLLECTD_PATIENTS_FULL_FILE_PATH,
  USER_ACTION_TYPES,
  htmlFilesPath,
  generatedPdfsPathForAcceptance,
  generatedPdfsPathForRejection,
  screenshotsFolderDirectory,
  generatedSummaryFolderPath,
  errorsFolderDirectory,
  rawReferralResponsesFolderDirectory,
  TABS_COLLECTION_TYPES,
  APP_URL,
  // FAKE_REJECT_PROBE,
} from "./constants.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import installTelegramBotApi from "./installTelegramBotApi.mjs";
import {
  deleteOldCaseFiles,
  deletePatients,
  getCasesWithEmptyClaimStatus,
  getPatientsFiltered,
  getDistinctSpecialties,
  getPatient,
} from "./db.mjs";
import renderDbPage from "./dbPageHtml.mjs";
import summarizeDbWinners from "./summarizeDbWinners.mjs";
import summarizeLetterTypeOutcomes from "./summarizeLetterTypeOutcomes.mjs";
import runDbAcceptanceDecisions from "./runDbAcceptanceDecisions.mjs";
import buildCasesExcelReport from "./buildCasesExcelReport.mjs";
import startCloudflareTunnel from "./startCloudflareTunnel.mjs";
import handleUserActionOnCase from "./handleUserActionOnCase.mjs";
import sendNtfyMessage from "./sendNtfyMessage.mjs";
import handleSubmitReferral from "./handleSubmitReferral.mjs";
// import generatePdfs from "./generatePdfs.mjs";

// https://github.com/FiloSottile/mkcert/releases
// Download mkcert-vX.X.X-windows-amd64.exe
// Rename it to just mkcert.exe.
// mvoed it to C:\Windows\System32
// in powershell as admin i tried mkcert -version
// 1- mkcert -install
// 2- mkdir certs
// 3-  mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost

// in power shell as admin => ipconfig /flushdns
// to verify ping referralprogram.globemedsaudi.com // we see 127.0.0.1

// to install clouldflar on windows
// open powershell as admin => winget install Cloudflare.cloudflared

(async () => {
  const {
    CERT_PATH,
    KEY_PATH,
    HOST,
    PORT,
    WEEKLY_REPORT_GENERATED_AT,
    TG_TOKEN,
    CHROME_EXECUTABLE_PATH,
    USER_PROFILE_PATH,
    USE_NTFY_AS_CASE_PROVIDER,
  } = process.env;

  let server;
  let wss;
  let browser;
  let pingInterval;

  let isShuttingDown = false;

  let sendTelegramMessage = null;

  const notifyCrash = async (crashType) => {
    try {
      if (sendTelegramMessage) {
        await sendTelegramMessage(
          `❌ *App crashed* ❌\n` +
            `*crashType:* \`${crashType}\`\n\n` +
            `Please check the app immediately.\n` +
            `Close Unreal browser if running.\n` +
            `Restart the app/server.`,
        );
      }
    } catch (error) {}
  };

  async function shutdown(sig) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    createConsoleMessage("error", `\n${sig} received. Shutting down...`);

    try {
      clearInterval(pingInterval);
    } catch {}

    try {
      if (wss) {
        for (const c of wss.clients) {
          try {
            c.terminate();
          } catch {}
        }
        await new Promise((res) => {
          try {
            wss.close(() => res());
          } catch {
            res();
          }
        });
      }
    } catch {}

    try {
      if (browser) await browser.close();
    } catch {}

    try {
      if (server) {
        await new Promise((res) => {
          try {
            server.close(() => res());
          } catch {
            res();
          }
        });
      }
    } catch {}

    const isFatal =
      sig === "unhandledRejection" ||
      sig === "uncaughtException" ||
      sig === "startupCrash";

    process.exit(isFatal ? 1 : 0);
  }

  try {
    // Ensure folders exist
    await Promise.all([
      generateFolderIfNotExisting(screenshotsFolderDirectory),
      generateFolderIfNotExisting(waitingPatientsFolderDirectory),
      generateFolderIfNotExisting(generatedPdfsPathForAcceptance),
      generateFolderIfNotExisting(generatedPdfsPathForRejection),
      generateFolderIfNotExisting(htmlFilesPath),
      generateFolderIfNotExisting(generatedSummaryFolderPath),
      generateFolderIfNotExisting(errorsFolderDirectory),
      generateFolderIfNotExisting(rawReferralResponsesFolderDirectory),
      // generateFolderIfNotExisting(pollLogsFolderPath),
      // ensureCaseTimingLogsFile(),
      // checkSiteCodeConfig(),
    ]);

    const profilePath = `${USER_PROFILE_PATH}/Profile 1`;

    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      executablePath: CHROME_EXECUTABLE_PATH,
      userDataDir: profilePath,
      protocolTimeout: 190_000,
      ignoreDefaultArgs: ["--enable-automation"],
      // Chrome talks to Puppeteer over its stdio pipes instead of a
      // WebSocket, and self-exits the instant those pipes close - which
      // happens automatically whenever this Node process dies, for any
      // reason (graceful exit, a crash, or this process getting killed
      // directly without its children being targeted too). Reproduced and
      // confirmed in isolation: without this, killing just the Node process
      // leaves Chrome running as an orphan, since WebSocket transport gives
      // Chrome no way to notice the controlling process is gone. This is an
      // OS-level guarantee, independent of whether any of our own
      // SIGINT/SIGTERM handlers below ever get a chance to run.
      pipe: true,
      args: [
        "--start-maximized",
        "--disable-blink-features=AutomationControlled", // Prevent `navigator.webdriver = true`
        // "--disable-extensions", // Prevents loading suspicious default extensions
        "--disable-background-timer-throttling", // ← don't slow down background tabs
        "--disable-backgrounding-occluded-windows", // ← don't suspend hidden windows
        "--disable-renderer-backgrounding", // ← keep renderer active in background
        "--enable-gpu",
        "--use-gl=desktop",
        "--enable-webgl", // WebGL is often checked
        "--enable-webgl2",
        "--disable-dev-shm-usage", // Stability; safe even if not needed
      ],
    });

    // Restore collected patients, bootstrap store
    const collectedPatients = await readJsonFile(
      COLLECTD_PATIENTS_FULL_FILE_PATH,
      true,
    );

    // clearAllClaimedStatuses();
    const nonClaimableCases = getCasesWithEmptyClaimStatus();

    const patientsStore = new PatientStore(
      collectedPatients || [],
      nonClaimableCases,
    );

    // const patientArray = [
    //   {
    //     referralId: "4IMB5GR1V8FL0SU",
    //     createdAt: "2026-10-01 08:25:38",
    //     randomFileName: "Approval Form ELG-4Vepw 4IMB5GR1V8FL0SU ABDULLAH.pdf",
    //     requestedBedType: "Adult Intensive Care Unit (ICU)",
    //     cutoffTimeMs: 900,
    //     broadcastedAt: "2026-10-01 08:25:38",
    //     referralStartDate: "01/10/2026 08:25:38 am",
    //     referralEndDate: "01/10/2026 08:40:38 am",
    //     referralEndTimestamp: 1790833238000,
    //     referralEndDateActionableAtMS: 1790833237100,
    //     referralEndDateActionablAt: "01/10/2026 08:40:37 am",
    //     facilityReviewWindowMinutes: 15,
    //     acceptanceWindowMinutes: 60,
    //     extendScopeWindowMinutes: 60,
    //     referralReferenceId: "32999267",
    //     patientName: "ABDULLAH ALSHEHRI",
    //     patientNationalId: "1028984316",
    //     referralReason: "Medical Crisis",
    //     providerRegion: "Asir",
    //     referralType: "Emergency",
    //     status: "3",
    //     navigationId: "13501",
    //     mobileNumber: "0504675337",
    //     gender: "Male",
    //     nationality: "Saudi Arabia",
    //     specialty: "Internal Medicine",
    //     subSpecialty: "Hematology",
    //     sourceProvider: "ASEER CENTRAL HOSPITAL",
    //     note: "Admitted as a case of Emphesmatous Pyelitis for IV antibiotics. ",
    //     medicalData: "ICD10: A41.9 - Sepsis, unspecified",
    //     detailsAPiFiresAtMS: 1790832362397,
    //     detailsAPiServerResponseTimeMS: 111,
    //     letterType: "ELEGANT",
    //     tab: 1,
    //     tabName: "Referrals",
    //     paid: 0,
    //     scheduledAt: 1790832823185,
    //     providerAction: "accepted",
    //     isReceived: "yes",
    //     isSent: "yes",
    //     claimed: null,
    //     __reasonName__:
    //       "Aprtic dissection for cardiothoracic surgery speciality not available",
    //   },
    // ];

    // await generatePdfs(
    //   browser,
    //   patientArray,
    //   false,
    //   patientArray[0].letterType,
    // );

    await patientsStore.scheduleAllInitialPatients();

    sendTelegramMessage = await installTelegramBotApi(
      TG_TOKEN,
      patientsStore,
      browser,
    );

    // sendTelegramMessage = () => Promise.resolve();

    // if (typeof sendTelegramMessage === "function") {
    //   patientsStore.setTelegramMessageSender(sendTelegramMessage);
    // }

    patientsStore.on(
      "patientsAdded",
      processSendPatientsToClient(patientsStore, sendTelegramMessage),
    );

    // Background collector
    (async () =>
      await waitForWaitingCountWithInterval({
        collectionTabType: TABS_COLLECTION_TYPES.PENDING,
        browser,
        patientsStore,
        sendTelegramMessage,
      }))();

    // cleanup old case letter files from db
    cron.schedule(
      "0 3 * * *",
      async () => {
        createConsoleMessage("info", "✅ cases letters files cleanup");

        try {
          const result = deleteOldCaseFiles();

          createConsoleMessage(
            "info",
            `✅ cases letters files cleanup done, ${result.changes} files deleted.`,
          );
        } catch (err) {
          createConsoleMessage("error", err, "cases letters files cleanup");
        }
      },
      { timezone: "Asia/Riyadh" },
    );

    // // weekly Summary cron
    // cron.schedule(
    //   WEEKLY_REPORT_GENERATED_AT,
    //   async () => {
    //     createConsoleMessage("✅ Starting weekly report job", "info");
    //     try {
    //       await createAndSendWeeklyReport(browser, sendTelegramMessage);
    //       createConsoleMessage("✅ weekly report job done.", "info");
    //     } catch (err) {
    //       createConsoleMessage(
    //         err.message || err,
    //         "error",
    //         "weekly report job Failure",
    //       );
    //     }
    //   },
    //   { timezone: "Asia/Riyadh" },
    // );

    const app = express();
    app.use(express.json());
    // The /db page's export-to-Excel button is a plain HTML form POST
    // (application/x-www-form-urlencoded), not JSON - needed to read its
    // filter fields back out of req.body.
    app.use(express.urlencoded({ extended: true }));
    app.disable("x-powered-by");
    app.set("trust proxy", 1);
    app.use(
      cors({
        origin: APP_URL,
        methods: ["GET", "POST", "DELETE"],
        allowedHeaders: ["Content-Type"],
      }),
    );

    app.post("/action", async (req, res) => {
      try {
        const { action, referralId } = req.query;

        const { message, success } = await handleUserActionOnCase({
          patientsStore,
          referralId,
          action,
          // skipTimeValidation: true,
        });

        if (!success) {
          await sendNtfyMessage(message);
          return res.status(400).type("text/plain").send(message);
        }

        return res.status(200).type("text/plain").send(message);
      } catch (error) {
        const message = error?.message || "Internal server error";
        await sendNtfyMessage(`❌ ${message}`);
        return res.status(400).type("text/plain").send(message);
      }
    });

    app.get("/db", (req, res) => {
      try {
        const {
          referralId,
          patientNationalId,
          navigationId,
          specialty,
          status,
          referralDate,
          paid,
          claimed,
        } = req.query;
        const rows = getPatientsFiltered({
          referralId,
          patientNationalId,
          navigationId,
          specialty,
          status,
          referralDate,
          paid,
          claimed,
        });

        res.type("html").send(
          renderDbPage({
            rows,
            specialties: getDistinctSpecialties(),
            letterStatistics: req.query.letterStatistics === "1"
              ? summarizeLetterTypeOutcomes(getPatientsFiltered({
                  referralId, patientNationalId, navigationId, specialty,
                  status, referralDate, paid, claimed, all: true,
                })) : null,
            winnerStatistics:
              req.query.statistics === "1"
                ? summarizeDbWinners(
                    getPatientsFiltered({
                      referralId,
                      patientNationalId,
                      navigationId,
                      specialty,
                      status,
                      referralDate,
                      paid,
                      claimed,
                      all: true,
                    }),
                  )
                : null,
            filters: {
              referralId,
              patientNationalId,
              navigationId,
              specialty,
              status,
              referralDate,
              paid,
              claimed,
            },
          }),
        );
      } catch (error) {
        res
          .status(500)
          .type("text/plain")
          .send(error?.message || "Query failed");
      }
    });

    // The /db page's "📊 Send Excel" button - a plain form POST (same
    // filter fields as the page's own GET filter form, just re-pointed at
    // this route via formaction/formmethod) so it exports exactly whatever
    // the page is currently showing. POST, not GET, so a page refresh/back
    // navigation can't silently re-trigger sending the report again (same
    // reasoning as /db/delete below).
    app.post("/db/export-excel", async (req, res) => {
      try {
        const {
          referralId,
          patientNationalId,
          navigationId,
          specialty,
          status,
          referralDate,
          paid,
          claimed,
        } = req.body;

        const rows = getPatientsFiltered({
          referralId,
          patientNationalId,
          navigationId,
          specialty,
          status,
          referralDate,
          paid,
          claimed,
          limit: 2000,
        });

        const buffer = await buildCasesExcelReport(rows);
        const files = [
          {
            fileBase64: buffer.toString("base64"),
            fileName: `cases-export-${Date.now()}.xlsx`,
            extension: "xlsx",
          },
        ];

        const caption = `📊 Cases export: ${rows.length} case${rows.length === 1 ? "" : "s"} matching the current /db filters.`;

        const activeChatId = process.env.TG_CHAT_ID;
        const watcherChatId = process.env.VERIFICATION_CODE_WATCHER_CHAT_ID;

        await sendTelegramMessage?.(caption, files);

        // Only a second send when the watcher chat is actually a different
        // chat - otherwise the active chat would get the same report twice.
        // if (watcherChatId && watcherChatId !== activeChatId) {
        //   await sendTelegramMessage?.(
        //     caption,
        //     files,
        //     undefined,
        //     watcherChatId,
        //     true,
        //   );
        // }

        res.redirect(req.get("Referer") || "/db");
      } catch (error) {
        res
          .status(500)
          .type("text/plain")
          .send(error?.message || "Export failed");
      }
    });

    // The /db page's per-row "Remove" button - POST (not GET) since this
    // is destructive and shouldn't be triggerable as a side effect of a
    // plain navigation/prefetch. Redirects back to wherever the request
    // came from so the admin stays on the same filtered view, falling
    // back to the unfiltered page if there's no Referer header.
    const pendingDbDecisions = new Set();
    app.post("/db/decision/:referralId", async (req, res) => {
      const { referralId } = req.params;
      const patient = getPatient(referralId);
      if (!patient?.navigationId) {
        return res
          .status(404)
          .json({ error: "Case or navigation ID not found." });
      }
      if (!/^\d+$/.test(String(patient.caseAttachmentId))) {
        return res.status(400).json({
          error:
            "caseAttachmentId is missing. Run backfill or check the case upload.",
        });
      }
      if (pendingDbDecisions.has(referralId)) {
        return res
          .status(409)
          .json({ error: "Decisions already running for this case." });
      }
      pendingDbDecisions.add(referralId);
      try {
        const results = await runDbAcceptanceDecisions({
          browser,
          patient,
        });
        return res.json({ results });
      } catch (error) {
        return res.status(500).json({ error: error.message });
      } finally {
        pendingDbDecisions.delete(referralId);
      }
    });

    app.post("/db/delete/:referralId", (req, res) => {
      const { referralId } = req.params;

      deletePatients(referralId);

      res.redirect(req.get("Referer") || "/db");
    });

    // Create HTTPS server
    const cert = fs.readFileSync(CERT_PATH);
    const key = fs.readFileSync(KEY_PATH);
    server = https.createServer({ cert, key }, app);

    // ---------- WebSocket (event-only, no auto-kill) ----------
    wss = new WebSocketServer({ server, perMessageDeflate: false });

    const broadcast = (obj) => {
      const data = JSON.stringify(obj);
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          try {
            client.send(data);
          } catch {}
        }
      }
    };

    wss.on("connection", (ws) => {
      try {
        ws._socket.setKeepAlive(true, 60_000);
      } catch {}

      ws.on("pong", () => {
        /* passive heartbeat; no enforcement */
      });

      ws.on("message", () => {
        /* event-only; no inbound commands */
      });
    });

    // Passive heartbeat to keep intermediaries from idling out
    const HEARTBEAT_MS = 30_000;
    pingInterval = setInterval(() => {
      for (const ws of wss.clients) {
        if (ws.readyState === 1) {
          try {
            ws.ping();
          } catch {}
        }
      }
    }, HEARTBEAT_MS);

    wss.on("close", () => clearInterval(pingInterval));

    patientsStore.on(
      "patientAccepted",
      handleSubmitReferral({
        browser,
        actionType: USER_ACTION_TYPES.ACCEPT,
        broadcast,
        sendTelegramMessage,
        continueFetchingPatientsIfPaused,
        patientsStore,
      }),
    );

    patientsStore.on(
      "patientRejected",
      handleSubmitReferral({
        browser,
        actionType: USER_ACTION_TYPES.REJECT,
        broadcast,
        sendTelegramMessage,
        continueFetchingPatientsIfPaused,
        patientsStore,
      }),
    );

    // patientsStore.on(
    //   FAKE_REJECT_PROBE,
    //   handleSubmitReferral({
    //     browser,
    //     actionType: FAKE_REJECT_PROBE,
    //     broadcast,
    //     sendTelegramMessage,
    //     continueFetchingPatientsIfPaused,
    //     patientStore: patientsStore,
    //   }),
    // );

    // ---------- Start ----------
    // server.listen(Number(PORT), HOST, () => {
    //   createConsoleMessage(`HTTPS listening on https://${HOST}:${PORT}`);
    //   startCloudflareTunnel();
    // });

    await new Promise((resolve) => {
      server.listen(Number(PORT), HOST, resolve);
    });

    createConsoleMessage("info", `HTTPS listening on https://${HOST}:${PORT}`);
    createConsoleMessage("info", `📊 Cases DB: https://localhost:${PORT}/db`);

    if (USE_NTFY_AS_CASE_PROVIDER == "Y") {
      await startCloudflareTunnel();
    }

    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
    // nodemon's documented convention for "clean up before I respawn you"
    // is SIGUSR2, not SIGINT/SIGTERM - kept for portability to POSIX
    // platforms where nodemon actually delivers it. On Windows it's a
    // no-op: Node here can't even send SIGUSR2 (process.kill throws
    // ERR_UNKNOWN_SIGNAL for it), and nodemon's own source force-kills the
    // whole process tree via `taskkill /T /F` for a Windows restart instead
    // of signaling - see the `pipe: true` launch option above, which is
    // what actually prevents an orphaned Chrome on this platform.
    process.on("SIGUSR2", () => {
      void shutdown("SIGUSR2");
    });

    // Optional: catch fatals and shut down cleanly
    process.on("unhandledRejection", async (e) => {
      createConsoleMessage("error", e, "unhandledRejection:");
      await notifyCrash("unhandledRejection");
      await shutdown("unhandledRejection");
    });
    process.on("uncaughtException", async (e) => {
      createConsoleMessage("error", e, "uncaughtException:");
      await notifyCrash("uncaughtException");
      await shutdown("uncaughtException");
    });
  } catch (error) {
    createConsoleMessage("error", error, "❌ index.mjs crashed:");
    await notifyCrash("startupCrash");
    await shutdown("startupCrash");
  }
})();

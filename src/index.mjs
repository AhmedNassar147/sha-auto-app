import dotenv from "dotenv";
dotenv.config();

import fs from "node:fs";

import puppeteer from "puppeteer";
import cron from "node-cron";

import PatientStore from "./PatientStore.mjs";
import readJsonFile from "./readJsonFile.mjs";

import waitForWaitingCountWithInterval, {
  continueFetchingPatientsIfPaused,
  pauseFetchingPatients,
} from "./waitForWaitingCountWithInterval.mjs";

import generateFolderIfNotExisting from "./generateFolderIfNotExisting.mjs";

// import processSendPatientsToClient from "./processSendPatientsToClient.mjs";
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
  TABS_COLLECTION_TYPES,
  APP_URL,
  FAKE_REJECT_PROBE,
} from "./constants.mjs";

import createConsoleMessage from "./createConsoleMessage.mjs";
// import installTelegramBotApi from "./installTelegramBotApi.mjs";
// import { deleteOldCaseFiles } from "./db.mjs";
import startCloudflareTunnel from "./startCloudflareTunnel.mjs";
import handleUserActionOnCase from "./handleUserActionOnCase.mjs";
import sendNtfyMessage from "./sendNtfyMessage.mjs";

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

    // try {
    //   await shutdownAllClients();
    // } catch (e) {
    //   createConsoleMessage(e, "error", "shutdownAllClients failed:");
    // }

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

    // const nonClaimableCases = await getCasesWithEmptyClaimStatus();

    const patientsStore = new PatientStore(
      collectedPatients || [],
      [],
      // nonClaimableCases,
    );

    await patientsStore.scheduleAllInitialPatients();

    // sendTelegramMessage = await installTelegramBotApi(
    //   TG_TOKEN,
    //   patientsStore,
    //   browser,
    // );

    sendTelegramMessage = () => Promise.resolve();

    // if (typeof sendTelegramMessage === "function") {
    //   patientsStore.setTelegramMessageSender(sendTelegramMessage);
    // }

    // patientsStore.on(
    //   "patientsAdded",
    //   processSendPatientsToClient(patientsStore, sendTelegramMessage),
    // );

    // Background collector
    (async () =>
      await waitForWaitingCountWithInterval({
        collectionTabType: TABS_COLLECTION_TYPES.PENDING,
        browser,
        patientsStore,
        sendTelegramMessage,
      }))();

    // cleanup old case letter files from db
    // cron.schedule(
    //   "0 3 * * *",
    //   async () => {
    //     createConsoleMessage("✅ cases letters files cleanup", "info");

    //     try {
    //       const result = deleteOldCaseFiles();

    //       createConsoleMessage(
    //         `✅ cases letters files cleanup done, ${result.changes} files deleted.`,
    //         "info",
    //       );
    //     } catch (err) {
    //       createConsoleMessage(
    //         err.message || err,
    //         "error",
    //         "cases letters files cleanup",
    //       );
    //     }
    //   },
    //   { timezone: "Asia/Riyadh" },
    // );

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

    // patientsStore.on(
    //   "patientAccepted",
    //   handleCaseAcceptanceOrRejection({
    //     browser,
    //     actionType: USER_ACTION_TYPES.ACCEPT,
    //     broadcast,
    //     sendTelegramMessage,
    //     continueFetchingPatientsIfPaused,
    //     patientStore: patientsStore,
    //   }),
    // );

    // patientsStore.on(
    //   "patientRejected",
    //   handleCaseAcceptanceOrRejection({
    //     browser,
    //     actionType: USER_ACTION_TYPES.REJECT,
    //     broadcast,
    //     sendTelegramMessage,
    //     continueFetchingPatientsIfPaused,
    //     patientStore: patientsStore,
    //   }),
    // );

    // patientsStore.on(
    //   FAKE_REJECT_PROBE,
    //   handleCaseAcceptanceOrRejection({
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

    if (USE_NTFY_AS_CASE_PROVIDER == "Y") {
      await startCloudflareTunnel();
    }

    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
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

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node.js/Puppeteer automation bot for a Saudi medical-referral facility portal (GlobeMed / SEHA "Weslah" referral program, `referralprogram.globemedsaudi.com`). It logs into the portal, polls for incoming patient referral cases, fetches case details via in-page `fetch` calls, generates acceptance/rejection PDF letters, and lets a human operator accept/reject each case within a strict time window through a Telegram bot control interface.

## Repo state — read this before assuming anything works

This working copy is a **partial snapshot**: many modules that `src/*.mjs` files `import` do not exist on disk, and `src/index.mjs` (the `start` script's entry point) is currently empty. Known-missing modules referenced from existing files include: `constants.mjs`, `db.mjs`, `randomArrayItem.mjs`, `checkPathExists.mjs`, `checkIfLoginPage.mjs`, `patchBundleFromPage.mjs`, `getIdProviderFromSession.mjs`, `fetchPatientsFromAPI.mjs`, `createReloadAndCheckIfShouldCreateNewPage.mjs`, `handleLockedOutRetry.mjs`, `checkReferralSelectedStatus.mjs`, `PauseController.mjs`, `getExtraTimeBasedLogs.mjs`, `summarizeLogsAfterAcceptance.mjs`, `createAndSendInvoiceReport.mjs`, `handleUserActionOnCase.mjs`, `getLoginErrors.mjs`, `startCloudflareTunnel.mjs`. (`ghost-cursor` is now installed as a real dependency.)

Before wiring up a feature that touches one of these, check whether the file actually exists (`ls src/`) rather than assuming the import resolves. Don't invent contents for a missing module unless asked — it may exist elsewhere and just not be present in this checkout.

## Commands

- `yarn start` — runs `nodemon --watch src --ext mjs,js,json ./src/index.mjs`. There is no build step, no lint script, and no test script defined in `package.json`.
- Formatting is Prettier via `.prettierrc` (80-char width, double quotes, semicolons) with format-on-save wired in `.vscode/settings.json` (`editor.codeActionsOnSave: source.fixAll.eslint` implies an ESLint config is expected, but none is currently present in the repo).
- All source is ESM (`"type": "module"` in package.json) — files use `.mjs` and `import`/`export`, not CommonJS.

## Architecture

**Runtime shape**: a long-lived Puppeteer browser session drives the referral portal UI (for login/session cookies) while most data fetching bypasses the UI entirely by calling the portal's internal JSON APIs from inside `page.evaluate()` (see [getPatientReferralDataFromAPI.mjs](src/getPatientReferralDataFromAPI.mjs), [waitUntilCanTakeActionByWindow.mjs](src/waitUntilCanTakeActionByWindow.mjs)) — this reuses the page's cookies/CSRF context without page navigation.

**Main poll loop** ([waitForWaitingCountWithInterval.mjs](src/waitForWaitingCountWithInterval.mjs), not fully present): every ~70s, ensures login ([makeUserLoggedInOrOpenHomePage.mjs](src/makeUserLoggedInOrOpenHomePage.mjs)), fetches the pending-cases list from the portal API, hands new cases to [processCollectingPatients.mjs](src/processCollectingPatients.mjs), reconciles the in-memory store against what the API currently reports (removing stale/unsynced cases), and reloads the page periodically to avoid session staleness.

**Time-window logic is the core business constraint**: each referral case has a short claimable window (~15 minutes) computed from `referralDate`/`caseAlertMessage`, reconciled against the portal server's HTTP `Date` header (to correct for client clock drift) rather than trusting local time alone — see `getSaudiStartAndEndDate` in [processCollectingPatients.mjs](src/processCollectingPatients.mjs) and the polling logic in [waitUntilCanTakeActionByWindow.mjs](src/waitUntilCanTakeActionByWindow.mjs). A `cutoffTimeMs` safety margin is subtracted from the window so an action still lands before the deadline. Timers for scheduled accept/reject actions are managed by `waitMinutesThenRun` per case.

**PatientStore** ([PatientStore.mjs](src/PatientStore.mjs)) is the in-memory source of truth: an `EventEmitter`-based map of cases keyed by `referralId`, responsible for scheduling accept/reject actions (`patientAccepted`/`patientRejected` events), "fake reject probe" scheduling for cases nobody acted on in time, persisting snapshots to disk via `writePatientData`, and mirroring state into a "weekly history" store (`db.mjs`, not present — expected to be a SQLite-backed module given `better-sqlite3`/`sqlite3` deps).

**Telegram bot** ([installTelegramBotApi.mjs](src/installTelegramBotApi.mjs)) is the human control surface: inline-keyboard buttons per case (Accept/Reject/Cancel/Online/Left-Time) plus slash commands for multi-operator handoff (`/me`, `/activate`, `/who`, `/get_users`), wait-time tuning (`/wait`, `/auto_wait`), letter/invoice retrieval, and remote ops (`/update_code` pulls git + restarts). It reacts to `PatientStore` events to push notifications and drive the accept/reject flow.

**PDF letter generation** ([generateAcceptanceLetterHtml.mjs](src/generateAcceptanceLetterHtml.mjs), [generatePdfs.mjs](src/generatePdfs.mjs)): builds an HTML letter (multiple layouts keyed by `LETTER_LAYOUT_TYPES`, randomly/config-selected per `LETTER_TYPE` env var) with base64-embedded logos from `images/`, then rasterizes to PDF. Separate flows exist for acceptance vs. rejection letters.

**File/notification pipeline**: attachments downloaded from the portal are merged into one PDF ([mergeFilesToOne.mjs](src/mergeFilesToOne.mjs)), compressed ([compressPdfGentlly.mjs](src/compressPdfGentlly.mjs)/[compressPdf.mjs](src/compressPdf.mjs)), and either uploaded to transfer.it via a scripted Puppeteer flow ([uploadToTransferIt.mjs](src/uploadToTransferIt.mjs)) or sent through Telegram/WhatsApp formatting ([formatFilesToTelgram.mjs](src/formatFilesToTelgram.mjs), [formatPatientToTelegramOrWA.mjs](src/formatPatientToTelegramOrWA.mjs)) or ntfy push ([sendNtfyMessage.mjs](src/sendNtfyMessage.mjs), [formatPatientToNtfy.mjs](src/formatPatientToNtfy.mjs)) depending on the `USE_NTFY_AS_CASE_PROVIDER` env var.

**Config is env-driven** (`.env`, gitignored): credentials (`CLIENT_NAME`/`CLIENT_PASSWORD`), feature toggles (`USE_NTFY_AS_CASE_PROVIDER`, `LETTER_TYPE`), and cached values written back at runtime via [updateEnvFile.mjs](src/updateEnvFile.mjs) (e.g. `ID_PROVIDER` gets cached after first successful login).

## The `html/` and `app-images/` directories

`html/` (gitignored) holds raw captured HTML/JS/API traffic from the target portal(s) — including one file with captured bearer tokens/cookies from a live session — kept purely as reverse-engineering reference for selectors and API shapes, not executed by the app. Treat its contents as recon notes, not live credentials, and never copy tokens out of it into committed code. `app-images/` and `images/` hold screenshots/logos used in docs and generated PDF letters respectively.

## Anti-detection considerations

Puppeteer interactions favor human-like behavior deliberately: `ghost-cursor` for mouse movement, randomized `sleep()` jitter between actions (see call sites throughout [processCollectingPatients.mjs](src/processCollectingPatients.mjs), [waitForWaitingCountWithInterval.mjs](src/waitForWaitingCountWithInterval.mjs)), and typing with randomized per-character delay. Preserve this pattern when adding new page interactions rather than firing actions back-to-back.

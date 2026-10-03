/*
 *
 * Constants
 *
 */
export const cwd = process.cwd();

export const siteCodeConfigFile = `${cwd}/sitecode_config.json`;
export const screenshotsFolderDirectory = `${cwd}/screenshots`;
export const casesTimingLogsFilePath = `${cwd}/results/cases-timing-logs.txt`;
export const waitingPatientsFolderDirectory = `${cwd}/results/waiting-patients`;
export const generatedPdfsPathForAcceptance = `${cwd}/results/generated-acceptance-pdf`;
export const generatedPdfsPathForRejection = `${cwd}/results/generated-rejection-pdf`;
export const generatedSummaryFolderPath = `${cwd}/results/summary`;
// export const pollLogsFolderPath = `${cwd}/results/poll-logs`;
export const htmlFilesPath = `${cwd}/results/html`;
export const errorsFolderDirectory = `${cwd}/results/errors`;
export const rawReferralResponsesFolderDirectory = `${cwd}/results/raw-referral-responses`;
export const COLLECTD_PATIENTS_FILE_NAME = "collectedPatients";
export const COLLECTD_PATIENTS_FULL_FILE_PATH = `${waitingPatientsFolderDirectory}/${COLLECTD_PATIENTS_FILE_NAME}.json`;

export const WASLA_REFERRAL_IFRAME_TIMEOUT_MS = 20_000;
export const WASLA_REFERRAL_CONTENT_IFRAME_SELECTOR = "#contentIframe";

export const sidebarMenuItemSelector = ".ant-layout-sider-children ul > li";
export const nafathLoginLinkSelector = 'a[data-testid="nafath-login-link"]';
export const NAFATH_HOSTNAME = "iam.gov.sa";

export const TABS_COLLECTION_TYPES = {
  PENDING: "PENDING",
  MY_ACCEPT: "MY_ACCEPT",
};

// Y = ((t) => (
//     (t[(t.Draft = 1)] = "Draft"),
//     (t[(t.PendingAcceptance = 2)] = "PendingAcceptance"),
//     (t[(t.Accepted = 3)] = "Accepted"),
//     (t[(t.Rejected = 4)] = "Rejected"),
//     (t[(t.PendingEscalation = 5)] = "PendingEscalation"),
//     (t[(t.ConfirmedArrival = 6)] = "ConfirmedArrival"),
//     (t[(t.Closed = 7)] = "Closed"),
//     (t[(t.ScopeExpansion = 8)] = "ScopeExpansion"),
//     (t[(t.ReferralTransferRequest = 9)] = "ReferralTransferRequest"),
//     (t[(t.Withdraw = 10)] = "Withdraw"),
//     (t[(t.PendingBroadcast = 11)] = "PendingBroadcast"),
//     t

// this is only for my orders table
export const WASLA_STATUS_TYPES = {
  1: "Confirmed",
  2: "Rejected",
  3: "WaitingAcceptance",
  4: "ConfirmedArrival",
  5: "Withdrawn",
  6: "RejectedByCNHI",
  7: "AnotherFacilityApproved",
};

// Numbers, not strings - checkReferralSelectedStatus.mjs's fetchCase()
// converts the Wasla API's own status field (a string, e.g. "status": "3")
// to a Number() once, right where it's read, specifically so it can be
// compared against these as numbers. Matches WASLA_STATUS_TYPES' numeric
// keys above (object keys stringify either way, so that lookup was never
// type-sensitive - only the === and .includes() checks here are).
export const CLAIMED_STATUS_CODES = [1, 4];
export const WAITING_ACCEPTANCE_STATUS_CODES = 3;

export const PATIENT_SECTIONS_STATUS = {
  [TABS_COLLECTION_TYPES.PENDING]: {
    targetText: "Pending Referrals",
    foundCountText: "waiting referrals",
    noCountText: "No waiting referrals found",
    tab: 1,
    categoryReference: "pending",
  },
  [TABS_COLLECTION_TYPES.MY_ACCEPT]: {
    targetText: "Accepted Referrals",
    foundCountText: "Accepted referrals requests",
    noCountText: "No Accepted referrals requests found",
    tab: 2,
    categoryReference: "accepted",
  },
  [TABS_COLLECTION_TYPES.CONFIRMED]: {
    targetText: "Confirmed Referrals",
    foundCountText: "confirmed referrals requests",
    noCountText: "No confirmed referrals requests found",
    categoryReference: "confirmed",
  },
  [TABS_COLLECTION_TYPES.ADMITTED]: {
    targetText: "Admitted Requests",
    foundCountText: "Admitted referrals requests",
    noCountText: "No Admitted referrals found",
    categoryReference: "admitted",
  },
  [TABS_COLLECTION_TYPES.DISCHARGED]: {
    targetText: "Discharged Requests",
    foundCountText: "Discharged Requests requests",
    noCountText: "No Discharged Requests found",
    categoryReference: "discharged",
  },
  [TABS_COLLECTION_TYPES.DECLINED]: {
    targetText: "Declined Referrals",
    foundCountText: "Declined referrals requests",
    noCountText: "No Declined referrals requests found",
    tab: 6,
    categoryReference: "declined",
  },
};

// the user will review patient till the 13 minute of the counter
// export const STOP_USER_ACTION_MINUTES = ALLOWED_MINUTES_TO_REVIEW_PATIENTS - 13;

export const ALLOWED_MINUTES_TO_REVIEW_PATIENTS = 15;

// Confirmed live (real 400 from Wasla: "Acceptance is not allowed before
// the 15-minute review window has elapsed") and straight from Wasla's own
// bundled source (scripts/ReviewWindowTimer-DAyGxrbR.js): the facility
// review window is a MINIMUM WAIT, not a deadline to beat - the Accept
// button itself only enables once Date.now() >= broadcastedAt +
// facilityReviewWindowMinutes. So this is a deliberate HEAD START before
// that boundary, not a safety margin subtracted from a deadline: it's how
// much time getWaslaCaseWindow's scheduling (referralEndDateActionableAtMS
// = referralEndTimestamp - cutoffTimeMs) gives handleSubmitReferral.mjs to
// do prep work ahead of the boundary (open a page, pre-upload the letter)
// before precisely sleeping out whatever time is actually left until the
// boundary and only then submitting - see handleSubmitReferral.mjs's own
// diff-based sleep for the part that actually guarantees landing on the
// right side of it; this constant just needs to comfortably cover that
// prep work's own duration so the diff is never negative.
//
// PatientStore.calculateCanStillProcessPatient computes lastTime =
// referralEndDateActionableAtMS + (cutoffTimeMs -
// searchIfAcceptacneButtonShownMS) - searchIfAcceptacneButtonShownMS
// derives from cutoffTimeMs (rather than being a second independent
// literal) so that difference stays structurally zero; two separately
// -edited constants that merely happened to match would let a future
// one-line change to just one of them silently shrink the "can still
// process" window.
export const cutoffTimeMs = 3000;
export const searchIfAcceptacneButtonShownMS = cutoffTimeMs;

export const USER_MESSAGES = {
  alreadyScheduledAccept: "Already scheduled for acceptance.",
  alreadyScheduledReject: "Already scheduled for rejection.",
  scheduleAcceptSuccess: "scheduled for acceptance.",
  scheduleRejectSuccess: "scheduled for rejection.",
  notFound: "Patient does not exist.",
  expired: "Time expired",
  canProcess: "Patient can still be processed.",
  cancelSuccess: "scheduled for cancellation.",
  noAction: "No-need, No scheduled action for this patient.",
};

export const FAKE_REJECT_PROBE = "patientFakeRejectProbe";

export const USER_ACTION_TYPES = {
  SUPPER_ACCEPT: "super_accept",
  ACCEPT: "accept",
  REJECT: "reject",
  COLLECT: "collect",
};

export const CONFIRMATION_TYPES = {
  SUPPER_ACCEPT: ["super_accept", "11"],
  ACCEPT: ["accept", "1"],
  REJECT: ["reject", "00"],
  CANCEL: ["cancel", "0"],
  SENT_NO_REPLY: ["sent-with-no-reply", "-1"],
  RECEIVED_NO_REPLY: ["received-with-no-reply", "-2"],
};

export const APP_URL = "https://seha.sa";

export const LOGIN_PAGE_PATH_NAME = `#/account/login`;
export const LOGIN_PAGE_URL = `${APP_URL}/${LOGIN_PAGE_PATH_NAME}`;

export const HOME_PAGE_PATH_NAME = `#/Dashboard`;
export const HOME_PAGE_URL = `${APP_URL}/${HOME_PAGE_PATH_NAME}`;

// The Wasla widget's own frontend origin - normally embedded as an iframe
// inside seha.sa (see openWaslaReferralWidget.mjs), but also directly
// visitable as its own standalone site under the same authenticated
// browser session (cookies/localStorage are shared per-origin across tabs
// in one Puppeteer browser context, not scoped to a single page/frame).
export const WASLA_APP_URL = "https://weslah.seha.sa";

export const WASLA_REFERRAL_VIEW_URL = `${WASLA_APP_URL}/facility-referrals/view`;
// Neutral, lightweight page used to pre-upload the letter attachment ahead
// of the facility-review-window boundary (see handleSubmitReferral.mjs) -
// any authenticated page on this origin works for the upload (it only
// needs the persist:auth token from localStorage, which is origin-scoped,
// not page-scoped), so there's no need to pay for the heavier case-detail
// page's own navigation/data-fetch cost before the boundary actually opens.
export const WASLA_FACILITY_REFERRALS_PENDING_URL = `${WASLA_APP_URL}/facility-referrals?tab=1`;
export const BASE_WASLA_API_URL = `${WASLA_APP_URL}/api`;
export const baseReferraAPiUrl = `${BASE_WASLA_API_URL}/referrals`;

export const API_URLS = {
  CASES_LIST: `${baseReferraAPiUrl}/facility/tabs`,
  DISTRIBUTION_WINDOWS_URL: `${BASE_WASLA_API_URL}/lookup/distribution-windows`,
  NOTIFICATIONS_LIST: `${BASE_WASLA_API_URL}/notifications`,
  UPLOAD_ATTACHMENT: `${BASE_WASLA_API_URL}/attachments/upload`,
  // https://weslah.seha.sa/api/attachments/upload
  // Request Method: POST
  // headers
  //   :authority
  // weslah.seha.sa
  // :method
  // POST
  // :path
  // /api/attachments/upload
  // :scheme
  // https
  // accept
  // application/json
  // accept-encoding
  // gzip, deflate, br, zstd
  // accept-language
  // en-US,en;q=0.9
  // authorization
  // Bearer <redacted JWT - was a live token, see git history/chat if needed>
  // content-length
  // 1416
  // content-type
  // multipart/form-data; boundary=----WebKitFormBoundaryPK7AacI9suxtz2kV
  // cookie
  // <redacted - was a live session cookie string (__cf_bm/_ga/nonce/state)>
  // culture
  // en-US
  // origin
  // https://weslah.seha.sa
  // priority
  // u=1, i
  // referer
  // https://weslah.seha.sa/my-orders/view/13486
  // sec-ch-ua
  // "Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"
  // sec-ch-ua-mobile
  // ?0
  // sec-ch-ua-platform
  // "Windows"
  // sec-fetch-dest
  // empty
  // sec-fetch-mode
  // cors
  // sec-fetch-site
  // same-origin
  // user-agent
  // Mozilla/5.0 (Windows NT 10.0; Win64;
  // payload file (binary)
  // response: {
  //     "id": 31284,
  //     "fileName": "accept-GEYLI822DA73TBP.pdf",
  //     "fileType": ".pdf",
  //     "url": "https://api-minio.lean.sa/red-upload-bucket/c1d1a539080a4845bd368034a34aa00a.pdf",
  //     "key": "c1d1a539080a4845bd368034a34aa00a.pdf",
  //     "fileSize": 17413,
  //     "documentType": 0
  // }

  // https://weslah.seha.sa/api/referrals/13474/accept-json
  // payload: {"accept":true,"notes":"accept","file":"31284"}
  // {message: " Referral accepted successfully."}
  ACCEPT_OR_REJECT_CASE: `${baseReferraAPiUrl}/_nav_id_/accept-json`,
  // Confirmed straight from the Wasla frontend's own bundled RTK Query
  // slice (scripts/index-DkGuikpU.js, "confirmPatientArrival" mutation),
  // not a live network capture like the others above - a different
  // top-level resource (admissions, not referrals), no file/attachment
  // field at all:
  //   query: (t) => ({ url: `/admissions/${t.referralId}/arrival`, method: "POST",
  //     body: { nationalId: t.nationalId, arrivalAt: t.arrivalAt, notes: t.notes } })
  CONFIRM_PATIENT_ARRIVAL: `${BASE_WASLA_API_URL}/admissions/_nav_id_/arrival`,
  // Same source as CONFIRM_PATIENT_ARRIVAL above (scripts/index-DkGuikpU.js,
  // "withdrawFromReferral" mutation) - unlike arrival confirmation, this one
  // DOES need a file first (same two-step upload-then-post shape as
  // ACCEPT_OR_REJECT_CASE/submitWaslaReferralViaApi.mjs, confirmed by the
  // frontend's own withdrawal modal requiring an attachment):
  //   query: (t) => ({ url: `/admissions/${t.referralId}/withdraw`, method: "POST",
  //     body: { notes: t.notes, file: t.file } })
  WITHDRAW_FROM_REFERRAL: `${BASE_WASLA_API_URL}/admissions/_nav_id_/withdraw`,
};

export const baseWaslaHeaders = {
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

export const LETTER_LAYOUT_TYPES = {
  STANDARD: "STANDARD",
  FORMAL: "FORMAL",
  MODERN: "MODERN",
  CORPORATE: "CORPORATE",
  ELEGANT: "ELEGANT",
  EXECUTIVE: "EXECUTIVE",
  PREMIUM: "PREMIUM",
};

export const LETTER_LAYOUT_NAMES = Object.values(LETTER_LAYOUT_TYPES);

export const LETTER_LAYOUT_ABBREVIATIONS = {
  [LETTER_LAYOUT_TYPES.STANDARD]: "STD",
  [LETTER_LAYOUT_TYPES.FORMAL]: "FRM",
  [LETTER_LAYOUT_TYPES.MODERN]: "MDN",
  [LETTER_LAYOUT_TYPES.ELEGANT]: "ELG",
  [LETTER_LAYOUT_TYPES.PREMIUM]: "PRM",
  [LETTER_LAYOUT_TYPES.EXECUTIVE]: "EXE",
  [LETTER_LAYOUT_TYPES.CORPORATE]: "COR",
};

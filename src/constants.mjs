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

export const cutoffTimeMs = 22_000;
export const searchIfAcceptacneButtonShownMS = 22_000;

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

export const BASE_WASLA_API_URL = "https://weslah.seha.sa/api";
export const baseReferraAPiUrl = `${BASE_WASLA_API_URL}/referrals`;

export const API_URLS = {
  CASES_LIST: `${baseReferraAPiUrl}/facility/tabs`,
  CASEE_ATTACHMENTS: `${baseReferraAPiUrl}/attachments`,
  CASEE_INFO: `${baseReferraAPiUrl}/patient-info`,
  CASEE_DETAILS: `${baseReferraAPiUrl}/details`,
  CASEE_DOWNLOAD_ATTACHMENT: `${baseReferraAPiUrl}/download-attachment`,
  ACCEPT_CASE: `${baseReferraAPiUrl}/accept`,
  REJECT: `${baseReferraAPiUrl}/reject`,
  DISTRIBUTION_WINDOWS_URL: `${BASE_WASLA_API_URL}/lookup/distribution-windows`,
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

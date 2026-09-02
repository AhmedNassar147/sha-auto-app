/*
 * File to handle db
 */
import Database from "better-sqlite3";

const patientsDbFilePath = `${process.cwd()}/patients.db`;
const casesLettersFilePath = `${process.cwd()}/casesLetters.db`;

const db = new Database(patientsDbFilePath);
const casesLettersDb = new Database(casesLettersFilePath);

// Optional but generally sensible for SQLite apps
// db.pragma("journal_mode = WAL");

(() => {
  casesLettersDb.exec(`
    CREATE TABLE IF NOT EXISTS casesFilesDb (
      referralId TEXT PRIMARY KEY,
      date INTEGER NOT NULL,
      action TEXT NOT NULL,
      tgFileId TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_casesFilesDb_date
    ON casesFilesDb(date);
  `);

  // The old GlobMed-era table keyed patients on a rowKey
  // (referralId-nationalId) and required a referralDate column. Wasla's
  // referralId is already globally unique on its own (it's the Map key
  // PatientStore uses in memory), so a table still carrying that old rowKey
  // column is a leftover from before the Wasla migration — rebuild it fresh
  // rather than trying to migrate columns that no longer apply. This is
  // local dev/test data, not anything durable.
  const hasLegacyRowKeyColumn = db
    .prepare(`PRAGMA table_info(patients)`)
    .all()
    .some((column) => column.name === "rowKey");

  if (hasLegacyRowKeyColumn) {
    db.exec(`DROP TABLE IF EXISTS patients`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referralId TEXT NOT NULL UNIQUE,
      referralReferenceId TEXT,
      navigationId TEXT,
      patientName TEXT NOT NULL,
      patientNationalId TEXT,
      referralDate TEXT,                  -- the real referral-creation date from facility/tabs' createdAt field (renamed here to avoid clashing with the row-bookkeeping createdAt column below)
      referralType TEXT,
      referralReason TEXT,
      providerRegion TEXT,
      broadcastedAt TEXT,
      referralStartDate TEXT,
      referralEndDate TEXT,
      referralEndTimestamp INTEGER,
      facilityReviewWindowMinutes INTEGER,
      acceptanceWindowMinutes INTEGER,
      extendScopeWindowMinutes INTEGER,
      letterType TEXT,
      transferUrl TEXT,
      userActionName TEXT,                -- accept, reject, '' (current action)
      providerAction TEXT,                -- narrative history, e.g. "accepted then cancelled"
      claimed TEXT,                       -- yes/no, NULL until an action is taken or checkReferralSelectedStatus resolves it
      status TEXT,                        -- portal-reported status string, NULL until known
      isSent TEXT,                        -- yes/no
      isReceived TEXT,                    -- yes/no
      scheduledAt INTEGER,
      tabName TEXT DEFAULT '',
      paid INTEGER DEFAULT 0,             -- 0 = false, 1 = true
      payerAction TEXT,                   -- confirmed or dropped
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT
    )
  `);

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_paid ON patients(paid)`).run();

  // Incremental migration for columns added after the table already existed
  // on disk - CREATE TABLE IF NOT EXISTS above is a no-op once the table is
  // there, so newly added columns need to be patched in explicitly rather
  // than requiring a full drop/rebuild (that's reserved for genuinely
  // incompatible old shapes, like the legacy rowKey table above).
  const patientsColumnNames = db
    .prepare(`PRAGMA table_info(patients)`)
    .all()
    .map((column) => column.name);

  const columnsToEnsure = {
    facilityReviewWindowMinutes: "INTEGER",
    acceptanceWindowMinutes: "INTEGER",
    extendScopeWindowMinutes: "INTEGER",
    referralDate: "TEXT",
  };

  for (const [columnName, columnType] of Object.entries(columnsToEnsure)) {
    if (!patientsColumnNames.includes(columnName)) {
      db.exec(`ALTER TABLE patients ADD COLUMN ${columnName} ${columnType}`);
    }
  }
})();

/**
 * Helpers
 */

const getPatientStatement = db.prepare(
  `SELECT * FROM patients WHERE referralId = ?`,
);

const toDbRow = (oldRow, patient) => {
  const merged = { ...(oldRow || {}), ...(patient || {}) };

  return {
    referralId: merged.referralId != null ? String(merged.referralId) : null,
    referralReferenceId: merged.referralReferenceId ?? null,
    navigationId: merged.navigationId ?? null,
    patientName: merged.patientName ?? null,
    patientNationalId: merged.patientNationalId ?? null,
    // The real referral-creation date, as returned by facility/tabs under
    // the name `createdAt` (see processCollectingPatients.mjs ->
    // finalData.createdAt) - stored under a different column name here
    // (referralDate) so it doesn't collide with this table's own
    // `createdAt` column, which is separate row-insertion bookkeeping
    // (DEFAULT datetime('now')), not the referral's actual date. Preferred
    // over the old row's stored value (patient.createdAt is the latest
    // fetch from the API each time), but falls back to whatever was
    // already there if a given call site doesn't provide it, so it's never
    // wiped out by an update.
    referralDate: oldRow?.createdAt ?? oldRow?.referralDate ?? null,
    referralType: merged.referralType ?? null,
    referralReason: merged.referralReason ?? null,
    providerRegion: merged.providerRegion ?? null,
    broadcastedAt: merged.broadcastedAt ?? null,
    referralStartDate: merged.referralStartDate ?? null,
    referralEndDate: merged.referralEndDate ?? null,
    referralEndTimestamp: merged.referralEndTimestamp ?? null,
    facilityReviewWindowMinutes: merged.facilityReviewWindowMinutes ?? null,
    acceptanceWindowMinutes: merged.acceptanceWindowMinutes ?? null,
    extendScopeWindowMinutes: merged.extendScopeWindowMinutes ?? null,
    letterType: merged.letterType ?? null,
    transferUrl: merged.transferUrl ?? null,
    userActionName: merged.userActionName ?? null,
    providerAction: merged.providerAction ?? null,
    claimed: merged.claimed ?? null,
    status: merged.status ?? null,
    isSent: merged.isSent ?? null,
    isReceived: merged.isReceived ?? null,
    scheduledAt: merged.scheduledAt ?? null,
    tabName: merged.tabName ?? "",
    paid: merged.paid ? 1 : 0,
    payerAction: merged.payerAction ?? null,
  };
};

const insertPatientSQL = `
  INSERT INTO patients (
    referralId,
    referralReferenceId,
    navigationId,
    patientName,
    patientNationalId,
    referralDate,
    referralType,
    referralReason,
    providerRegion,
    broadcastedAt,
    referralStartDate,
    referralEndDate,
    referralEndTimestamp,
    facilityReviewWindowMinutes,
    acceptanceWindowMinutes,
    extendScopeWindowMinutes,
    letterType,
    transferUrl,
    userActionName,
    providerAction,
    claimed,
    status,
    isSent,
    isReceived,
    scheduledAt,
    tabName,
    paid,
    payerAction,
    updatedAt
  ) VALUES (
    @referralId,
    @referralReferenceId,
    @navigationId,
    @patientName,
    @patientNationalId,
    @referralDate,
    @referralType,
    @referralReason,
    @providerRegion,
    @broadcastedAt,
    @referralStartDate,
    @referralEndDate,
    @referralEndTimestamp,
    @facilityReviewWindowMinutes,
    @acceptanceWindowMinutes,
    @extendScopeWindowMinutes,
    @letterType,
    @transferUrl,
    @userActionName,
    @providerAction,
    @claimed,
    @status,
    @isSent,
    @isReceived,
    @scheduledAt,
    @tabName,
    @paid,
    @payerAction,
    datetime('now')
  )
  ON CONFLICT(referralId) DO UPDATE SET
    referralReferenceId  = COALESCE(excluded.referralReferenceId, referralReferenceId),
    navigationId          = COALESCE(excluded.navigationId, navigationId),
    patientName           = COALESCE(excluded.patientName, patientName),
    patientNationalId     = COALESCE(excluded.patientNationalId, patientNationalId),
    referralDate          = COALESCE(excluded.referralDate, referralDate),
    referralType          = COALESCE(excluded.referralType, referralType),
    referralReason        = COALESCE(excluded.referralReason, referralReason),
    providerRegion        = COALESCE(excluded.providerRegion, providerRegion),
    broadcastedAt         = COALESCE(excluded.broadcastedAt, broadcastedAt),
    referralStartDate     = COALESCE(excluded.referralStartDate, referralStartDate),
    referralEndDate       = COALESCE(excluded.referralEndDate, referralEndDate),
    referralEndTimestamp  = COALESCE(excluded.referralEndTimestamp, referralEndTimestamp),
    facilityReviewWindowMinutes = COALESCE(excluded.facilityReviewWindowMinutes, facilityReviewWindowMinutes),
    acceptanceWindowMinutes     = COALESCE(excluded.acceptanceWindowMinutes, acceptanceWindowMinutes),
    extendScopeWindowMinutes    = COALESCE(excluded.extendScopeWindowMinutes, extendScopeWindowMinutes),
    letterType            = COALESCE(excluded.letterType, letterType),
    transferUrl           = COALESCE(excluded.transferUrl, transferUrl),
    userActionName        = COALESCE(excluded.userActionName, userActionName),
    providerAction        = COALESCE(excluded.providerAction, providerAction),
    claimed               = COALESCE(excluded.claimed, claimed),
    status                = COALESCE(excluded.status, status),
    isSent                = COALESCE(excluded.isSent, isSent),
    isReceived            = COALESCE(excluded.isReceived, isReceived),
    scheduledAt           = COALESCE(excluded.scheduledAt, scheduledAt),
    tabName               = COALESCE(excluded.tabName, tabName),
    paid                  = COALESCE(excluded.paid, paid),
    payerAction           = COALESCE(excluded.payerAction, payerAction),
    updatedAt             = datetime('now')
`;

const updatePatientSQL = `
  UPDATE patients SET
    referralReferenceId = @referralReferenceId,
    navigationId = @navigationId,
    patientName = @patientName,
    patientNationalId = @patientNationalId,
    referralDate = @referralDate,
    referralType = @referralType,
    referralReason = @referralReason,
    providerRegion = @providerRegion,
    broadcastedAt = @broadcastedAt,
    referralStartDate = @referralStartDate,
    referralEndDate = @referralEndDate,
    referralEndTimestamp = @referralEndTimestamp,
    facilityReviewWindowMinutes = @facilityReviewWindowMinutes,
    acceptanceWindowMinutes = @acceptanceWindowMinutes,
    extendScopeWindowMinutes = @extendScopeWindowMinutes,
    letterType = @letterType,
    transferUrl = @transferUrl,
    userActionName = @userActionName,
    providerAction = @providerAction,
    claimed = @claimed,
    status = @status,
    isSent = @isSent,
    isReceived = @isReceived,
    scheduledAt = @scheduledAt,
    tabName = @tabName,
    paid = @paid,
    payerAction = @payerAction,
    updatedAt = datetime('now')
  WHERE referralId = @referralId
`;

const deletePatientSQL = `DELETE FROM patients WHERE referralId = ?`;
const allPatientsSQL = `SELECT * FROM patients`;

const allPatientsStatement = db.prepare(allPatientsSQL);
const insertStatement = db.prepare(insertPatientSQL);
const updateStatement = db.prepare(updatePatientSQL);
const deleteStatement = db.prepare(deletePatientSQL);

const processInsertionOrUpdateOnRecord = (patient, sqlStatement, isUpdate) => {
  if (!patient) return null;

  let oldRow = null;
  if (isUpdate && patient.referralId) {
    oldRow = getPatientStatement.get(String(patient.referralId)) || null;
  }

  const dbRow = toDbRow(oldRow, patient);

  // Minimal sanity checks for NOT NULL columns
  if (!dbRow.referralId || !dbRow.patientName) {
    throw new Error(
      `Missing required patient fields. referralId=${dbRow.referralId}, patientName=${dbRow.patientName}`,
    );
  }

  return sqlStatement.run(dbRow);
};

/**
 * Public API (insert / update / delete)
 */

const insertPatients = (oneOrMorePatients) => {
  const patients = (
    Array.isArray(oneOrMorePatients) ? oneOrMorePatients : [oneOrMorePatients]
  ).filter(Boolean);
  if (!patients.length) return;

  if (patients.length === 1) {
    return processInsertionOrUpdateOnRecord(
      patients[0],
      insertStatement,
      false,
    );
  }

  const trx = db.transaction((items) =>
    items.map((p) =>
      processInsertionOrUpdateOnRecord(p, insertStatement, false),
    ),
  );
  return trx(patients);
};

const updatePatients = (oneOrMorePatients) => {
  const patients = (
    Array.isArray(oneOrMorePatients) ? oneOrMorePatients : [oneOrMorePatients]
  ).filter(Boolean);
  if (!patients.length) return;

  if (patients.length === 1) {
    return processInsertionOrUpdateOnRecord(patients[0], updateStatement, true);
  }

  const trx = db.transaction((items) =>
    items.map((p) =>
      processInsertionOrUpdateOnRecord(p, updateStatement, true),
    ),
  );
  return trx(patients);
};

const deletePatients = (referralIds) => {
  const ids = (Array.isArray(referralIds) ? referralIds : [referralIds]).filter(
    Boolean,
  );
  if (!ids.length) return;

  if (ids.length === 1) {
    return deleteStatement.run(String(ids[0]));
  }

  const trx = db.transaction((items) =>
    items.map((id) => deleteStatement.run(String(id))),
  );
  return trx(ids);
};

const getPatient = (referralId) =>
  getPatientStatement.get(String(referralId)) || null;

const getOldestPatient = () =>
  db.prepare(`SELECT * FROM patients ORDER BY id ASC LIMIT 1`).get() || null;

const getCasesWithEmptyClaimStatusStatement = db.prepare(
  `SELECT * FROM patients WHERE claimed IS NULL`,
);

const getCasesWithEmptyClaimStatus = () =>
  getCasesWithEmptyClaimStatusStatement.all();

// Column allowlist for the /db admin page filters - kept explicit (rather
// than accepting arbitrary column names from the request) since these
// build into raw SQL clause text below, not just bound parameter values.
const FILTERABLE_LIKE_COLUMNS = [
  "referralId",
  "patientNationalId",
  "navigationId",
];

/**
 * @param {object} [filters]
 * @param {string} [filters.referralId] - Partial match.
 * @param {string} [filters.patientNationalId] - Partial match.
 * @param {string} [filters.navigationId] - Partial match.
 * @param {string} [filters.status] - Exact match.
 * @param {string} [filters.referralDate] - "YYYY-MM-DD" - matches that
 *   whole calendar day (prefix match). This is the real referral-creation
 *   date from facility/tabs' `createdAt` field, stored under the
 *   `referralDate` column (see toDbRow above) - distinct from this table's
 *   own `createdAt` column, which is just row-insertion bookkeeping.
 * @param {string} [filters.paid] - "1" (Yes) or "0" (No). Exact match.
 * @param {number} [filters.limit=500] - Clamped to [1, 2000].
 * @returns {object[]}
 */
const getPatientsFiltered = ({
  referralId,
  patientNationalId,
  navigationId,
  status,
  referralDate,
  paid,
  limit = 500,
} = {}) => {
  const values = { referralId, patientNationalId, navigationId };
  const clauses = [];
  const params = {};

  for (const column of FILTERABLE_LIKE_COLUMNS) {
    const value = values[column];
    if (value) {
      clauses.push(`${column} LIKE @${column}`);
      params[column] = `%${value}%`;
    }
  }

  if (status) {
    // The status column holds WASLA_STATUS_TYPES numeric codes, but a
    // plain JS number bound through better-sqlite3 can land in the TEXT
    // column as e.g. "1.0" rather than "1" (confirmed live) - comparing as
    // numbers rather than exact strings works regardless of that
    // formatting, and regardless of whatever a given row's existing
    // representation already is.
    clauses.push(`CAST(status AS REAL) = CAST(@status AS REAL)`);
    params.status = status;
  }

  if (referralDate) {
    clauses.push(`referralDate LIKE @referralDate`);
    params.referralDate = `${referralDate}%`;
  }

  // paid is a real 0/No value, not "unset" - can't use a plain truthy
  // check here or the "No" filter would silently do nothing.
  if (paid !== undefined && paid !== null && paid !== "") {
    clauses.push(`paid = @paid`);
    params.paid = Number(paid) ? 1 : 0;
  }

  const whereSQL = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.limit = Math.min(Math.max(Number(limit) || 500, 1), 2000);

  const stmt = db.prepare(
    `SELECT * FROM patients ${whereSQL} ORDER BY id DESC LIMIT @limit`,
  );
  return stmt.all(params);
};

const upsertCaseFile = (referralId, action, tgFileId) => {
  const stmt = casesLettersDb.prepare(`
    INSERT INTO casesFilesDb (
      referralId,
      date,
      action,
      tgFileId
    )
    VALUES (
      @referralId,
      @date,
      @action,
      @tgFileId
    )
    ON CONFLICT(referralId)
    DO UPDATE SET
      date = excluded.date,
      action = excluded.action,
      tgFileId = excluded.tgFileId
  `);

  return stmt.run({
    referralId: String(referralId),
    date: Date.now(),
    action: String(action),
    tgFileId: String(tgFileId),
  });
};

const getCaseFile = (referralId) => {
  const stmt = casesLettersDb.prepare(`
    SELECT *
    FROM casesFilesDb
    WHERE referralId = ?
  `);

  return stmt.get(String(referralId));
};

const deleteOldCaseFiles = () => {
  const now = new Date();

  // Start of yesterday (local time)
  const startOfYesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    0,
    0,
    0,
    0,
  ).getTime();

  const stmt = casesLettersDb.prepare(`
    DELETE FROM casesFilesDb
    WHERE date < ?
  `);

  return stmt.run(startOfYesterday);
};

export {
  db,
  allPatientsStatement,
  insertPatients,
  updatePatients,
  deletePatients,
  getPatient,
  getCasesWithEmptyClaimStatus,
  getPatientsFiltered,
  getOldestPatient,
  upsertCaseFile,
  getCaseFile,
  deleteOldCaseFiles,
};

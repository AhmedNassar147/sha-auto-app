/*
 * File to handle db
 */
import Database from "better-sqlite3";

const patientsDbFilePath = `${process.cwd()}/patients.db`;
const weeklyHistoryFilePath = `${process.cwd()}/patientsWeeklyHistory.db`;
const casesLettersFilePath = `${process.cwd()}/casesLetters.db`;

const db = new Database(patientsDbFilePath);
const weeklyHistoryDb = new Database(weeklyHistoryFilePath);
const casesLettersDb = new Database(casesLettersFilePath);

// Optional but generally sensible for SQLite apps
// db.pragma("journal_mode = WAL");
// weeklyHistoryDb.pragma("journal_mode = WAL");

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

  [db, weeklyHistoryDb].forEach((database) => {
    database
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS patients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rowKey TEXT NOT NULL UNIQUE,        -- referralId-nationalId
          referralDate TEXT NOT NULL,
          referralId TEXT NOT NULL,
          referenceId TEXT DEFAULT '',
          patientName TEXT NOT NULL,
          nationalId TEXT NOT NULL,
          referralType TEXT,
          referralReason TEXT,
          sourceZone TEXT,
          provider TEXT,
          isSent TEXT,                        -- yes/no (kept as TEXT per your original)
          isReceived TEXT,                    -- yes/no (kept as TEXT per your original)
          providerAction TEXT,                -- Accept, Reject, no reply, late reply
          payerAction TEXT,             -- confirmed or dropped
          isAdmitted TEXT,                    -- yes/no
          isConfirmed TEXT,                    -- yes/no
          isRejected TEXT,                    -- yes/no
          tabName TEXT DEFAULT '',
          paid INTEGER DEFAULT 0,             -- 0 = false, 1 = true
          createdAt TEXT DEFAULT (datetime('now')),
          updatedAt TEXT
        )
      `,
      )
      .run();

    // Indexes
    database
      .prepare(`CREATE INDEX IF NOT EXISTS idx_rowKey ON patients(rowKey)`)
      .run();
    database
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_referralId ON patients(referralId)`,
      )
      .run();
    database
      .prepare(`CREATE INDEX IF NOT EXISTS idx_paid ON patients(paid)`)
      .run();
  });
})();

/**
 * Helpers
 */

// Build a rowKey from either API-shaped or DB-shaped objects
const createPatientRowKey = (patient) => {
  if (!patient) return "";

  if (patient.rowKey) return String(patient.rowKey);

  const referralId = patient.idReferral ?? patient.referralId ?? "";
  const nationalId =
    patient.adherentNationalId ??
    patient.nationalId ??
    patient.adherentId ??
    "";

  return `${referralId}-${nationalId}`;
};

const getPatientStatement = (database) =>
  database.prepare(`SELECT * FROM patients WHERE rowKey = ?`);

const toDbRow = (oldRow, patient) => {
  // Merge while supporting BOTH naming styles:
  // - API: idReferral, ihalatyReference, adherentName, adherentNationalId, sourceProvider, assignedProvider
  // - DB:  referralId, referenceId, patientName, nationalId, provider
  const merged = { ...(oldRow || {}), ...(patient || {}) };

  const referralId = merged.idReferral ?? merged.referralId;
  const referenceId = merged.ihalatyReference ?? merged.referenceId ?? 0;
  const nationalId =
    merged.adherentNationalId ?? merged.nationalId ?? merged.adherentId;

  const rowKey = merged.rowKey ?? `${referralId}-${nationalId}`;

  return {
    rowKey,
    referralDate: merged.referralDate,
    referralId,
    referenceId,
    patientName: merged.adherentName ?? merged.patientName,
    nationalId,
    referralType: merged.referralType ?? null,
    referralReason: merged.referralReason ?? null,
    sourceZone: merged.sourceZone ?? null,
    provider:
      merged.sourceProvider ??
      merged.assignedProvider ??
      merged.provider ??
      null,
    tabName: merged.tabName ?? "",
    paid: merged.paid ? 1 : 0,
    isSent: merged.isSent ?? null,
    isReceived: merged.isReceived ?? null,
    providerAction: merged.providerAction ?? null,
    payerAction: merged.payerAction ?? null,
    isAdmitted: merged.isAdmitted ?? null,
    isRejected: merged.isRejected ?? null,
    isConfirmed: merged.isConfirmed ?? null,
  };
};

const insertPatientSQL = `
  INSERT INTO patients (
    rowKey,
    referralDate,
    referralId,
    referenceId,
    patientName,
    nationalId,
    referralType,
    referralReason,
    sourceZone,
    provider,
    tabName,
    paid,
    isSent,
    isReceived,
    providerAction,
    payerAction,
    isAdmitted,
    isConfirmed,
    isRejected,
    updatedAt
  ) VALUES (
    @rowKey,
    @referralDate,
    @referralId,
    @referenceId,
    @patientName,
    @nationalId,
    @referralType,
    @referralReason,
    @sourceZone,
    @provider,
    @tabName,
    @paid,
    @isSent,
    @isReceived,
    @providerAction,
    @payerAction,
    @isAdmitted,
    @isConfirmed,
    @isRejected,
    datetime('now')
  )
  ON CONFLICT(rowKey) DO UPDATE SET
    referralDate      = COALESCE(excluded.referralDate, referralDate),
    referralId        = COALESCE(excluded.referralId, referralId),
    referenceId       = COALESCE(excluded.referenceId, referenceId),
    patientName       = COALESCE(excluded.patientName, patientName),
    nationalId        = COALESCE(excluded.nationalId, nationalId),
    referralType      = COALESCE(excluded.referralType, referralType),
    referralReason    = COALESCE(excluded.referralReason, referralReason),
    sourceZone        = COALESCE(excluded.sourceZone, sourceZone),
    provider          = COALESCE(excluded.provider, provider),
    tabName           = COALESCE(excluded.tabName, tabName),
    paid              = COALESCE(excluded.paid, paid),
    isSent            = COALESCE(excluded.isSent, isSent),
    isReceived        = COALESCE(excluded.isReceived, isReceived),
    providerAction    = COALESCE(excluded.providerAction, providerAction),
    payerAction       = COALESCE(excluded.payerAction, payerAction),
    isAdmitted        = COALESCE(excluded.isAdmitted, isAdmitted),
    isConfirmed       = COALESCE(excluded.isConfirmed, isConfirmed),
    isRejected        = COALESCE(excluded.isRejected, isRejected),
    updatedAt         = datetime('now')
`;

const updatePatientSQL = `
  UPDATE patients SET
    referralDate = @referralDate,
    referralId = @referralId,
    referenceId = @referenceId,
    patientName = @patientName,
    nationalId = @nationalId,
    referralType = @referralType,
    referralReason = @referralReason,
    sourceZone = @sourceZone,
    provider = @provider,
    tabName = @tabName,
    paid = @paid,
    isSent = @isSent,
    isReceived = @isReceived,
    providerAction = @providerAction,
    payerAction = @payerAction,
    isAdmitted = @isAdmitted,
    isConfirmed = @isConfirmed,
    isRejected = @isRejected,
    updatedAt = datetime('now')
  WHERE rowKey = @rowKey
`;

const deletePatientSQL = `DELETE FROM patients WHERE rowKey = ?`;
const allPatientsSQL = `SELECT * FROM patients`;

const ensureColumn = (database, table, colName, colDef) => {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  const has = cols.some((c) => c.name === colName);
  if (!has) {
    database
      .prepare(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`)
      .run();
  }
};

const migratePatientsTable = (database) => {
  ensureColumn(database, "patients", "isSent", "TEXT");
  ensureColumn(database, "patients", "isReceived", "TEXT");
  ensureColumn(database, "patients", "providerAction", "TEXT");
  ensureColumn(database, "patients", "payerAction", "TEXT");
  ensureColumn(database, "patients", "isAdmitted", "TEXT");
  ensureColumn(database, "patients", "isRejected", "TEXT");
  ensureColumn(database, "patients", "isConfirmed", "TEXT");
};

migratePatientsTable(db);
migratePatientsTable(weeklyHistoryDb);

const allPatientsStatement = db.prepare(allPatientsSQL);
const insertStatement = db.prepare(insertPatientSQL);
const updateStatement = db.prepare(updatePatientSQL);
const deleteStatement = db.prepare(deletePatientSQL);

const allWeeklyPatientsStatement = weeklyHistoryDb.prepare(allPatientsSQL);
const insertWeeklyStatement = weeklyHistoryDb.prepare(insertPatientSQL);
const updateWeeklyStatement = weeklyHistoryDb.prepare(updatePatientSQL);
const deleteWeeklyStatement = weeklyHistoryDb.prepare(deletePatientSQL);

const processInsertionOrUpdateOnRecord = (
  database,
  patient,
  sqlStatement,
  isUpdate,
) => {
  if (!patient) return null;

  let oldRow = null;
  if (isUpdate) {
    const rowKey = createPatientRowKey(patient);
    if (rowKey) oldRow = getPatientStatement(database).get(rowKey) || null;
  }

  const dbRow = toDbRow(oldRow, patient);

  // Minimal sanity checks for NOT NULL columns
  if (
    !dbRow.rowKey ||
    !dbRow.referralDate ||
    !dbRow.referralId ||
    !dbRow.patientName ||
    !dbRow.nationalId
  ) {
    throw new Error(
      `Missing required patient fields. rowKey=${dbRow.rowKey}, referralDate=${dbRow.referralDate}, referralId=${dbRow.referralId}, patientName=${dbRow.patientName}, nationalId=${dbRow.nationalId}`,
    );
  }

  return sqlStatement.run(dbRow);
};

/**
 * Public API (insert / update / delete)
 */

const __insertPatients = (database, insertStatement) => (oneOrMorePatients) => {
  const patients = (
    Array.isArray(oneOrMorePatients) ? oneOrMorePatients : [oneOrMorePatients]
  ).filter(Boolean);
  if (!patients.length) return;

  if (patients.length === 1) {
    return processInsertionOrUpdateOnRecord(
      database,
      patients[0],
      insertStatement,
      false,
    );
  }

  const trx = database.transaction((items) =>
    items.map((p) =>
      processInsertionOrUpdateOnRecord(database, p, insertStatement, false),
    ),
  );
  return trx(patients);
};

const __updatePatients = (database, updateStatement) => (oneOrMorePatients) => {
  const patients = (
    Array.isArray(oneOrMorePatients) ? oneOrMorePatients : [oneOrMorePatients]
  ).filter(Boolean);
  if (!patients.length) return;

  if (patients.length === 1) {
    return processInsertionOrUpdateOnRecord(
      database,
      patients[0],
      updateStatement,
      true,
    );
  }

  const trx = database.transaction((items) =>
    items.map((p) =>
      processInsertionOrUpdateOnRecord(database, p, updateStatement, true),
    ),
  );
  return trx(patients);
};

const __deletePatients = (database, deleteStatement) => (patientIds) => {
  const ids = (Array.isArray(patientIds) ? patientIds : [patientIds]).filter(
    Boolean,
  );
  if (!ids.length) return;

  if (ids.length === 1) {
    return deleteStatement.run(ids[0]);
  }

  const trx = database.transaction((items) =>
    items.map((id) => deleteStatement.run(id)),
  );
  return trx(ids);
};

const insertPatients = __insertPatients(db, insertStatement);
const updatePatients = __updatePatients(db, updateStatement);
const deletePatients = __deletePatients(db, deleteStatement);

const insertWeeklyHistoryPatients = __insertPatients(
  weeklyHistoryDb,
  insertWeeklyStatement,
);
const updateWeeklyHistoryPatients = __updatePatients(
  weeklyHistoryDb,
  updateWeeklyStatement,
);
const deleteWeeklyHistoryPatients = __deletePatients(
  weeklyHistoryDb,
  deleteWeeklyStatement,
);
const getWeeklyHistoryPatient = (rowKey) =>
  getPatientStatement(weeklyHistoryDb).get(rowKey) || null;

const getOldestPatient = () =>
  db.prepare(`SELECT * FROM patients ORDER BY id ASC LIMIT 1`).get() || null;

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
  createPatientRowKey,
  db,
  allPatientsStatement,
  insertPatients,
  updatePatients,
  deletePatients,
  weeklyHistoryDb,
  allWeeklyPatientsStatement,
  insertWeeklyHistoryPatients,
  updateWeeklyHistoryPatients,
  deleteWeeklyHistoryPatients,
  toDbRow,
  getWeeklyHistoryPatient,
  getOldestPatient,
  upsertCaseFile,
  getCaseFile,
  deleteOldCaseFiles,
};

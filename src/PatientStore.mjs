/*
 *
 * Patients Store
 *
 */
import EventEmitter from "events";
import { join } from "path";
import { unlink } from "fs/promises";
import checkPathExists from "./checkPathExists.mjs";
import writePatientData from "./writePatientData.mjs";
import unlinkAllFastGlob from "./unlinkAllFastGlob.mjs";
import waitMinutesThenRun from "./waitMinutesThenRun.mjs";
import createConsoleMessage from "./createConsoleMessage.mjs";
import {
  COLLECTD_PATIENTS_FILE_NAME,
  USER_MESSAGES,
  USER_ACTION_TYPES,
  searchIfAcceptacneButtonShownMS,
  cutoffTimeMs,
  generatedPdfsPathForAcceptance,
  generatedPdfsPathForRejection,
  FAKE_REJECT_PROBE,
} from "./constants.mjs";
import { getPatient, insertPatients, updatePatients } from "./db.mjs";

async function safeWritePatientData(data, retries = 3, delay = 200) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await writePatientData(
        [...(data || [])].reverse(),
        COLLECTD_PATIENTS_FILE_NAME,
      );
      return;
    } catch (err) {
      if (attempt === retries) {
        createConsoleMessage(
          "error",
          err,
          "❌ Failed to write patient data after retries:",
        );
      }
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

class PatientStore extends EventEmitter {
  constructor(initialPatients = [], nonClaimableCases = []) {
    super();
    this.patientsById = new Map();
    this.goingPatientsToBeAccepted = new Set();
    this.goingPatientsToBeRejected = new Set();
    this.patientTimers = new Map();
    this.cachedPatientsArray = null;
    this.lastActionablePatient = null;
    this.sendTelegramMessage = null;
    this.patientProbeTimers = new Map();

    this.nonClaimableCases = new Map(
      nonClaimableCases.map(({ referralId, referralEndTimestamp }) => [
        String(referralId),
        referralEndTimestamp,
      ]),
    );

    for (const patient of initialPatients) {
      if (!patient) continue;
      const key = this.keyExtractor(patient);
      if (!key) continue;
      const { userActionName } = patient;

      const isActionableCase = [
        USER_ACTION_TYPES.ACCEPT,
        USER_ACTION_TYPES.REJECT,
      ].includes(userActionName);

      const canProcess = this.calculateCanStillProcessPatient(patient);

      if (isActionableCase && !canProcess) {
        this.lastActionablePatient = patient;
      }

      this.patientsById.set(key, patient);
    }
  }

  setTelegramMessageSender(sender) {
    this.sendTelegramMessage = sender;
  }

  keyExtractor(patient = {}) {
    const id = patient.referralId;
    return typeof id === "string" && id.trim() !== "" ? id : null;
  }

  invalidateCache() {
    this.cachedPatientsArray = null;
  }

  getAllPatients() {
    if (!this.cachedPatientsArray) {
      this.cachedPatientsArray = Array.from(this.patientsById.values());
    }
    return this.cachedPatientsArray;
  }

  async addPatients(patients) {
    const newPatients = Array.isArray(patients) ? patients : [patients];
    const added = [];

    for (const patient of newPatients) {
      const key = this.keyExtractor(patient);
      if (key && !this.patientsById.has(key)) {
        const { files, ...patientData } = patient;
        this.patientsById.set(key, patientData);
        added.push({ ...patient, paid: 0 });
      }
    }

    if (added.length) {
      this.invalidateCache();
      insertPatients(added);
      this.emit("patientsAdded", added);
      await safeWritePatientData(this.getAllPatients());
    }
  }

  async scheduleAllInitialPatients() {
    const allPatients = this.getAllPatients();

    if (!allPatients.length) {
      return;
    }

    for (const patient of allPatients) {
      const key = this.keyExtractor(patient);
      if (!key) continue;

      const { userActionName, probePending } = patient;

      const canProcess = this.calculateCanStillProcessPatient(patient);

      if (!canProcess) continue;

      const isAccept = userActionName === USER_ACTION_TYPES.ACCEPT;
      const isReject = userActionName === USER_ACTION_TYPES.REJECT;

      if (isAccept || isReject) {
        const { message } = await this.schedulePatientAction({
          actionSet: isReject
            ? this.goingPatientsToBeRejected
            : this.goingPatientsToBeAccepted,
          eventName: isReject ? "patientRejected" : "patientAccepted",
          patient,
          skipResetingPatient: true,
          isSuperAcceptance: patient.isSuperAcceptance,
        });
        createConsoleMessage(
          "info",
          `Called From Initial Schedule: ${message}`,
        );

        continue;
      }

      if (probePending) {
        const { message } = await this.scheduleFakeRejectProbe(
          patient.referralId,
          true,
        );
        createConsoleMessage(
          "info",
          `Called From Initial Probe Schedule: ${message}`,
        );
        continue;
      }
    }
  }

  getPatientByReferralId(referralId) {
    return this.patientsById.get(referralId);
  }

  async removePatientByReferralId(referralId) {
    const patient = this.patientsById.get(referralId);
    if (!patient) {
      return { success: false, message: USER_MESSAGES.notFound };
    }

    this.patientsById.delete(referralId);
    this.invalidateCache();

    const timer = this.patientTimers.get(referralId);
    if (timer) {
      timer.cancel();
      this.patientTimers.delete(referralId);
    }

    this.goingPatientsToBeAccepted.delete(referralId);
    this.goingPatientsToBeRejected.delete(referralId);

    const probeTimer = this.patientProbeTimers.get(referralId);
    if (probeTimer) {
      probeTimer.cancel();
      this.patientProbeTimers.delete(referralId);
    }

    await safeWritePatientData(this.getAllPatients());

    try {
      const acceptanceFilePath = join(
        generatedPdfsPathForAcceptance,
        `${USER_ACTION_TYPES.ACCEPT}-${referralId}.pdf`,
      );

      const rejectionFilePath = join(
        generatedPdfsPathForRejection,
        `${USER_ACTION_TYPES.REJECT}-${referralId}.pdf`,
      );

      await Promise.allSettled([
        checkPathExists(acceptanceFilePath).then(
          (exists) => exists && unlink(acceptanceFilePath),
        ),
        checkPathExists(rejectionFilePath).then(
          (exists) => exists && unlink(rejectionFilePath),
        ),
      ]);
    } catch (error) {
      return {
        success: false,
        message: `🛑 Failed to remove Patient with referralId=${referralId}. error: ${
          error?.message || error
        }`,
      };
    }

    return {
      success: true,
      message: `✅ Just removed Patient with referralId=${referralId}.`,
    };
  }

  findPatientByReferralId(referralId) {
    const patient = this.getPatientByReferralId(referralId);
    return { patient, message: patient ? undefined : USER_MESSAGES.notFound };
  }

  calculateCanStillProcessPatient(patient) {
    const { referralEndDateActionableAtMS } = patient;

    if (
      typeof referralEndDateActionableAtMS !== "number" ||
      !referralEndDateActionableAtMS
    )
      return false;

    const now = Date.now();
    const lastTime =
      referralEndDateActionableAtMS +
      (cutoffTimeMs - searchIfAcceptacneButtonShownMS);

    return now < lastTime;
  }

  canStillProcessPatient(referralId) {
    const { patient, message } = this.findPatientByReferralId(referralId);
    if (message) {
      return { success: false, message };
    }

    const canProcess = this.calculateCanStillProcessPatient(patient);
    return {
      success: canProcess,
      message: canProcess ? USER_MESSAGES.canProcess : USER_MESSAGES.expired,
    };
  }

  async schedulePatientAction({
    actionSet,
    eventName,
    patient,
    scheduledAt,
    skipResetingPatient,
    isSuperAcceptance,
  }) {
    let currentPatient = patient;
    const { referralId, referralEndDateActionableAtMS } = currentPatient;
    const isAccepting = eventName === "patientAccepted";

    if (typeof referralEndDateActionableAtMS !== "number") {
      return {
        message: `Invalid = referralEndDateActionableAtMS date: ${referralEndDateActionableAtMS}`,
        success: false,
      };
    }

    const isAlreadyAccepting = this.goingPatientsToBeAccepted.has(referralId);
    const isAlreadyRejecting = this.goingPatientsToBeRejected.has(referralId);

    const isChangingAction =
      (isAccepting && isAlreadyRejecting) ||
      (!isAccepting && isAlreadyAccepting);

    if (isChangingAction) {
      const oldTimer = this.patientTimers.get(referralId);

      if (oldTimer) {
        oldTimer.cancel();
        this.patientTimers.delete(referralId);
      }

      this.goingPatientsToBeAccepted.delete(referralId);
      this.goingPatientsToBeRejected.delete(referralId);
    }

    if (actionSet.has(referralId) || this.patientTimers.has(referralId)) {
      return {
        success: false,
        message: isAccepting
          ? USER_MESSAGES.alreadyScheduledAccept
          : USER_MESSAGES.alreadyScheduledReject,
      };
    }

    const probeTimer = this.patientProbeTimers.get(referralId);

    if (probeTimer) {
      probeTimer.cancel();
      this.patientProbeTimers.delete(referralId);
    }

    let didClearProbePending = false;

    if (currentPatient.probePending) {
      const updatedPatient = {
        ...currentPatient,
        probePending: false,
      };

      this.patientsById.set(referralId, updatedPatient);
      currentPatient = updatedPatient;
      didClearProbePending = true;
    }

    const timer = waitMinutesThenRun(
      referralId,
      referralEndDateActionableAtMS,
      () => {
        const patientForEvent = isAccepting
          ? { ...currentPatient, isSuperAcceptance }
          : currentPatient;

        this.lastActionablePatient = patientForEvent;
        actionSet.delete(referralId);
        this.patientTimers.delete(referralId);
        this.emit(eventName, patientForEvent);
      },
      typeof this.sendTelegramMessage === "function"
        ? this.sendTelegramMessage
        : null,
    );

    actionSet.add(referralId);
    this.patientTimers.set(referralId, timer);

    if (skipResetingPatient && didClearProbePending) {
      this.invalidateCache();
      await safeWritePatientData(this.getAllPatients());
    } else if (!skipResetingPatient) {
      const storedPatient = getPatient(referralId);

      const providerAction = [
        ...new Set(
          [
            storedPatient?.providerAction,
            isAccepting ? "accepted" : "rejected",
          ].filter(Boolean),
        ),
      ].join(" then ");

      const updatedPatient = {
        ...currentPatient,
        scheduledAt,
        isSuperAcceptance,
        providerAction,
        isReceived: "yes",
        isSent: "yes",
        claimed: null,
        userActionName: isAccepting
          ? USER_ACTION_TYPES.ACCEPT
          : USER_ACTION_TYPES.REJECT,
      };

      updatePatients(updatedPatient);

      this.patientsById.set(referralId, updatedPatient);
      this.invalidateCache();

      await safeWritePatientData(this.getAllPatients());
    }

    return {
      success: true,
      message: isAccepting
        ? USER_MESSAGES.scheduleAcceptSuccess
        : USER_MESSAGES.scheduleRejectSuccess,
    };
  }

  async scheduleAcceptedPatient(referralId, scheduledAt, isSuperAcceptance) {
    const { patient, message } = this.findPatientByReferralId(referralId);
    if (message) {
      return { success: false, message };
    }

    return await this.schedulePatientAction({
      actionSet: this.goingPatientsToBeAccepted,
      eventName: "patientAccepted",
      patient,
      scheduledAt,
      isSuperAcceptance,
    });
  }

  async scheduleRejectedPatient(referralId, scheduledAt) {
    const { patient, message } = this.findPatientByReferralId(referralId);
    if (message) {
      return { success: false, message };
    }

    return await this.schedulePatientAction({
      actionSet: this.goingPatientsToBeRejected,
      eventName: "patientRejected",
      patient,
      scheduledAt,
    });
  }

  async cancelPatient(referralId) {
    const isAccepted = this.goingPatientsToBeAccepted.has(referralId);
    const isRejected = this.goingPatientsToBeRejected.has(referralId);

    if (!isAccepted && !isRejected) {
      return { success: false, message: USER_MESSAGES.noAction };
    }

    const timer = this.patientTimers.get(referralId);
    if (timer) {
      timer.cancel();
      this.patientTimers.delete(referralId);
    }

    [this.goingPatientsToBeAccepted, this.goingPatientsToBeRejected].forEach(
      (set) => set.delete(referralId),
    );

    const { patient } = this.findPatientByReferralId(referralId);

    if (patient) {
      const updatedPatient = {
        ...patient,
        userActionName: "",
        probePending: true,
      };

      const actionNames = [
        ...new Set(
          [updatedPatient?.providerAction, "cancelled"].filter(Boolean),
        ),
      ].join(" then ");

      updatePatients({
        ...updatedPatient,
        isSent: "yes",
        isReceived: "yes",
        providerAction: actionNames,
        claimed: null,
      });
      this.patientsById.set(referralId, updatedPatient);
      this.invalidateCache();
      await safeWritePatientData(this.getAllPatients());

      const canProcess = this.calculateCanStillProcessPatient(updatedPatient);

      if (canProcess && !this.patientProbeTimers.has(referralId)) {
        await this.scheduleFakeRejectProbe(referralId, true);
      }
    }

    return { success: true, message: USER_MESSAGES.cancelSuccess };
  }

  async scheduleFakeRejectProbe(referralId, skipPersisting = false) {
    const { patient, message } = this.findPatientByReferralId(referralId);

    if (message) {
      return { success: false, message };
    }

    if (patient.userActionName) {
      return {
        success: false,
        message: `Fake reject probe skipped because userActionName=${patient.userActionName}`,
      };
    }

    const { referralEndDateActionableAtMS } = patient;

    if (typeof referralEndDateActionableAtMS !== "number") {
      return {
        success: false,
        message: `Invalid referralEndDateActionableAtMS: ${referralEndDateActionableAtMS}`,
      };
    }

    if (patient.probePending && this.patientProbeTimers.has(referralId)) {
      return {
        success: false,
        message: `Fake reject probe already scheduled for referralId=${referralId}`,
      };
    }

    const timer = waitMinutesThenRun(
      referralId,
      referralEndDateActionableAtMS,
      async () => {
        const latestPatient =
          this.getPatientByReferralId(referralId) || patient;

        const updatedPatient = {
          ...latestPatient,
          probePending: false,
        };

        this.patientProbeTimers.delete(referralId);
        this.patientsById.set(referralId, updatedPatient);
        this.invalidateCache();
        await safeWritePatientData(this.getAllPatients());

        this.emit(FAKE_REJECT_PROBE, updatedPatient);
      },
      typeof this.sendTelegramMessage === "function"
        ? this.sendTelegramMessage
        : null,
    );

    this.patientProbeTimers.set(referralId, timer);

    if (!skipPersisting) {
      const updatedPatient = {
        ...patient,
        probePending: true,
      };

      this.patientsById.set(referralId, updatedPatient);
      this.invalidateCache();
      await safeWritePatientData(this.getAllPatients());
    }

    return {
      success: true,
      message: `✅ Fake reject probe scheduled for referralId=${referralId}`,
    };
  }

  async updatePatient(referralId, updates) {
    try {
      const patient = this.patientsById.get(referralId);

      if (!patient) {
        return {
          success: false,
          message: `❌ Patient ${referralId} Not found for update`,
        };
      }

      const updatedPatient = { ...patient, ...updates };
      this.patientsById.set(referralId, updatedPatient);
      this.invalidateCache();

      await safeWritePatientData(this.getAllPatients());

      return {
        success: true,
        message: `✅ Patient ${referralId} updated.`,
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Patient ${referralId} not updated due to ${error?.message || error}.`,
      };
    }
  }

  getFirstGoingToAccept(skipExpired = false) {
    return this.getAllPatients()
      ?.filter((patient) => {
        const isApplicable =
          patient?.userActionName === "accept" &&
          Number.isFinite(patient?.referralEndTimestamp);

        if (isApplicable && skipExpired) {
          return patient.referralEndTimestamp > Date.now();
        }

        return isApplicable;
      })
      .reduce(
        (earliest, current) =>
          !earliest ||
          current.referralEndTimestamp < earliest.referralEndTimestamp
            ? current
            : earliest,
        undefined,
      );
  }

  getReferralLeftTime(referralId) {
    const { message, patient } = this.findPatientByReferralId(referralId);

    if (message) {
      return {
        message,
        timeMs: undefined,
      };
    }

    const leftMs = Math.max(patient.referralEndTimestamp - Date.now(), 0);

    const minutes = Math.floor(leftMs / 60000);
    const seconds = Math.floor((leftMs % 60000) / 1000);
    const milliseconds = leftMs % 1000;

    const formatted =
      `Left Time: ${minutes} minute(s), ` +
      `${seconds} second(s), and ` +
      `${String(milliseconds).padStart(3, "0")} ms`;

    return {
      message: formatted,
      timeMs: leftMs,
    };
  }

  has(referralId) {
    return this.patientsById.has(referralId);
  }

  size() {
    return this.patientsById.size;
  }

  addNonClaimableCase(referralId, referralEndTimestamp) {
    this.nonClaimableCases.set(String(referralId), referralEndTimestamp);
  }

  removeNonClaimableCase(referralId) {
    this.nonClaimableCases.delete(String(referralId));
  }

  getNonClaimableCasesSize() {
    return this.nonClaimableCases.size;
  }
  getAllNonClaimableCases() {
    return [...this.nonClaimableCases.entries()].map(
      ([referralId, referralEndTimestamp]) => ({
        referralId,
        referralEndTimestamp,
      }),
    );
  }

  async clear() {
    this.patientsById.clear();
    this.goingPatientsToBeAccepted.clear();
    this.goingPatientsToBeRejected.clear();
    this.patientTimers.forEach((timer) => timer.cancel());
    this.patientTimers.clear();
    this.patientProbeTimers.forEach((timer) => timer.cancel());
    this.patientProbeTimers.clear();
    this.invalidateCache();
    await Promise.allSettled([
      safeWritePatientData([]),
      unlinkAllFastGlob(generatedPdfsPathForAcceptance),
      unlinkAllFastGlob(generatedPdfsPathForRejection),
    ]);
  }

  getLastActionablePatient() {
    return this.lastActionablePatient;
  }

  setLastActionablePatient(patient) {
    this.lastActionablePatient = patient;
  }
  // cancelHomePageForceReload() {
  //   this.removeAllListeners("forceReloadHomePage");
  // }

  // hasReloadListener() {
  //   return this.listenerCount("forceReloadHomePage") > 0;
  // }

  // forceReloadHomePage() {
  //   this.emit("forceReloadHomePage", true);
  // }

  toJSON() {
    return {
      patients: this.getAllPatients(),
    };
  }

  static fromJSON(json) {
    return new PatientStore(json.patients || []);
  }
}

export default PatientStore;

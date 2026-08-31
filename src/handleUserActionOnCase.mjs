/*
 *
 * Helper: `handleUserActionOnCase`.
 *
 */
import createConsoleMessage from "./createConsoleMessage.mjs";
import { getPatient, updatePatients } from "./db.mjs";

const handleUserActionOnCase = async ({
  patientsStore,
  action,
  referralId,
  onOnlineAction,
  onAnotherAction,
  onAcceptOrRejectForFileUpload,
  skipTimeValidation,
}) => {
  if (!action || !referralId) {
    const _message = `❌ action=${action} or referralId=${referralId} not found`;
    createConsoleMessage("error", _message);

    return {
      success: false,
      message: _message,
    };
  }

  const isAccepted = action === "accept";
  const isRejected = action === "reject";
  const isCancelled = action === "cancel";
  const isNoReply = action === "noreply";
  const isOnlineAction = action === "online";
  const isLeftTimeAction = action === "lefttime";

  const isSupportedAction =
    isAccepted ||
    isRejected ||
    isCancelled ||
    isNoReply ||
    isOnlineAction ||
    isLeftTimeAction;

  if (!isSupportedAction) {
    const _message = `❌ Unsupported referralId=${referralId} action=${action}`;

    createConsoleMessage("error", _message);

    return {
      success: false,
      message: _message,
    };
  }

  if (isOnlineAction) {
    await onOnlineAction?.();
    return {
      success: true,
      isOnlineAction,
      skipMessage: true,
      message: "Online Action Confirmed",
    };
  }

  const { patient } = patientsStore.findPatientByReferralId(referralId) || {};

  if (!patient) {
    const _message = `❌ Patient not found for referralId=${referralId}`;
    createConsoleMessage("info", _message);
    return {
      success: false,
      message: _message,
    };
  }

  const storedPatient = getPatient(referralId);

  const isAnotherAction = isAccepted || isRejected || isCancelled || isNoReply;

  if (onAnotherAction && isAnotherAction) {
    const canContinue = await onAnotherAction();

    if (!canContinue) {
      return {
        success: true,
        skipMessage: true,
        message: "Action stopped by onAnotherAction",
      };
    }
  }

  if (isNoReply) {
    const actionNames = [
      ...new Set([storedPatient?.providerAction, "no reply"].filter(Boolean)),
    ].join(" then ");

    await patientsStore.scheduleFakeRejectProbe(referralId, false);

    updatePatients({
      ...patient,
      isSent: "yes",
      isReceived: "yes",
      providerAction: actionNames,
    });

    const prefix = "✅";
    const messageReply = `${prefix} Done ${action} For (Referral ID: ${referralId})`;

    createConsoleMessage("info", messageReply);

    return {
      success: true,
      message: messageReply,
    };
  }

  if (isLeftTimeAction) {
    const { message } = patientsStore.getReferralLeftTime(referralId);

    return {
      success: true,
      message,
    };
  }

  const timeValidation = patientsStore.canStillProcessPatient(referralId);

  // Intentionally before timeValidation:
  // even if bot processing is late, the doctor/user may have manually accepted/rejected,
  // so we still archive and refresh the latest action letter file.
  if (onAcceptOrRejectForFileUpload && (isAccepted || isRejected)) {
    await onAcceptOrRejectForFileUpload();
  }

  if (!skipTimeValidation && !timeValidation.success) {
    const replyMessage = `${timeValidation.message} For (Referral ID: ${referralId})`;

    const actionNames = [
      ...new Set([storedPatient?.providerAction, action].filter(Boolean)),
    ].join(" then ");

    updatePatients({
      ...patient,
      isSent: "yes",
      isReceived: "yes",
      providerAction: `${actionNames} with late reply`,
    });

    createConsoleMessage("info", replyMessage);
    return {
      success: false,
      message: replyMessage,
    };
  }

  const scheduledAt = Date.now();

  let result = {};
  if (isAccepted) {
    result = await patientsStore.scheduleAcceptedPatient(
      referralId,
      scheduledAt,
    );
  } else if (isRejected) {
    result = await patientsStore.scheduleRejectedPatient(
      referralId,
      scheduledAt,
    );
  } else if (isCancelled) {
    result = await patientsStore.cancelPatient(referralId);
  }

  const { success, message: replyMessage } = result;

  const prefix = success ? "✅" : "❌";
  const finalMessage = `${prefix} (Referral ID: ${referralId})  ${replyMessage}`;

  createConsoleMessage("info", finalMessage);

  return {
    success,
    message: finalMessage,
  };
};

export default handleUserActionOnCase;

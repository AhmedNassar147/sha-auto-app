import getWaslaFacilitiesFromAPI from "./getWaslaFacilitiesFromAPI.mjs";
import { getPatient, updatePatients } from "./db.mjs";

const parseSaudiTime = (value) => {
  if (!value) return NaN;
  const normalized = String(value).replace(" ", "T");
  return Date.parse(
    /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized)
      ? normalized
      : normalized + "+03:00",
  );
};

/** Pure summary of server timestamps; timestamps do not establish priority. */
export function summarizeFacilities(facilities, organizationId) {
  const winners = facilities.filter((f) => [1, 4].includes(Number(f.status)));
  const winner = winners.length === 1 ? winners[0] : null;
  const own =
    organizationId == null
      ? null
      : facilities.find((f) => String(f.facilityId) === String(organizationId));
  // Rejected and withdrawn rows may also carry acceptedAt; exclude them
  // when ranking acceptance submissions. Equal timestamps remain ties.
  // Kept as the full list, not just the top 2 - needed to spot cases where
  // we land in a later "wave" alongside other facilities rather than
  // genuinely being outraced (see handleSubmitReferral.mjs timing
  // investigation), and the winningOnly=false hospital filter in
  // db.mjs's getPatientsFiltered (fastestTwo LIKE match) only works for
  // facilities actually present in this list.
  const fastest = facilities
    .filter(
      (f) =>
        [1, 3, 4, 7].includes(Number(f.status)) &&
        Number.isFinite(parseSaudiTime(f.acceptedAt)),
    )
    .sort((a, b) => parseSaudiTime(a.acceptedAt) - parseSaudiTime(b.acceptedAt))
    .map((f) => ({
      facilityId: String(f.facilityId),
      facilityName: f.facilityName,
      acceptedAt: f.acceptedAt,
    }));
  return {
    winnerFacilityId: winner ? String(winner.facilityId) : null,
    winnerFacilityName: winner?.facilityName ?? null,
    ourAcceptedAt: own?.acceptedAt ?? null,
    winnerAcceptedAt: winner?.acceptedAt ?? null,
    fastestTwo: JSON.stringify(fastest),
    ownFacilityId: own ? String(own.facilityId) : null,
    competitionCheckedAt: new Date().toISOString(),
    ...(own?.attachments?.length === 1 && own.attachments[0].id != null
      ? { recoveredCaseAttachmentId: String(own.attachments[0].id) }
      : {}),
  };
}

/** Fetch and persist separately from status checks so read failures do not
 * prevent status notification. Returns failure without clearing old data.
 */
export default async function collectCaseCompetition(context, patient) {
  try {
    if (!patient?.navigationId)
      return { success: false, error: "Missing navigationId" };
    const result = await getWaslaFacilitiesFromAPI(
      context,
      patient.navigationId,
    );
    if (!result.success) return result;
    const { recoveredCaseAttachmentId, ...fields } = summarizeFacilities(
      result.facilities,
      result.organizationId,
    );
    const current = getPatient(patient.referralId) || patient;
    // A sole stored acceptance attachment can recover old cases. Never
    // overwrite the ID captured directly during our actual submission.
    updatePatients({
      referralId: patient.referralId,
      ...fields,
      ...(!current.caseAttachmentId && recoveredCaseAttachmentId
        ? { caseAttachmentId: recoveredCaseAttachmentId }
        : {}),
    });
    return { success: true, ...fields };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

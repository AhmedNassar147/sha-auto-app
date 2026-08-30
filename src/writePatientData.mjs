/*
 *
 * Helper: `writePatientData`.
 *
 */
import { writeFile } from "fs/promises";
import getDateBasedTimezone from "./getDateBasedTimezone.mjs";
import { waitingPatientsFolderDirectory } from "./constants.mjs";

const writePatientData = async (data, fileName) => {
  const { dateString, time } = getDateBasedTimezone();

  const currentDateTime = time.replace(/:/g, ".");

  const _fileName = fileName ? fileName : `${dateString}-${currentDateTime}`;

  // if (fileName) {
  //   fileName = `${extraFileName}-${fileName}`;
  // }

  const patientsDataFile = `${waitingPatientsFolderDirectory}/${_fileName}.json`;

  await writeFile(patientsDataFile, JSON.stringify(data, null, 2));
};

export default writePatientData;

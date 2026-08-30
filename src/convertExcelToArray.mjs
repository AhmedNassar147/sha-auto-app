/*
 *
 * Helper: `convertExcelToArray`.
 *
 */
import ExcelJS from "exceljs";
import readJsonFile from "./readJsonFile.mjs";
import { insertPatients } from "./db.mjs";

const convertExcelToArray = async (filePath) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0]; // first sheet
  let finalData = [];
  // Iterate through remaining rows
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || !row.hasValues) return; // skip header row
    const [
      empty,
      order,
      referralDate,
      idReferral,
      ihalatyReference,
      adherentName,
      adherentNationalId,
      referralType,
      referralReason,
      sourceZone,
      assignedProvider,
    ] = row.values;

    finalData.push({
      referralDate,
      idReferral,
      ihalatyReference,
      adherentName,
      adherentNationalId,
      referralType,
      referralReason,
      sourceZone,
      assignedProvider,
      tabName: "",
      paid: 1,
    });
  });

  const data = await readJsonFile(
    "D:/work/future/clone-icare/automize-icare/results/las-referral-summary.json",
    true
  );

  // insertPatients([...finalData, ...data]);
};

(async () => {
  await convertExcelToArray(
    "D:/work/future/clone-icare/automize-icare/results/last update up to 2072025.xlsx"
  );
})();

export default convertExcelToArray;

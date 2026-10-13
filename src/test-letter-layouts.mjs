import generateAcceptancePdfLetters from "./generatePdfs.mjs";
import { LETTER_LAYOUT_TYPES, IGNORED_LAYOUTS } from "./constants.mjs";

// Fictional patient data for previewing all letter layouts.
const samplePatient = {
  patientName: "أحمد محمد علي",
  patientNationalId: "1000000001",
  nationality: "سعودي",
  dateOfBirth: "1992-12-06",
  createdAt: "2026-10-13 12:30:00",
  referralId: "DEMOCASE1",
  referralReferenceId: "33090001",
  specialty: "الباطنية",
  subSpecialty: "الباطنية العامة",
  sourceProvider: "مستشفى تجريبي",
  mobileNumber: "0500000000",
  requestedBedType: "سرير عناية مركزة",
  clientInPdf: "مستشفى تجريبي",
  clientMangerName: "مدير تجريبي",
  clientManagerPhone: "0500000000",
  __reasonName__: "عدم توفر سرير مناسب",
  isRejection: false,
};

const patients = Object.values(LETTER_LAYOUT_TYPES).map(
  (letterType, index) => ({
    ...samplePatient,
    patientName: ["أحمد محمد علي", "سارة خالد حسن", "عمر إبراهيم يوسف"][
      index % 3
    ],
    patientNationalId: String(1000000001 + index),
    referralId: `DEMOCASE${index + 1}`,
    referralReferenceId: String(33090001 + index),
    letterType,
  }),
);

const testPdfGeneration = async (browser, patientsArray = patients) => {
  if (!browser || typeof browser.newPage !== "function") {
    throw new TypeError(
      "Pass a Puppeteer browser to testPdfGeneration(browser).",
    );
  }
  if (!Array.isArray(patientsArray)) {
    throw new TypeError("patientsArray must be an array.");
  }

  const generatedFiles = [];
  for (const patient of patientsArray) {
    if (IGNORED_LAYOUTS.includes(patient.letterType)) continue;
    const files = await generateAcceptancePdfLetters(
      browser,
      [patient],
      !patient.isRejection,
      patient.letterType,
      { allowAllLayouts: false },
    );
    generatedFiles.push(...files);
  }
  return generatedFiles;
};

export default testPdfGeneration;

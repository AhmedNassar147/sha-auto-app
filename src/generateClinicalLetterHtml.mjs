/** Compact table layout inspired by the supplied referral-letter reference. */
export default function generateClinicalLetterHtml(data) {
  const escape = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const value = (field) => escape(data[field]);
  const entry = (label, field) =>
    `<td class="label">${label}</td><td><div class="value">${value(field)}</div></td>`;
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>خطاب ${data.isRejection ? "رفض" : "قبول"} الإحالة</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, sans-serif; font-size: 14px; color: #000; }
  .clinical-page { width: 100%; }
  .header { display: grid; grid-template-columns: 150px 1fr 150px; gap: 8px; align-items: center; padding: 3px 0 5px; }
  .header img { width: 150px; height: 65px; object-fit: contain; }
  .header-title { text-align: center; font-size: 17px; font-weight: bold; line-height: 1.45; }
  .rule { border-top: 1px solid #b1a779; margin: 4px 0; }
  .document-title { margin: 0 0 4px; padding: 3px; background: #c5d9a2; text-align: center; font-size: 18px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  td { padding: 2px; vertical-align: middle; }
  .patient-table { background: #eef3e3; }
  .admission-table { background: #e7e4d3; }
  .side { width: 26px; writing-mode: vertical-rl; text-align: center; font-weight: bold; font-size: 15px; }
  .label { width: 110px; font-weight: bold; white-space: nowrap; }
  .value { min-height: 22px; border: 1px solid #4d6d7b; padding: 2px 4px; font-weight: bold; overflow-wrap: anywhere; }
  .letter-text { font-size: 16px; line-height: 1.6; margin: 4px 0; padding: 0 8px; direction: rtl; text-align: right; }
  .letter-text p { margin: 4px 0; overflow-wrap: anywhere; }
  .greeting { display: flex; justify-content: space-between; gap: 10px; font-weight: bold; }
  .signature { display: grid; grid-template-columns: 1fr 115px; gap: 8px; align-items: center; margin: 8px 0; }
  .signature-text { text-align: center; line-height: 1.5; }
  .stamp { width: 105px; height: 105px; object-fit: contain; }
  .notes { border: 1px solid #b1a779; padding: 5px 8px; line-height: 1.4; }
  .notes-title { background: #eef3e3; margin: -5px -8px 3px; padding: 3px 8px; text-align: center; font-weight: bold; }
  .notes ul { margin: 0; padding-right: 18px; }
  .footer { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid #b1a779; margin-top: 5px; text-align: center; }
  .footer div { padding: 3px; }
  .footer div + div { border-right: 1px solid #b1a779; }
  @page { size: A4; margin: 10mm; }
  @media print { .header, table, .signature, .notes, .footer { break-inside: avoid; } }
</style></head>
<body><main class="clinical-page">
  <header class="header">
    <img src="${data.ministryFileUrl}" alt="Facility program logo">
    <div class="header-title">المملكة العربية السعودية<br>وزارة الصحة<br>برنامج الإحالة</div>
    <img src="${data.ehalaFileUrl}" alt="Referral Program">
  </header>
  <div class="rule"></div>
  <h1 class="document-title">${data.isRejection ? "إشعار رفض الإحالة" : "إشعار قبول الإحالة"}</h1>
  <table class="patient-table">
    <colgroup><col style="width:26px"><col style="width:110px"><col><col style="width:100px"><col></colgroup>
    <tr><td class="side" rowspan="2">بيانات المريض</td>${entry("اسم المريض", "patientName")}${entry("الجنسية", "nationality")}</tr>
    <tr>${entry("رقم الإثبات", "patientNationalId")}${entry("رقم التواصل", "mobileNumber")}</tr>
  </table>
  <div class="rule"></div>
  <table class="admission-table">
    <colgroup><col style="width:26px"><col style="width:110px"><col><col style="width:100px"><col></colgroup>
    <tr><td class="side" rowspan="4">${data.isRejection ? "بيانات الإحالة" : "بيانات القبول"}</td>${entry("رقم الحالة", "referralId")}${entry("رقم الملف الطبي", "patientFileNumber")}</tr>
    <tr>${entry("القسم", "specialty")}${entry("التخصص الفرعي", "subSpecialty")}</tr>
    <tr>${entry("نوع السرير", "requestedBedType")}${entry("رقم الغرفة", "roomNumber")}</tr>
    <tr>${entry("التاريخ الميلادي", "gregorianDate")}${entry("مدة الحجز", "reservationDuration")}</tr>
  </table>
  <div class="rule"></div>
  <section class="letter-text">
    <div class="greeting"><span>سعادة مدير مستشفى / ${value("sourceProvider")}</span><span>المحترم</span></div>
    <p style="text-align:center">السلام عليكم ورحمة الله وبركاته،</p>
    <p><strong>إشارة إلى الإحالة رقم</strong> <strong>${value("referralReferenceId")}</strong> بتاريخ <strong>${value("requestDate")}</strong> بشأن المريض الموضحة بياناته أعلاه.</p>
    <p>${
      data.isRejection
        ? `<strong>نفيد سعادتكم</strong> بأنه تعذر قبول المريض بسبب <strong>${escape(data.__reasonName__ || "عدم توفر سرير مناسب")}</strong>.`
        : "<strong>نفيد سعادتكم</strong> بأنه تم قبول المريض حسب ما هو موضح بمعلومات الحجز أعلاه."
    }</p>
    ${data.isRejection ? "" : "<p><strong>يرجى اتخاذ كافة الإجراءات اللازمة</strong> لنقل المريض مع مراعاة النقاط المذكورة أدناه.</p>"}
  </section>
  <section class="signature">
    <div class="signature-text">وتفضلوا بقبول تحياتنا<br><strong>${value("clientInPdf")}</strong></div>
    <img class="stamp" src="${data.providerFileUrl}" alt="Facility stamp">
  </section>
  ${
    data.isRejection
      ? ""
      : `<section class="notes"><div class="notes-title">ملاحظات مهمة</div><ul>
    <li>يلزم المحال إليه استقبال الحالة المحولة له لتحقيق الهدف الأساسي من العلاج.</li>
    <li>يرجى إحضار أصل هوية المريض عند الحضور للمستشفى.</li>
    <li>يرجى إحضار أصل التقرير الطبي وصور الفحوصات والأشعة عند الحضور للمستشفى.</li>
    <li>عند اختلاف التاريخ الهجري مع الميلادي يعتمد التاريخ الميلادي للمرجع.</li>
    <li>يرجى الالتزام بتاريخ الموعد المحدد ومدة حجز السرير حتى يتم خدمة المريض بالشكل المطلوب.</li>
  </ul></section>`
  }
  ${data.showLetterFinalFooter ? `<footer class="footer"><div><strong>${value("requestDate")}</strong><br>التاريخ</div><div>${value("clientMangerName")}</div><div>${value("clientManagerPhone")}<br>هاتف قسم التنسيق</div></footer>` : ""}
</main></body></html>`;
}

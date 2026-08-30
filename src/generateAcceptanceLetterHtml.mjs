/*
 *
 * Helper: `generateAcceptanceLetterHtml`.
 *
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LETTER_LAYOUT_TYPES } from "./constants.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ministryLogo = path.resolve(__dirname, "../images/ministry.png");
const ehalaLogo = path.resolve(__dirname, "../images/ehala.png");

const providerLogo = path.resolve(__dirname, "../images/logo.jpeg");

const toBase64 = (imgPath) =>
  `data:image/png;base64,${fs.readFileSync(imgPath, { encoding: "base64" })}`;

const ministryFileUrl = toBase64(ministryLogo);
const ehalaFileUrl = toBase64(ehalaLogo);
const providerFileUrl = toBase64(providerLogo);

const htmlLayouts = {
  [LETTER_LAYOUT_TYPES.STANDARD]: ({
    nationalId,
    nationality,
    patientName,
    requestDate,
    referralId,
    specialty,
    subSpecialty,
    sourceProvider,
    mobileNumber,
    requestedBedType,
    isRejection,
    clientInPdf,
    clientMangerName,
    clientManagerPhone,
    showLetterFinalFooter,
    __reasonName__,
  }) => {
    return `
  <!DOCTYPE html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8">
    <title>${isRejection ? "نموذج رفض الإحالة" : "نموذج الإحالة"}</title>
    <style>
      body {
        margin: 0;
        padding: 15px;
        background: #fff;
        font-family: "Arial", sans-serif;
        font-size: 15px;
        direction: rtl;
      }

      .container {
        max-width: 900px;
        margin: auto;
        border: 1px solid #ccc;
        padding: 15px;
      }

      .header-logos {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .header-logos img {
        height: 50px;
      }

      .header-center-text {
        text-align: center;
        flex-grow: 1;
        font-size: 16px;
        line-height: 1.5;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin: 15px 0;
      }

      td {
        border: 1px solid #999;
        padding: 8px 10px;
        font-size: 15px;
      }

      td strong {
        font-size: 16px;
      }

      .section-title td {
        background: #eaeacb;
        text-align: center;
        font-weight: bold;
      }

      .footer {
        text-align: center;
        margin-top: 20px;
      }

      .notes-section {
        margin-top: 10px;
        padding-top: 10px;
      }

      .notes-header {
        text-align: center;
        padding: 10px;
        font-weight: bold;
        border: 1px solid #ccc;
      }

      .notes-body {
        background: #e7f3f8;
        padding: 15px 20px;
        border: 1px solid #ccc;
        border-top: none;
      }

      .notes-body ul {
        margin: 0;
        padding-right: 20px;
      }

      .notes-footer {
        display: flex;
        justify-content: space-between;
        border: 1px solid #ccc;
        background: #f3f0d7;
        margin-top: 10px;
      }

      .notes-footer div {
        flex: 1;
        padding: 10px;
        font-weight: bold;
        border-left: 1px solid #ccc;
        font-size: 14px;
      }

      .notes-footer div:last-child {
        border-left: none;
      }

      @media print {
        html, body {
          margin: 0;
          padding: 0;
        }

        @page {
          size: A4;
          margin: 10mm;
        }

        table, tr, td {
          page-break-inside: avoid;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header-logos">
        <img src="${ehalaFileUrl}" alt="Referral Program">
        <div class="header-center-text">
          المملكة العربية السعودية
          <br>وزارة الصحة
          <br>برنامج الإحالة
          <br>${isRejection ? "إشعار رفض الإحالة" : "إشعار قبول الإحالة"}
        </div>
        <img src="${ministryFileUrl}" alt="Ministry of Health">
      </div>

      <table>
        <tr class="section-title"><td colspan="4">بيانات المريض</td></tr>
        <tr>
          <td><strong>اسم المريض:</strong> ${patientName}</td>
          <td><strong>رقم الإثبات:</strong> ${nationalId}</td>
          <td><strong>الجنسية:</strong> ${nationality || "SAUDI"}</td>
          <td><strong>رقم التواصل:</strong> ${mobileNumber || ""}</td>
        </tr>

        ${
          isRejection
            ? `
        <tr class="section-title"><td colspan="4">سبب الرفض</td></tr>
        <tr>
          <td colspan="4" style="text-align:center; font-weight:bold;">
            ${__reasonName__ ? __reasonName__ : "لا يوجد سرير متاح"}
          </td>
        </tr>
        `
            : `
        <tr class="section-title"><td colspan="4">بيانات القبول</td></tr>
        <tr>
          <td><strong>رقم الملف الطبي:</strong></td>
          <td><strong>القسم:</strong> ${specialty || ""}</td>
          <td><strong>الطبيب المعالج:</strong>${subSpecialty || ""}</td>
          <td><strong>رقم الغرفة:</strong></td>
        </tr>
        <tr>
          <td><strong>نوع السرير:</strong>${requestedBedType}</td>
          <td><strong>مدة الحجز:</strong> ٤٨ ساعة</td>
        </tr>
        <tr>
          <td colspan="2"><strong>التاريخ الميلادي:</strong> ${requestDate}</td>
          <td colspan="2"><strong>التاريخ الهجري:</strong></td>
        </tr>
        `
        }
      </table>

      <div style="display: flex; justify-content: space-between;">
        <div>
          <p>سعادة مدير مستشفى / <strong>${sourceProvider}</strong> المحترم</p>
          <p>السلام عليكم ورحمة الله وبركاته،</p>
          <p>إشارة لإحالة رقم <strong>${referralId}</strong> بتاريخ <strong>${requestDate}</strong> بشأن المريض الموضحة بياناته أعلاه،</p>
          <p>
            ${
              isRejection
                ? `نفيد سعادتكم بأنه لم يتم قبول المريض بسبب عدم توفر سرير في الوقت الحالي.`
                : `نفيد سعادتكم بأنه تم قبول المريض حسب ما هو موضح بمعلومات الحجز أعلاه.`
            }
            <br>يرجى اتخاذ كافة الإجراءات اللازمة لأمانة المريض مع مراعاة النقاط المذكورة أعلاه.
          </p>
        </div>

        <img src="${providerFileUrl}" alt="Logo" style="height: 150px; width: 150px;" />
      </div>

      <div class="footer">
        <p>وتقبلوا تحياتنا</p>
          <div style="text-align: center;">
            <strong>${clientInPdf}</strong>
          </div>
      </div>

      <div class="notes-section">
          ${
            isRejection
              ? ""
              : `
            <div class="notes-header">ملاحظات مهمة</div>
            <div class="notes-body">
              <ul>
                <li>يلتزم المستشفى المحال استقبال الحالة المحولة عند تحقق الهدف الأساسي من العلاج.</li>
                <li>الرجاء إحضار أصل هوية المريض عند الحضور للمستشفى.</li>
                <li>الرجاء إحضار أصل التقرير الطبي وصور الفحوصات والأشعة عند الحضور للمستشفى.</li>
                <li>عند اختلاف التاريخ الهجري مع التاريخ الميلادي يرجى اعتماد التاريخ الميلادي للمرجع.</li>
                <li>يرجى الالتزام بتاريخ الموعد المحدد ومدة حجز السرير حتى يتم خدمة المرضى بالشكل المطلوب.</li>
              </ul>
            </div>
        `
          }
          ${
            showLetterFinalFooter
              ? `
            <div class="notes-footer">
              <div>${requestDate}<br>التاريخ</div>
              <div>${clientMangerName || ""}</div>
              <div>${clientManagerPhone || ""}<br>تلفون قسم التنسيق</div>
            </div>
            `
              : ""
          }
      </div>
    </div>
  </body>
  </html>
  `;
  },
  [LETTER_LAYOUT_TYPES.MODERN]: ({
    nationalId,
    nationality,
    patientName,
    requestDate,
    referralId,
    specialty,
    subSpecialty,
    sourceProvider,
    mobileNumber,
    requestedBedType,
    isRejection,
    clientInPdf,
    clientMangerName,
    clientManagerPhone,
    showLetterFinalFooter,
  }) => {
    return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>إشعار قبول الإحالة</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #fff;
      font-family: "Arial", sans-serif;
      direction: rtl;
      font-size: 15px;
      color: #222;
    }

    .container {
      max-width: 900px;
      margin: auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 25px;
    }

    .header-logo {
      height: 55px;
    }

    .header-title {
      text-align: center;
      font-size: 18px;
      line-height: 1.6;
      font-weight: bold;
    }

    .card {
      background: #f7f7f7;
      border-radius: 8px;
      padding: 12px 10px;
      margin-bottom: 8px;
      border: 1px solid #e0e0e0;
    }

    .card-title {
      font-weight: bold;
      font-size: 15px;
      margin-bottom: 12px;
      color: #333;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .item-label {
      font-weight: bold;
      color: #444;
    }

    .letter-body {
      margin-top: 12px;
      display: flex;
      gap: 10px;
      justify-content: space-between;
    }

    .letter-inner-body {
      line-height: 1.4;
      font-size: 15px;
    }

    .provider-section {
      align-items: flex-start;
    }

    .provider-logo {
      height: 140px;
      width: 140px;
      object-fit: contain;
    }

    .notes {
      margin-top: 15px;
    }

    .notes-header {
      background: #eef6f9;
      padding: 10px;
      font-weight: bold;
      border: 1px solid #d5e7ef;
      border-radius: 8px 8px 0 0;
      text-align: center;
    }

    .notes-body {
      padding: 15px 20px;
      border: 1px solid #d5e7ef;
      border-top: none;
      border-radius: 0 0 8px 8px;
      background: #f3fafe;
    }

    .notes-body ul {
      margin: 0;
      padding-right: 20px;
      line-height: 1.6;
    }

    .footer {
      text-align: center;
      margin-top: 20px;
      font-size: 15px;
      font-weight: bold;
    }

    .final-footer {
      display: flex;
      justify-content: space-between;
      margin-top: 15px;
      background: #fff9d9;
      padding: 12px;
      border: 1px solid #e6deba;
      border-radius: 6px;
      font-size: 14px;
      line-height: 1.7;
    }

    @media print {
      body {
        padding: 0;
      }
      @page {
        size: A4;
        margin: 12mm;
      }
    }
  </style>
</head>


<body>
  <div class="container">
    <div class="header">
      <img src="${ehalaFileUrl}" class="Referral Program" />
      <div class="header-title">
        المملكة العربية السعودية<br />
        وزارة الصحة<br />
        برنامج الإحالة<br />
        ${isRejection ? "إشعار رفض الإحالة" : "إشعار قبول الإحالة"}
      </div>
      <img src="${ministryFileUrl}" class="header-logo" />
    </div>

    <div class="card">
      <div class="card-title">بيانات المريض</div>
      <div class="grid-2">
        <div><span class="item-label">اسم المريض:</span> ${patientName}</div>
        <div><span class="item-label">رقم الإثبات:</span> ${nationalId}</div>
        <div><span class="item-label">الجنسية:</span> ${nationality}</div>
        <div><span class="item-label">رقم التواصل:</span> ${mobileNumber}</div>
      </div>
    </div>

    <div class="card">
    ${
      isRejection
        ? `
        <div class="grid-2">
          <div><span class="item-label">سبب الرفض:</span> لا يوجد سرير</div>
        </div>
        `
        : `
        <div class="card-title">بيانات القبول</div>
        <div class="grid-2">
          <div><span class="item-label">الطبيب المعالج:</span> ${subSpecialty}</div>
          <div><span class="item-label">القسم:</span> ${specialty}</div>
          <div><span class="item-label">نوع السرير:</span> ${requestedBedType}</div>
          <div><span class="item-label">مدة الحجز:</span> ٤٨ ساعة</div>
          <div><span class="item-label">التاريخ الميلادي:</span> ${requestDate}</div>
        </div>
        `
    }
      </div>


    <div class="letter-body">
      <div class="letter-inner-body">
        <p>سعادة مدير مستشفى / <strong>${sourceProvider}</strong> المحترم</p>

        <p>السلام عليكم ورحمة الله وبركاته،</p>

        <p>
          إشارة لإحالة رقم <strong>${referralId}</strong> بتاريخ
          <strong>${requestDate}</strong> بشأن المريض الموضحة بياناته أعلاه،
        </p>

        <p>
          نفيد سعادتكم بأنه ${
            isRejection ? "لن يتم" : "تم"
          }  قبول المريض حسب ما هو موضح بمعلومات الحجز أعلاه.
          <br />يرجى اتخاذ كافة الإجراءات اللازمة لأمانة المريض.
        </p>
      </div>

      <div class="provider-section">
        <img src="${providerFileUrl}" class="provider-logo" />
      </div>
    </div>

    <div class="footer">
      وتقبلوا تحياتنا<br />
      <strong>${clientInPdf}</strong>
    </div>


    ${
      isRejection
        ? ""
        : `
        <div class="notes">
         <div class="notes-header">ملاحظات مهمة</div>
        <div class="notes-body">
        <ul>
          <li>يلتزم المستشفى المحال استقبال الحالة المحولة عند تحقق الهدف الأساسي من العلاج.</li>
          <li>إحضار أصل هوية المريض عند الحضور.</li>
          <li>إحضار أصل التقرير الطبي وصور الفحوصات والأشعة.</li>
          <li>عند اختلاف التاريخ الهجري والميلادي يرجى اعتماد الميلادي.</li>
          <li>الالتزام بمدة حجز السرير والموعد المحدد.</li>
        </ul>
      </div>
    </div>
        `
    }

    ${
      showLetterFinalFooter
        ? `
      <div class="final-footer">
        <div>${requestDate}<br />التاريخ</div>
        <div>${clientMangerName}</div>
        <div>${clientManagerPhone}<br />تلفون قسم التنسيق</div>
      </div>
      `
        : ""
    }
  </div>
</body>
</html>
`;
  },
  [LETTER_LAYOUT_TYPES.FORMAL]: ({
    nationalId,
    nationality,
    patientName,
    requestDate,
    referralId,
    specialty,
    subSpecialty,
    sourceProvider,
    mobileNumber,
    requestedBedType,
    isRejection,
    clientInPdf,
    clientMangerName,
    clientManagerPhone,
    showLetterFinalFooter,
    __reasonName__,
  }) => {
    return `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />

          <title>
            ${isRejection ? "خطاب رفض الإحالة" : "خطاب قبول الإحالة"}
          </title>

          <style>
            * {
              box-sizing: border-box;
            }

            html,
            body {
              margin: 0;
              padding: 0;
              direction: rtl;
              background: #fff;
              color: #1f2937;
              font-family: Arial, sans-serif;
              font-size: 14px;
            }

            .page {
              width: 100%;
              min-height: 100%;
              border: 2px solid #1e5f74;
              padding: 18px;
            }

            .header {
              display: grid;
              grid-template-columns: 90px 1fr 90px;
              align-items: center;
              gap: 15px;
              padding-bottom: 15px;
              border-bottom: 2px solid #1e5f74;
            }

            .header-logo {
              width: 80px;
              height: 70px;
              object-fit: contain;
            }

            .header-content {
              text-align: center;
              line-height: 1.6;
            }

            .kingdom-title {
              font-size: 16px;
              font-weight: bold;
            }

            .letter-title {
              margin-top: 6px;
              font-size: 20px;
              font-weight: bold;
              color: #1e5f74;
            }

            .reference-bar {
              display: flex;
              justify-content: space-between;
              margin-top: 15px;
              padding: 10px 12px;
              background: #f1f7f9;
              border: 1px solid #bdd1d8;
              font-weight: bold;
            }

            .section {
              margin-top: 15px;
              border: 1px solid #9ca3af;
            }

            .section-title {
              padding: 9px 12px;
              background: #1e5f74;
              color: #fff;
              font-size: 15px;
              font-weight: bold;
              text-align: center;
            }

            .details-table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
            }

            .details-table td {
              padding: 10px;
              border: 1px solid #c8cdd2;
              vertical-align: top;
              word-break: break-word;
            }

            .field-label {
              display: block;
              margin-bottom: 4px;
              color: #334155;
              font-weight: bold;
            }

            .field-value {
              min-height: 18px;
            }

            .reason {
              padding: 15px;
              background: #fff7f7;
              color: #8a1c1c;
              font-size: 16px;
              font-weight: bold;
              text-align: center;
            }

            .letter-content {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              gap: 20px;
              margin-top: 20px;
            }

            .letter-text {
              flex: 1;
              font-size: 15px;
              line-height: 1.9;
            }

            .provider-logo {
              width: 135px;
              height: 135px;
              object-fit: contain;
            }

            .signature {
              margin-top: 18px;
              text-align: center;
              line-height: 1.8;
            }

            .client-name {
              font-size: 16px;
              font-weight: bold;
              color: #1e5f74;
            }

            .notes {
              margin-top: 18px;
              border: 1px solid #b8c8cf;
            }

            .notes-title {
              padding: 9px;
              background: #e8f2f5;
              font-weight: bold;
              text-align: center;
            }

            .notes-content {
              padding: 12px 18px;
              line-height: 1.7;
            }

            .notes-content ul {
              margin: 0;
              padding-right: 20px;
            }

            .final-footer {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              margin-top: 18px;
              border: 1px solid #9ca3af;
            }

            .footer-item {
              min-height: 55px;
              padding: 9px;
              text-align: center;
              line-height: 1.6;
              border-left: 1px solid #9ca3af;
            }

            .footer-item:last-child {
              border-left: none;
            }

            .footer-label {
              font-weight: bold;
              color: #475569;
            }

            @media print {
              html,
              body {
                margin: 0;
                padding: 0;
              }

              .page {
                border: 2px solid #1e5f74;
              }

              table,
              tr,
              td,
              .section,
              .notes,
              .final-footer {
                break-inside: avoid;
                page-break-inside: avoid;
              }
            }

            @page {
              size: A4;
              margin: 10mm;
            }
          </style>
        </head>

        <body>
          <main class="page">
            <header class="header">
              <img
                class="header-logo"
                src="${ehalaFileUrl}"
                alt="Referral Program"
              />

              <div class="header-content">
                <div class="kingdom-title">
                  المملكة العربية السعودية
                  <br />
                  وزارة الصحة
                  <br />
                  برنامج الإحالة
                </div>

                <div class="letter-title">
                  ${isRejection ? "خطاب رفض الإحالة" : "خطاب قبول الإحالة"}
                </div>
              </div>

              <img
                class="header-logo"
                src="${ministryFileUrl}"
                alt="Ministry of Health"
              />
            </header>

            <div class="reference-bar">
              <div>
                رقم الإحالة:
                <span>${referralId || ""}</span>
              </div>

              <div>
                التاريخ:
                <span>${requestDate || ""}</span>
              </div>
            </div>

            <section class="section">
              <div class="section-title">بيانات المريض</div>

              <table class="details-table">
                <tbody>
                  <tr>
                    <td colspan="2">
                      <span class="field-label">اسم المريض</span>
                      <div class="field-value">${patientName || ""}</div>
                    </td>

                    <td>
                      <span class="field-label">رقم الإثبات</span>
                      <div class="field-value">${nationalId || ""}</div>
                    </td>
                  </tr>

                  <tr>
                    <td>
                      <span class="field-label">الجنسية</span>
                      <div class="field-value">
                        ${nationality || "SAUDI"}
                      </div>
                    </td>

                    <td>
                      <span class="field-label">رقم التواصل</span>
                      <div class="field-value">${mobileNumber || ""}</div>
                    </td>

                    <td>
                      <span class="field-label">المستشفى المحيل</span>
                      <div class="field-value">${sourceProvider || ""}</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            ${
              isRejection
                ? `
                  <section class="section">
                    <div class="section-title">بيانات رفض الإحالة</div>

                    <div class="reason">
                      ${
                        __reasonName__ ||
                        "تعذر قبول الحالة لعدم توفر سرير في الوقت الحالي"
                      }
                    </div>
                  </section>
                `
                : `
                  <section class="section">
                    <div class="section-title">بيانات قبول الإحالة</div>

                    <table class="details-table">
                      <tbody>
                        <tr>
                          <td>
                            <span class="field-label">
                              رقم الملف الطبي
                            </span>
                            <div class="field-value"></div>
                          </td>

                          <td>
                            <span class="field-label">القسم</span>
                            <div class="field-value">
                              ${specialty || ""}
                            </div>
                          </td>

                          <td>
                            <span class="field-label">
                              الطبيب المعالج
                            </span>
                            <div class="field-value">
                              ${subSpecialty || ""}
                            </div>
                          </td>
                        </tr>

                        <tr>
                          <td>
                            <span class="field-label">نوع السرير</span>
                            <div class="field-value">
                              ${requestedBedType || ""}
                            </div>
                          </td>

                          <td>
                            <span class="field-label">مدة الحجز</span>
                            <div class="field-value">٤٨ ساعة</div>
                          </td>

                          <td>
                            <span class="field-label">رقم الغرفة</span>
                            <div class="field-value"></div>
                          </td>
                        </tr>

                        <tr>
                          <td colspan="2">
                            <span class="field-label">
                              التاريخ الميلادي
                            </span>
                            <div class="field-value">
                              ${requestDate || ""}
                            </div>
                          </td>

                          <td>
                            <span class="field-label">
                              التاريخ الهجري
                            </span>
                            <div class="field-value"></div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </section>
                `
            }

            <div class="letter-content">
              <div class="letter-text">
                <p>
                  سعادة مدير مستشفى /
                  <strong>${sourceProvider || ""}</strong>
                  المحترم
                </p>

                <p>السلام عليكم ورحمة الله وبركاته،</p>

                <p>
                  إشارة إلى الإحالة رقم
                  <strong>${referralId || ""}</strong>
                  بتاريخ
                  <strong>${requestDate || ""}</strong>
                  بشأن المريض الموضحة بياناته أعلاه.
                </p>

                <p>
                  ${
                    isRejection
                      ? `
                        نفيد سعادتكم بأنه تعذر قبول المريض بسبب
                        <strong>
                          ${__reasonName__ || "عدم توفر سرير في الوقت الحالي"}
                        </strong>.
                      `
                      : `
                        نفيد سعادتكم بأنه تم قبول المريض حسب بيانات
                        القبول والحجز الموضحة أعلاه.
                      `
                  }

                  <br />

                  يرجى اتخاذ كافة الإجراءات اللازمة لأمانة المريض،
                  واستكمال الإجراءات النظامية المطلوبة.
                </p>
              </div>

              <img
                class="provider-logo"
                src="${providerFileUrl}"
                alt="Provider Logo"
              />
            </div>

            <div class="signature">
              وتقبلوا تحياتنا
              <br />

              <span class="client-name">
                ${clientInPdf || ""}
              </span>
            </div>

            ${
              isRejection
                ? ""
                : `
                  <section class="notes">
                    <div class="notes-title">ملاحظات مهمة</div>

                    <div class="notes-content">
                      <ul>
                        <li>
                          يلتزم المستشفى المحال باستقبال الحالة المحولة
                          عند تحقق الهدف الأساسي من العلاج.
                        </li>

                        <li>
                          يرجى إحضار أصل هوية المريض عند الحضور
                          للمستشفى.
                        </li>

                        <li>
                          يرجى إحضار أصل التقرير الطبي وصور الفحوصات
                          والأشعة.
                        </li>

                        <li>
                          عند اختلاف التاريخ الهجري مع التاريخ الميلادي،
                          يعتمد التاريخ الميلادي للمرجع.
                        </li>

                        <li>
                          يرجى الالتزام بتاريخ الموعد المحدد ومدة حجز
                          السرير.
                        </li>
                      </ul>
                    </div>
                  </section>
                `
            }

            ${
              showLetterFinalFooter
                ? `
                  <footer class="final-footer">
                    <div class="footer-item">
                      <span class="footer-label">التاريخ</span>
                      <br />
                      ${requestDate || ""}
                    </div>

                    <div class="footer-item">
                      <span class="footer-label">مسؤول التنسيق</span>
                      <br />
                      ${clientMangerName || ""}
                    </div>

                    <div class="footer-item">
                      <span class="footer-label">
                        هاتف قسم التنسيق
                      </span>
                      <br />
                      ${clientManagerPhone || ""}
                    </div>
                  </footer>
                `
                : ""
            }
          </main>
        </body>
      </html>
    `;
  },
  [LETTER_LAYOUT_TYPES.ELEGANT]: ({
    nationalId,
    nationality,
    patientName,
    requestDate,
    referralId,
    specialty,
    subSpecialty,
    sourceProvider,
    mobileNumber,
    requestedBedType,
    isRejection,
    clientInPdf,
    clientMangerName,
    clientManagerPhone,
    showLetterFinalFooter,
    __reasonName__,
  }) => {
    return `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />

          <title>
            ${isRejection ? "إشعار رفض الإحالة" : "إشعار قبول الإحالة"}
          </title>

          <style>
            * {
              box-sizing: border-box;
            }

            html,
            body {
              margin: 0;
              padding: 0;
              direction: rtl;
              background: #fff;
              color: #263238;
              font-family: Arial, sans-serif;
              font-size: 14px;
            }

            .page {
              width: 100%;
            }

            .top-border {
              height: 8px;
              margin-bottom: 15px;
              background: #356859;
            }

            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
            }

            .logo {
              width: 85px;
              height: 70px;
              object-fit: contain;
            }

            .header-center {
              flex: 1;
              text-align: center;
              line-height: 1.55;
            }

            .government-title {
              font-size: 15px;
              font-weight: bold;
            }

            .document-title {
              margin-top: 8px;
              color: #356859;
              font-size: 21px;
              font-weight: bold;
            }

            .document-meta {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 10px;
              margin-top: 18px;
            }

            .meta-box {
              padding: 9px 12px;
              background: #f5f8f7;
              border-right: 4px solid #356859;
            }

            .meta-label {
              font-weight: bold;
            }

            .section {
              margin-top: 16px;
            }

            .section-heading {
              display: flex;
              align-items: center;
              gap: 10px;
              margin-bottom: 8px;
            }

            .heading-number {
              display: flex;
              width: 28px;
              height: 28px;
              align-items: center;
              justify-content: center;
              background: #356859;
              color: #fff;
              border-radius: 50%;
              font-weight: bold;
            }

            .heading-text {
              color: #356859;
              font-size: 16px;
              font-weight: bold;
            }

            .info-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              border: 1px solid #ccd6d2;
              border-radius: 7px;
              overflow: hidden;
            }

            .info-item {
              min-height: 60px;
              padding: 10px 12px;
              border-bottom: 1px solid #dce4e1;
            }

            .info-item:nth-child(odd) {
              border-left: 1px solid #dce4e1;
            }

            .info-item.full-width {
              grid-column: 1 / -1;
              border-left: none;
            }

            .info-label {
              display: block;
              margin-bottom: 6px;
              color: #5f6f68;
              font-size: 12px;
              font-weight: bold;
            }

            .info-value {
              color: #1f2925;
              font-size: 15px;
              font-weight: bold;
            }

            .rejection-box {
              padding: 17px;
              background: #fff4f4;
              border: 1px solid #ecc8c8;
              border-radius: 7px;
              color: #8c2c2c;
              font-size: 16px;
              font-weight: bold;
              text-align: center;
            }

            .message-card {
              position: relative;
              margin-top: 20px;
              padding: 16px 18px;
              background: #f8faf9;
              border: 1px solid #d4dfdb;
              border-radius: 8px;
              line-height: 1.9;
              font-size: 15px;
            }

            .message-logo {
              position: absolute;
              left: 15px;
              bottom: 15px;
              width: 120px;
              height: 120px;
              object-fit: contain;
              opacity: 0.95;
            }

            .message-text {
              padding-left: 135px;
            }

            .signature {
              margin-top: 20px;
              text-align: center;
              line-height: 1.7;
            }

            .signature-client {
              display: inline-block;
              margin-top: 5px;
              padding: 5px 20px;
              border-bottom: 2px solid #356859;
              color: #356859;
              font-size: 16px;
              font-weight: bold;
            }

            .notes {
              margin-top: 18px;
              padding: 12px 15px;
              background: #f2f7f5;
              border-right: 5px solid #356859;
              line-height: 1.7;
            }

            .notes-title {
              margin-bottom: 8px;
              color: #356859;
              font-weight: bold;
            }

            .notes ul {
              margin: 0;
              padding-right: 20px;
            }

            .coordination-footer {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 8px;
              margin-top: 18px;
            }

            .coordination-item {
              padding: 10px;
              background: #f7f7f2;
              border: 1px solid #deded3;
              border-radius: 5px;
              text-align: center;
              line-height: 1.6;
            }

            .coordination-label {
              display: block;
              margin-bottom: 3px;
              color: #59645f;
              font-size: 12px;
              font-weight: bold;
            }

            .bottom-border {
              height: 6px;
              margin-top: 18px;
              background: #356859;
            }

            @media print {
              html,
              body {
                margin: 0;
                padding: 0;
              }

              .section,
              .info-grid,
              .message-card,
              .notes,
              .coordination-footer {
                break-inside: avoid;
                page-break-inside: avoid;
              }
            }

            @page {
              size: A4;
              margin: 10mm;
            }
          </style>
        </head>

        <body>
          <main class="page">
            <div class="top-border"></div>

            <header class="header">
              <img
                class="logo"
                src="${ehalaFileUrl}"
                alt="Referral Program"
              />

              <div class="header-center">
                <div class="government-title">
                  المملكة العربية السعودية
                  <br />
                  وزارة الصحة
                  <br />
                  برنامج الإحالة
                </div>

                <div class="document-title">
                  ${isRejection ? "إشعار رفض الإحالة" : "إشعار قبول الإحالة"}
                </div>
              </div>

              <img
                class="logo"
                src="${ministryFileUrl}"
                alt="Ministry of Health"
              />
            </header>

            <div class="document-meta">
              <div class="meta-box">
                <span class="meta-label">رقم الإحالة:</span>
                ${referralId || ""}
              </div>

              <div class="meta-box">
                <span class="meta-label">تاريخ الطلب:</span>
                ${requestDate || ""}
              </div>
            </div>

            <section class="section">
              <div class="section-heading">
                <span class="heading-number">١</span>
                <span class="heading-text">بيانات المريض</span>
              </div>

              <div class="info-grid">
                <div class="info-item">
                  <span class="info-label">اسم المريض</span>
                  <span class="info-value">${patientName || ""}</span>
                </div>

                <div class="info-item">
                  <span class="info-label">رقم الإثبات</span>
                  <span class="info-value">${nationalId || ""}</span>
                </div>

                <div class="info-item">
                  <span class="info-label">الجنسية</span>
                  <span class="info-value">
                    ${nationality || "SAUDI"}
                  </span>
                </div>

                <div class="info-item">
                  <span class="info-label">رقم التواصل</span>
                  <span class="info-value">${mobileNumber || ""}</span>
                </div>

                <div class="info-item full-width">
                  <span class="info-label">المستشفى المحيل</span>
                  <span class="info-value">${sourceProvider || ""}</span>
                </div>
              </div>
            </section>

            <section class="section">
              <div class="section-heading">
                <span class="heading-number">٢</span>

                <span class="heading-text">
                  ${isRejection ? "بيانات الرفض" : "بيانات القبول"}
                </span>
              </div>

              ${
                isRejection
                  ? `
                    <div class="rejection-box">
                      ${__reasonName__ || "لا يوجد سرير متاح في الوقت الحالي"}
                    </div>
                  `
                  : `
                    <div class="info-grid">
                      <div class="info-item">
                        <span class="info-label">القسم</span>
                        <span class="info-value">
                          ${specialty || ""}
                        </span>
                      </div>

                      <div class="info-item">
                        <span class="info-label">الطبيب المعالج</span>
                        <span class="info-value">
                          ${subSpecialty || ""}
                        </span>
                      </div>

                      <div class="info-item">
                        <span class="info-label">نوع السرير</span>
                        <span class="info-value">
                          ${requestedBedType || ""}
                        </span>
                      </div>

                      <div class="info-item">
                        <span class="info-label">مدة الحجز</span>
                        <span class="info-value">٤٨ ساعة</span>
                      </div>

                      <div class="info-item">
                        <span class="info-label">رقم الملف الطبي</span>
                        <span class="info-value"></span>
                      </div>

                      <div class="info-item">
                        <span class="info-label">رقم الغرفة</span>
                        <span class="info-value"></span>
                      </div>

                      <div class="info-item">
                        <span class="info-label">التاريخ الميلادي</span>
                        <span class="info-value">
                          ${requestDate || ""}
                        </span>
                      </div>

                      <div class="info-item">
                        <span class="info-label">التاريخ الهجري</span>
                        <span class="info-value"></span>
                      </div>
                    </div>
                  `
              }
            </section>

            <section class="message-card">
              <div class="message-text">
                <p>
                  سعادة مدير مستشفى /
                  <strong>${sourceProvider || ""}</strong>
                  المحترم
                </p>

                <p>السلام عليكم ورحمة الله وبركاته،</p>

                <p>
                  إشارة إلى الإحالة رقم
                  <strong>${referralId || ""}</strong>
                  بتاريخ
                  <strong>${requestDate || ""}</strong>
                  بشأن المريض الموضحة بياناته أعلاه.
                </p>

                <p>
                  ${
                    isRejection
                      ? `
                        نفيد سعادتكم بأنه تعذر قبول المريض بسبب
                        <strong>
                          ${__reasonName__ || "عدم توفر سرير في الوقت الحالي"}
                        </strong>.
                      `
                      : `
                        نفيد سعادتكم بأنه تم قبول المريض وفق معلومات
                        القبول والحجز الموضحة أعلاه.
                      `
                  }
                </p>

                <p>
                  يرجى اتخاذ كافة الإجراءات اللازمة لأمانة المريض،
                  واستكمال المتطلبات النظامية والطبية اللازمة.
                </p>
              </div>

              <img
                class="message-logo"
                src="${providerFileUrl}"
                alt="Provider Logo"
              />
            </section>

            <div class="signature">
              وتقبلوا تحياتنا

              <br />

              <span class="signature-client">
                ${clientInPdf || ""}
              </span>
            </div>

            ${
              isRejection
                ? ""
                : `
                  <section class="notes">
                    <div class="notes-title">ملاحظات مهمة</div>

                    <ul>
                      <li>
                        يلتزم المستشفى المحال باستقبال الحالة المحولة
                        عند تحقق الهدف الأساسي من العلاج.
                      </li>

                      <li>
                        يرجى إحضار أصل هوية المريض عند الحضور.
                      </li>

                      <li>
                        يرجى إحضار أصل التقرير الطبي وصور الفحوصات
                        والأشعة.
                      </li>

                      <li>
                        عند اختلاف التاريخ الهجري والميلادي، يعتمد
                        التاريخ الميلادي.
                      </li>

                      <li>
                        يرجى الالتزام بتاريخ الموعد المحدد ومدة حجز
                        السرير.
                      </li>
                    </ul>
                  </section>
                `
            }

            ${
              showLetterFinalFooter
                ? `
                  <footer class="coordination-footer">
                    <div class="coordination-item">
                      <span class="coordination-label">التاريخ</span>
                      ${requestDate || ""}
                    </div>

                    <div class="coordination-item">
                      <span class="coordination-label">
                        مسؤول التنسيق
                      </span>
                      ${clientMangerName || ""}
                    </div>

                    <div class="coordination-item">
                      <span class="coordination-label">
                        هاتف قسم التنسيق
                      </span>
                      ${clientManagerPhone || ""}
                    </div>
                  </footer>
                `
                : ""
            }

            <div class="bottom-border"></div>
          </main>
        </body>
      </html>
    `;
  },
  [LETTER_LAYOUT_TYPES.CORPORATE]: ({
    nationalId,
    nationality,
    patientName,
    requestDate,
    referralId,
    specialty,
    subSpecialty,
    sourceProvider,
    mobileNumber,
    requestedBedType,
    isRejection,
    clientInPdf,
    clientMangerName,
    clientManagerPhone,
    showLetterFinalFooter,
    __reasonName__,
  }) => {
    const statusText = isRejection ? "مرفوضة" : "مقبولة";
    const statusClass = isRejection ? "status-rejected" : "status-accepted";

    return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />

        <title>
          ${isRejection ? "إشعار رفض الإحالة" : "إشعار قبول الإحالة"}
        </title>

        <style>
          * {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            direction: rtl;
            background: #ffffff;
            color: #263238;
            font-family: Arial, sans-serif;
            font-size: 14px;
          }

          .page {
            width: 100%;
          }

          .top-line {
            height: 8px;
            background: #005a9c;
          }

          .header {
            display: grid;
            grid-template-columns: 95px 1fr 95px;
            align-items: center;
            gap: 18px;
            padding: 17px 20px;
            background: #f7f9fb;
            border-bottom: 1px solid #d9e2e8;
          }

          .header-logo {
            width: 85px;
            height: 72px;
            object-fit: contain;
          }

          .header-content {
            text-align: center;
            line-height: 1.55;
          }

          .government-name {
            color: #37474f;
            font-size: 15px;
            font-weight: bold;
          }

          .document-title {
            margin-top: 7px;
            color: #005a9c;
            font-size: 22px;
            font-weight: bold;
          }

          .summary {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 10px;
            margin-top: 16px;
          }

          .summary-item {
            min-height: 65px;
            padding: 10px 13px;
            background: #ffffff;
            border: 1px solid #d8e1e7;
            border-right: 5px solid #1976d2;
          }

          .summary-label {
            display: block;
            margin-bottom: 6px;
            color: #607d8b;
            font-size: 12px;
            font-weight: bold;
          }

          .summary-value {
            color: #263238;
            font-size: 15px;
            font-weight: bold;
          }

          .status-badge {
            display: inline-block;
            min-width: 85px;
            padding: 5px 13px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: bold;
            text-align: center;
          }

          .status-accepted {
            background: #e8f5e9;
            color: #237a39;
            border: 1px solid #b9ddc0;
          }

          .status-rejected {
            background: #ffebee;
            color: #a72b35;
            border: 1px solid #efc1c6;
          }

          .section {
            margin-top: 17px;
          }

          .section-header {
            display: flex;
            align-items: center;
            min-height: 38px;
            padding: 8px 13px;
            background: #005a9c;
            color: #ffffff;
          }

          .section-title {
            font-size: 15px;
            font-weight: bold;
          }

          .section-subtitle {
            margin-right: auto;
            color: #dceefb;
            font-size: 12px;
          }

          .data-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            border-right: 1px solid #d8e1e7;
            border-bottom: 1px solid #d8e1e7;
          }

          .data-item {
            min-height: 67px;
            padding: 10px 12px;
            background: #ffffff;
            border-left: 1px solid #d8e1e7;
            border-top: 1px solid #d8e1e7;
          }

          .data-item.wide {
            grid-column: span 2;
          }

          .data-item.full {
            grid-column: 1 / -1;
          }

          .data-label {
            display: block;
            margin-bottom: 6px;
            color: #607d8b;
            font-size: 12px;
            font-weight: bold;
          }

          .data-value {
            min-height: 18px;
            color: #263238;
            font-size: 14px;
            font-weight: bold;
            word-break: break-word;
          }

          .rejection-box {
            padding: 18px;
            background: #fff6f7;
            border: 1px solid #efc9cd;
            border-right: 6px solid #c62828;
            color: #922b32;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
          }

          .letter-panel {
            display: grid;
            grid-template-columns: 1fr 145px;
            gap: 20px;
            align-items: center;
            margin-top: 18px;
            padding: 17px 18px;
            background: #f7f9fb;
            border: 1px solid #d8e1e7;
            border-right: 6px solid #005a9c;
          }

          .letter-text {
            font-size: 15px;
            line-height: 1.9;
          }

          .letter-text p {
            margin: 0 0 11px;
          }

          .provider-logo-wrapper {
            display: flex;
            min-height: 145px;
            align-items: center;
            justify-content: center;
            padding: 8px;
            background: #ffffff;
            border: 1px solid #d8e1e7;
          }

          .provider-logo {
            width: 130px;
            height: 130px;
            object-fit: contain;
          }

          .signature {
            margin-top: 18px;
            text-align: center;
            line-height: 1.8;
          }

          .signature-name {
            display: inline-block;
            min-width: 220px;
            margin-top: 5px;
            padding: 5px 20px;
            color: #005a9c;
            border-bottom: 2px solid #005a9c;
            font-size: 16px;
            font-weight: bold;
          }

          .notes {
            margin-top: 18px;
            border: 1px solid #d4dfe5;
          }

          .notes-header {
            padding: 9px 13px;
            background: #eaf4fd;
            color: #005a9c;
            border-bottom: 1px solid #d4dfe5;
            font-size: 15px;
            font-weight: bold;
          }

          .notes-content {
            padding: 12px 17px;
            background: #ffffff;
            line-height: 1.7;
          }

          .notes-content ul {
            margin: 0;
            padding-right: 20px;
          }

          .coordination-footer {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            margin-top: 18px;
            border-top: 4px solid #005a9c;
            border-right: 1px solid #d8e1e7;
            border-bottom: 1px solid #d8e1e7;
          }

          .coordination-item {
            min-height: 62px;
            padding: 9px;
            background: #f7f9fb;
            border-left: 1px solid #d8e1e7;
            text-align: center;
            line-height: 1.6;
          }

          .coordination-label {
            display: block;
            margin-bottom: 3px;
            color: #607d8b;
            font-size: 12px;
            font-weight: bold;
          }

          .bottom-line {
            height: 6px;
            margin-top: 17px;
            background: #005a9c;
          }

          @media print {
            html,
            body {
              margin: 0;
              padding: 0;
            }

            .summary,
            .section,
            .data-grid,
            .letter-panel,
            .notes,
            .coordination-footer {
              break-inside: avoid;
              page-break-inside: avoid;
            }
          }

          @page {
            size: A4;
            margin: 10mm;
          }
        </style>
      </head>

      <body>
        <main class="page">
          <div class="top-line"></div>

          <header class="header">
            <img
              src="${ehalaFileUrl}"
              class="header-logo"
              alt="Referral Program"
            />

            <div class="header-content">
              <div class="government-name">
                المملكة العربية السعودية
                <br />
                وزارة الصحة
                <br />
                برنامج الإحالة
              </div>

              <div class="document-title">
                ${isRejection ? "إشعار رفض الإحالة" : "إشعار قبول الإحالة"}
              </div>
            </div>

            <img
              src="${ministryFileUrl}"
              class="header-logo"
              alt="Ministry of Health"
            />
          </header>

          <section class="summary">
            <div class="summary-item">
              <span class="summary-label">رقم الإحالة</span>

              <div class="summary-value">
                ${referralId || ""}
              </div>
            </div>

            <div class="summary-item">
              <span class="summary-label">تاريخ الطلب</span>

              <div class="summary-value">
                ${requestDate || ""}
              </div>
            </div>

            <div class="summary-item">
              <span class="summary-label">حالة الإحالة</span>

              <span class="status-badge ${statusClass}">
                ${statusText}
              </span>
            </div>
          </section>

          <section class="section">
            <div class="section-header">
              <span class="section-title">بيانات المريض</span>
              <span class="section-subtitle">Patient Information</span>
            </div>

            <div class="data-grid">
              <div class="data-item wide">
                <span class="data-label">اسم المريض</span>

                <div class="data-value">
                  ${patientName || ""}
                </div>
              </div>

              <div class="data-item">
                <span class="data-label">رقم الإثبات</span>

                <div class="data-value">
                  ${nationalId || ""}
                </div>
              </div>

              <div class="data-item">
                <span class="data-label">الجنسية</span>

                <div class="data-value">
                  ${nationality || "SAUDI"}
                </div>
              </div>

              <div class="data-item">
                <span class="data-label">رقم التواصل</span>

                <div class="data-value">
                  ${mobileNumber || ""}
                </div>
              </div>

              <div class="data-item">
                <span class="data-label">المستشفى المحيل</span>

                <div class="data-value">
                  ${sourceProvider || ""}
                </div>
              </div>
            </div>
          </section>

          <section class="section">
            <div class="section-header">
              <span class="section-title">
                ${isRejection ? "بيانات رفض الإحالة" : "بيانات قبول الإحالة"}
              </span>

              <span class="section-subtitle">
                ${isRejection ? "Rejection Details" : "Acceptance Details"}
              </span>
            </div>

            ${
              isRejection
                ? `
                  <div class="rejection-box">
                    ${
                      __reasonName__ ||
                      "تعذر قبول الحالة لعدم توفر سرير في الوقت الحالي"
                    }
                  </div>
                `
                : `
                  <div class="data-grid">
                    <div class="data-item">
                      <span class="data-label">
                        رقم الملف الطبي
                      </span>

                      <div class="data-value"></div>
                    </div>

                    <div class="data-item">
                      <span class="data-label">القسم</span>

                      <div class="data-value">
                        ${specialty || ""}
                      </div>
                    </div>

                    <div class="data-item">
                      <span class="data-label">
                        الطبيب المعالج
                      </span>

                      <div class="data-value">
                        ${subSpecialty || ""}
                      </div>
                    </div>

                    <div class="data-item">
                      <span class="data-label">نوع السرير</span>

                      <div class="data-value">
                        ${requestedBedType || ""}
                      </div>
                    </div>

                    <div class="data-item">
                      <span class="data-label">مدة الحجز</span>

                      <div class="data-value">
                        ٤٨ ساعة
                      </div>
                    </div>

                    <div class="data-item">
                      <span class="data-label">رقم الغرفة</span>

                      <div class="data-value"></div>
                    </div>

                    <div class="data-item wide">
                      <span class="data-label">
                        التاريخ الميلادي
                      </span>

                      <div class="data-value">
                        ${requestDate || ""}
                      </div>
                    </div>

                    <div class="data-item">
                      <span class="data-label">
                        التاريخ الهجري
                      </span>

                      <div class="data-value"></div>
                    </div>
                  </div>
                `
            }
          </section>

          <section class="letter-panel">
            <div class="letter-text">
              <p>
                سعادة مدير مستشفى /
                <strong>${sourceProvider || ""}</strong>
                المحترم
              </p>

              <p>السلام عليكم ورحمة الله وبركاته،</p>

              <p>
                إشارة إلى الإحالة رقم
                <strong>${referralId || ""}</strong>
                بتاريخ
                <strong>${requestDate || ""}</strong>
                بشأن المريض الموضحة بياناته أعلاه.
              </p>

              <p>
                ${
                  isRejection
                    ? `
                      نفيد سعادتكم بأنه تعذر قبول المريض بسبب
                      <strong>
                        ${__reasonName__ || "عدم توفر سرير في الوقت الحالي"}
                      </strong>.
                    `
                    : `
                      نفيد سعادتكم بأنه تم قبول المريض وفق
                      بيانات القبول والحجز الموضحة أعلاه.
                    `
                }
              </p>

              <p>
                يرجى اتخاذ كافة الإجراءات اللازمة لأمانة المريض،
                واستكمال الإجراءات الطبية والنظامية المطلوبة.
              </p>
            </div>

            <div class="provider-logo-wrapper">
              <img
                src="${providerFileUrl}"
                class="provider-logo"
                alt="Provider Logo"
              />
            </div>
          </section>

          <div class="signature">
            وتقبلوا تحياتنا
            <br />

            <span class="signature-name">
              ${clientInPdf || ""}
            </span>
          </div>

          ${
            isRejection
              ? ""
              : `
                <section class="notes">
                  <div class="notes-header">
                    ملاحظات مهمة
                  </div>

                  <div class="notes-content">
                    <ul>
                      <li>
                        يلتزم المستشفى المحال باستقبال الحالة المحولة
                        عند تحقق الهدف الأساسي من العلاج.
                      </li>

                      <li>
                        يرجى إحضار أصل هوية المريض عند الحضور.
                      </li>

                      <li>
                        يرجى إحضار أصل التقرير الطبي وصور
                        الفحوصات والأشعة.
                      </li>

                      <li>
                        عند اختلاف التاريخ الهجري والميلادي،
                        يعتمد التاريخ الميلادي.
                      </li>

                      <li>
                        يرجى الالتزام بتاريخ الموعد المحدد
                        ومدة حجز السرير.
                      </li>
                    </ul>
                  </div>
                </section>
              `
          }

          ${
            showLetterFinalFooter
              ? `
                <footer class="coordination-footer">
                  <div class="coordination-item">
                    <span class="coordination-label">التاريخ</span>
                    ${requestDate || ""}
                  </div>

                  <div class="coordination-item">
                    <span class="coordination-label">
                      مسؤول التنسيق
                    </span>

                    ${clientMangerName || ""}
                  </div>

                  <div class="coordination-item">
                    <span class="coordination-label">
                      هاتف قسم التنسيق
                    </span>

                    ${clientManagerPhone || ""}
                  </div>
                </footer>
              `
              : ""
          }

          <div class="bottom-line"></div>
        </main>
      </body>
    </html>
  `;
  },
  [LETTER_LAYOUT_TYPES.EXECUTIVE]: ({
    nationalId,
    nationality,
    patientName,
    requestDate,
    referralId,
    specialty,
    subSpecialty,
    sourceProvider,
    mobileNumber,
    requestedBedType,
    isRejection,
    clientInPdf,
    clientMangerName,
    clientManagerPhone,
    showLetterFinalFooter,
    __reasonName__,
  }) => {
    const statusText = isRejection ? "مرفوضة" : "مقبولة";
    const statusClass = isRejection ? "status-rejected" : "status-accepted";

    return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />

        <title>
          ${isRejection ? "خطاب رفض الإحالة" : "خطاب قبول الإحالة"}
        </title>

        <style>
          * {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            direction: rtl;
            background: #ffffff;
            color: #243443;
            font-family: Arial, sans-serif;
            font-size: 14px;
          }

          .page {
            width: 100%;
          }

          .executive-header {
            position: relative;
            display: grid;
            grid-template-columns: 100px 1fr 100px;
            align-items: center;
            gap: 20px;
            min-height: 120px;
            padding: 18px 22px;
            overflow: hidden;
            background: #153e5c;
            color: #ffffff;
          }

          .executive-header::after {
            position: absolute;
            right: 0;
            bottom: 0;
            width: 38%;
            height: 6px;
            background: #4f9ac5;
            content: "";
          }

          .executive-header::before {
            position: absolute;
            bottom: -55px;
            left: -35px;
            width: 180px;
            height: 180px;
            border: 30px solid rgba(255, 255, 255, 0.05);
            border-radius: 50%;
            content: "";
          }

          .header-logo-box {
            position: relative;
            z-index: 1;
            display: flex;
            width: 95px;
            height: 88px;
            align-items: center;
            justify-content: center;
            padding: 7px;
            background: #ffffff;
            border-radius: 8px;
          }

          .header-logo {
            width: 82px;
            height: 74px;
            object-fit: contain;
          }

          .header-content {
            position: relative;
            z-index: 1;
            text-align: center;
            line-height: 1.5;
          }

          .government-title {
            color: #dceaf2;
            font-size: 14px;
            font-weight: bold;
          }

          .document-title {
            margin-top: 8px;
            font-size: 23px;
            font-weight: bold;
          }

          .document-subtitle {
            margin-top: 4px;
            color: #bcd6e5;
            font-size: 12px;
            letter-spacing: 1px;
          }

          .overview {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            margin-top: 16px;
          }

          .overview-card {
            min-height: 72px;
            padding: 11px 13px;
            background: #f4f8fb;
            border: 1px solid #cfdae2;
            border-top: 4px solid #2f6690;
          }

          .overview-label {
            display: block;
            margin-bottom: 7px;
            color: #657988;
            font-size: 11px;
            font-weight: bold;
          }

          .overview-value {
            color: #153e5c;
            font-size: 14px;
            font-weight: bold;
            word-break: break-word;
          }

          .status-chip {
            display: inline-block;
            min-width: 80px;
            padding: 5px 13px;
            border-radius: 4px;
            font-size: 13px;
            font-weight: bold;
            text-align: center;
          }

          .status-accepted {
            background: #e6f4eb;
            color: #256a3c;
            border: 1px solid #b9d8c4;
          }

          .status-rejected {
            background: #fce9eb;
            color: #9b2f3c;
            border: 1px solid #e7bbc1;
          }

          .section {
            margin-top: 17px;
          }

          .section-heading {
            display: flex;
            align-items: center;
            min-height: 39px;
            padding: 8px 13px;
            background: #eef4f8;
            border-right: 6px solid #153e5c;
            border-bottom: 1px solid #cedbe3;
          }

          .section-title {
            color: #153e5c;
            font-size: 15px;
            font-weight: bold;
          }

          .section-title-en {
            margin-right: auto;
            color: #768a98;
            font-size: 11px;
            font-weight: bold;
          }

          .information-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            border-right: 1px solid #d5dfe5;
            border-bottom: 1px solid #d5dfe5;
          }

          .information-item {
            min-height: 68px;
            padding: 10px 12px;
            background: #ffffff;
            border-top: 1px solid #d5dfe5;
            border-left: 1px solid #d5dfe5;
          }

          .information-item.wide {
            grid-column: span 2;
          }

          .information-item.full {
            grid-column: 1 / -1;
          }

          .information-label {
            display: block;
            margin-bottom: 6px;
            color: #6d7f8c;
            font-size: 11px;
            font-weight: bold;
          }

          .information-value {
            min-height: 18px;
            color: #263b4a;
            font-size: 14px;
            font-weight: bold;
            word-break: break-word;
          }

          .decision-panel {
            position: relative;
            margin-top: 17px;
            padding: 18px 20px;
            overflow: hidden;
            background: #f7f9fb;
            border: 1px solid #d1dce3;
            border-right: 7px solid #153e5c;
          }

          .decision-panel::after {
            position: absolute;
            top: -34px;
            left: -34px;
            width: 110px;
            height: 110px;
            background: rgba(47, 102, 144, 0.06);
            border-radius: 50%;
            content: "";
          }

          .decision-layout {
            position: relative;
            z-index: 1;
            display: grid;
            grid-template-columns: 1fr 145px;
            gap: 22px;
            align-items: center;
          }

          .decision-text {
            font-size: 15px;
            line-height: 1.95;
          }

          .decision-text p {
            margin: 0 0 11px;
          }

          .decision-title {
            margin-bottom: 12px;
            color: #153e5c;
            font-size: 16px;
            font-weight: bold;
          }

          .provider-box {
            display: flex;
            min-height: 145px;
            align-items: center;
            justify-content: center;
            padding: 8px;
            background: #ffffff;
            border: 1px solid #ccd8e0;
            box-shadow: 0 2px 5px rgba(21, 62, 92, 0.08);
          }

          .provider-logo {
            width: 130px;
            height: 130px;
            object-fit: contain;
          }

          .rejection-panel {
            padding: 18px;
            background: #fff5f6;
            border: 1px solid #ebc7cc;
            border-right: 7px solid #b32638;
            color: #912b37;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
          }

          .signature {
            display: flex;
            margin-top: 18px;
            justify-content: center;
          }

          .signature-box {
            min-width: 290px;
            padding: 10px 25px;
            text-align: center;
            border-top: 1px solid #d2dce2;
            border-bottom: 3px solid #153e5c;
            line-height: 1.8;
          }

          .signature-title {
            color: #637783;
            font-size: 13px;
          }

          .signature-name {
            color: #153e5c;
            font-size: 16px;
            font-weight: bold;
          }

          .notes-panel {
            margin-top: 18px;
            background: #f1f6f9;
            border: 1px solid #cfdae2;
          }

          .notes-header {
            padding: 9px 14px;
            background: #2f6690;
            color: #ffffff;
            font-size: 14px;
            font-weight: bold;
          }

          .notes-body {
            padding: 12px 18px;
            line-height: 1.75;
          }

          .notes-body ul {
            margin: 0;
            padding-right: 20px;
          }

          .coordination-footer {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1px;
            margin-top: 18px;
            overflow: hidden;
            background: #c9d5dd;
            border: 1px solid #c9d5dd;
          }

          .coordination-item {
            min-height: 64px;
            padding: 10px;
            background: #ffffff;
            text-align: center;
            line-height: 1.6;
          }

          .coordination-label {
            display: block;
            margin-bottom: 4px;
            color: #6d7e89;
            font-size: 11px;
            font-weight: bold;
          }

          .coordination-value {
            color: #153e5c;
            font-size: 14px;
            font-weight: bold;
          }

          .document-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 12px;
            padding: 6px 12px;
            background: #153e5c;
            color: #d9e7ef;
            font-size: 11px;
          }

          .document-footer-line {
            width: 45px;
            height: 3px;
            background: #4f9ac5;
          }

          @media print {
            html,
            body {
              margin: 0;
              padding: 0;
            }

            .overview,
            .section,
            .information-grid,
            .decision-panel,
            .rejection-panel,
            .notes-panel,
            .coordination-footer {
              break-inside: avoid;
              page-break-inside: avoid;
            }

            .executive-header,
            .section-heading,
            .notes-header,
            .document-footer {
              print-color-adjust: exact;
              -webkit-print-color-adjust: exact;
            }
          }

          @page {
            size: A4;
            margin: 10mm;
          }
        </style>
      </head>

      <body>
        <main class="page">
          <header class="executive-header">
            <div class="header-logo-box">
              <img
                src="${ehalaFileUrl}"
                class="header-logo"
                alt="Referral Program"
              />
            </div>

            <div class="header-content">
              <div class="government-title">
                المملكة العربية السعودية
                <br />
                وزارة الصحة
                <br />
                برنامج الإحالة
              </div>

              <div class="document-title">
                ${isRejection ? "خطاب رفض الإحالة" : "خطاب قبول الإحالة"}
              </div>

              <div class="document-subtitle">
                REFERRAL DECISION LETTER
              </div>
            </div>

            <div class="header-logo-box">
              <img
                src="${ministryFileUrl}"
                class="header-logo"
                alt="Ministry of Health"
              />
            </div>
          </header>

          <section class="overview">
            <div class="overview-card">
              <span class="overview-label">رقم الإحالة</span>

              <div class="overview-value">
                ${referralId || ""}
              </div>
            </div>

            <div class="overview-card">
              <span class="overview-label">تاريخ الطلب</span>

              <div class="overview-value">
                ${requestDate || ""}
              </div>
            </div>

            <div class="overview-card">
              <span class="overview-label">المستشفى المحيل</span>

              <div class="overview-value">
                ${sourceProvider || ""}
              </div>
            </div>

            <div class="overview-card">
              <span class="overview-label">حالة الإحالة</span>

              <span class="status-chip ${statusClass}">
                ${statusText}
              </span>
            </div>
          </section>

          <section class="section">
            <div class="section-heading">
              <span class="section-title">بيانات المريض</span>
              <span class="section-title-en">PATIENT PROFILE</span>
            </div>

            <div class="information-grid">
              <div class="information-item wide">
                <span class="information-label">اسم المريض</span>

                <div class="information-value">
                  ${patientName || ""}
                </div>
              </div>

              <div class="information-item">
                <span class="information-label">رقم الإثبات</span>

                <div class="information-value">
                  ${nationalId || ""}
                </div>
              </div>

              <div class="information-item">
                <span class="information-label">الجنسية</span>

                <div class="information-value">
                  ${nationality || "SAUDI"}
                </div>
              </div>

              <div class="information-item">
                <span class="information-label">رقم التواصل</span>

                <div class="information-value">
                  ${mobileNumber || ""}
                </div>
              </div>

              <div class="information-item">
                <span class="information-label">رقم الإحالة</span>

                <div class="information-value">
                  ${referralId || ""}
                </div>
              </div>
            </div>
          </section>

          <section class="section">
            <div class="section-heading">
              <span class="section-title">
                ${isRejection ? "بيانات رفض الإحالة" : "بيانات قبول الإحالة"}
              </span>

              <span class="section-title-en">
                ${isRejection ? "REJECTION DETAILS" : "ACCEPTANCE DETAILS"}
              </span>
            </div>

            ${
              isRejection
                ? `
                  <div class="rejection-panel">
                    ${
                      __reasonName__ ||
                      "تعذر قبول الحالة لعدم توفر سرير في الوقت الحالي"
                    }
                  </div>
                `
                : `
                  <div class="information-grid">
                    <div class="information-item">
                      <span class="information-label">
                        رقم الملف الطبي
                      </span>

                      <div class="information-value"></div>
                    </div>

                    <div class="information-item">
                      <span class="information-label">القسم</span>

                      <div class="information-value">
                        ${specialty || ""}
                      </div>
                    </div>

                    <div class="information-item">
                      <span class="information-label">
                        الطبيب المعالج
                      </span>

                      <div class="information-value">
                        ${subSpecialty || ""}
                      </div>
                    </div>

                    <div class="information-item">
                      <span class="information-label">نوع السرير</span>

                      <div class="information-value">
                        ${requestedBedType || ""}
                      </div>
                    </div>

                    <div class="information-item">
                      <span class="information-label">مدة الحجز</span>

                      <div class="information-value">
                        ٤٨ ساعة
                      </div>
                    </div>

                    <div class="information-item">
                      <span class="information-label">رقم الغرفة</span>

                      <div class="information-value"></div>
                    </div>

                    <div class="information-item wide">
                      <span class="information-label">
                        التاريخ الميلادي
                      </span>

                      <div class="information-value">
                        ${requestDate || ""}
                      </div>
                    </div>

                    <div class="information-item">
                      <span class="information-label">
                        التاريخ الهجري
                      </span>

                      <div class="information-value"></div>
                    </div>
                  </div>
                `
            }
          </section>

          <section class="decision-panel">
            <div class="decision-layout">
              <div class="decision-text">
                <div class="decision-title">
                </div>

                <p>
                  سعادة مدير مستشفى /
                  <strong>${sourceProvider || ""}</strong>
                  المحترم
                </p>

                <p>السلام عليكم ورحمة الله وبركاته،</p>

                <p>
                  إشارة إلى الإحالة رقم
                  <strong>${referralId || ""}</strong>
                  بتاريخ
                  <strong>${requestDate || ""}</strong>
                  بشأن المريض الموضحة بياناته أعلاه.
                </p>

                <p>
                  ${
                    isRejection
                      ? `
                        نفيد سعادتكم بأنه تعذر قبول المريض بسبب
                        <strong>
                          ${__reasonName__ || "عدم توفر سرير في الوقت الحالي"}
                        </strong>.
                      `
                      : `
                        نفيد سعادتكم بأنه تم قبول المريض وفق
                        بيانات القبول والحجز الموضحة أعلاه.
                      `
                  }
                </p>

                <p>
                  يرجى اتخاذ كافة الإجراءات اللازمة لأمانة المريض،
                  واستكمال الإجراءات الطبية والنظامية المطلوبة.
                </p>
              </div>

              <div class="provider-box">
                <img
                  src="${providerFileUrl}"
                  class="provider-logo"
                  alt="Provider Logo"
                />
              </div>
            </div>
          </section>

          <div class="signature">
            <div class="signature-box">
              <div class="signature-title">
                وتقبلوا تحياتنا
              </div>

              <div class="signature-name">
                ${clientInPdf || ""}
              </div>
            </div>
          </div>

          ${
            isRejection
              ? ""
              : `
                <section class="notes-panel">
                  <div class="notes-header">
                    ملاحظات وتعليمات مهمة
                  </div>

                  <div class="notes-body">
                    <ul>
                      <li>
                        يلتزم المستشفى المحال باستقبال الحالة المحولة
                        عند تحقق الهدف الأساسي من العلاج.
                      </li>

                      <li>
                        يرجى إحضار أصل هوية المريض عند الحضور للمستشفى.
                      </li>

                      <li>
                        يرجى إحضار أصل التقرير الطبي وصور الفحوصات
                        والأشعة.
                      </li>

                      <li>
                        عند اختلاف التاريخ الهجري مع التاريخ الميلادي،
                        يعتمد التاريخ الميلادي للمرجع.
                      </li>

                      <li>
                        يرجى الالتزام بتاريخ الموعد المحدد ومدة
                        حجز السرير.
                      </li>
                    </ul>
                  </div>
                </section>
              `
          }

          ${
            showLetterFinalFooter
              ? `
                <footer class="coordination-footer">
                  <div class="coordination-item">
                    <span class="coordination-label">
                      التاريخ
                    </span>

                    <div class="coordination-value">
                      ${requestDate || ""}
                    </div>
                  </div>

                  <div class="coordination-item">
                    <span class="coordination-label">
                      مسؤول التنسيق
                    </span>

                    <div class="coordination-value">
                      ${clientMangerName || ""}
                    </div>
                  </div>

                  <div class="coordination-item">
                    <span class="coordination-label">
                      هاتف قسم التنسيق
                    </span>

                    <div class="coordination-value">
                      ${clientManagerPhone || ""}
                    </div>
                  </div>
                </footer>
              `
              : ""
          }
        </main>
      </body>
    </html>
  `;
  },
  [LETTER_LAYOUT_TYPES.PREMIUM]: ({
    nationalId,
    nationality,
    patientName,
    requestDate,
    referralId,
    specialty,
    subSpecialty,
    sourceProvider,
    mobileNumber,
    requestedBedType,
    isRejection,
    clientInPdf,
    clientMangerName,
    clientManagerPhone,
    showLetterFinalFooter,
    __reasonName__,
  }) => {
    return `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />

        <title>
          ${isRejection ? "إشعار رفض الإحالة" : "إشعار قبول الإحالة"}
        </title>

        <style>
          * {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            direction: rtl;
            background: #fff;
            color: #24323a;
            font-family: Arial, sans-serif;
            font-size: 14px;
          }

          .page {
            width: 100%;
          }

          .header {
            position: relative;
            display: grid;
            grid-template-columns: 95px 1fr 95px;
            align-items: center;
            gap: 15px;
            padding: 14px 18px 17px;
            background: #f3f7f8;
            border-radius: 12px;
          }

          .header::after {
            position: absolute;
            right: 18px;
            bottom: 0;
            left: 18px;
            height: 4px;
            background: #176b78;
            border-radius: 4px;
            content: "";
          }

          .header-logo {
            width: 85px;
            height: 72px;
            object-fit: contain;
          }

          .header-center {
            text-align: center;
            line-height: 1.55;
          }

          .government-title {
            font-size: 15px;
            font-weight: bold;
          }

          .document-title {
            margin-top: 7px;
            color: #176b78;
            font-size: 22px;
            font-weight: bold;
          }

          .document-summary {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-top: 16px;
          }

          .summary-item {
            padding: 10px 12px;
            background: #fff;
            border: 1px solid #cad9dd;
            border-radius: 8px;
            text-align: center;
          }

          .summary-label {
            display: block;
            margin-bottom: 4px;
            color: #60747c;
            font-size: 12px;
            font-weight: bold;
          }

          .summary-value {
            font-size: 14px;
            font-weight: bold;
          }

          .section {
            margin-top: 16px;
          }

          .section-header {
            display: flex;
            align-items: center;
            gap: 9px;
            margin-bottom: 8px;
          }

          .section-marker {
            width: 8px;
            height: 27px;
            background: #176b78;
            border-radius: 8px;
          }

          .section-title {
            color: #176b78;
            font-size: 16px;
            font-weight: bold;
          }

          .data-card {
            border: 1px solid #d4dfe2;
            border-radius: 10px;
            overflow: hidden;
          }

          .data-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
          }

          .data-item {
            min-height: 60px;
            padding: 10px 13px;
            border-bottom: 1px solid #e1e8ea;
          }

          .data-item:nth-child(odd) {
            border-left: 1px solid #e1e8ea;
          }

          .data-item.full {
            grid-column: 1 / -1;
            border-left: none;
          }

          .data-label {
            display: block;
            margin-bottom: 5px;
            color: #64767d;
            font-size: 12px;
            font-weight: bold;
          }

          .data-value {
            color: #1f3037;
            font-size: 15px;
            font-weight: bold;
          }

          .rejection-card {
            padding: 17px;
            background: #fff5f5;
            border: 1px solid #efcccc;
            border-radius: 10px;
            color: #942f2f;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
          }

          .letter-card {
            display: grid;
            grid-template-columns: 1fr 135px;
            gap: 20px;
            align-items: center;
            margin-top: 18px;
            padding: 17px;
            background: #f8fafb;
            border: 1px solid #d7e1e4;
            border-radius: 10px;
          }

          .letter-text {
            font-size: 15px;
            line-height: 1.9;
          }

          .letter-text p {
            margin: 0 0 11px;
          }

          .provider-logo {
            width: 130px;
            height: 130px;
            object-fit: contain;
          }

          .signature {
            margin-top: 17px;
            text-align: center;
            line-height: 1.8;
          }

          .client-name {
            display: inline-block;
            margin-top: 4px;
            padding: 4px 18px;
            color: #176b78;
            border-bottom: 2px solid #176b78;
            font-size: 16px;
            font-weight: bold;
          }

          .notes-card {
            margin-top: 17px;
            padding: 13px 16px;
            background: #eff7f7;
            border: 1px solid #cde1e2;
            border-radius: 10px;
          }

          .notes-title {
            margin-bottom: 8px;
            color: #176b78;
            font-size: 15px;
            font-weight: bold;
          }

          .notes-card ul {
            margin: 0;
            padding-right: 20px;
            line-height: 1.7;
          }

          .coordination-footer {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 9px;
            margin-top: 17px;
          }

          .coordination-item {
            padding: 10px;
            background: #f7f8f8;
            border: 1px solid #d3dcdf;
            border-radius: 8px;
            text-align: center;
            line-height: 1.6;
          }

          .coordination-label {
            display: block;
            margin-bottom: 3px;
            color: #5b6b71;
            font-size: 12px;
            font-weight: bold;
          }

          .bottom-line {
            height: 5px;
            margin-top: 17px;
            background: #176b78;
            border-radius: 5px;
          }

          @media print {
            html,
            body {
              margin: 0;
              padding: 0;
            }

            .section,
            .data-card,
            .letter-card,
            .notes-card,
            .coordination-footer {
              break-inside: avoid;
              page-break-inside: avoid;
            }
          }

          @page {
            size: A4;
            margin: 10mm;
          }
        </style>
      </head>

      <body>
        <main class="page">
          <header class="header">
            <img
              src="${ehalaFileUrl}"
              class="header-logo"
              alt="Referral Program"
            />

            <div class="header-center">
              <div class="government-title">
                المملكة العربية السعودية
                <br />
                وزارة الصحة
                <br />
                برنامج الإحالة
              </div>

              <div class="document-title">
                ${isRejection ? "إشعار رفض الإحالة" : "إشعار قبول الإحالة"}
              </div>
            </div>

            <img
              src="${ministryFileUrl}"
              class="header-logo"
              alt="Ministry of Health"
            />
          </header>

          <div class="document-summary">
            <div class="summary-item">
              <span class="summary-label">رقم الإحالة</span>
              <span class="summary-value">
                ${referralId || ""}
              </span>
            </div>

            <div class="summary-item">
              <span class="summary-label">تاريخ الطلب</span>
              <span class="summary-value">
                ${requestDate || ""}
              </span>
            </div>

            <div class="summary-item">
              <span class="summary-label">حالة الإحالة</span>
              <span class="summary-value">
                ${isRejection ? "مرفوضة" : "مقبولة"}
              </span>
            </div>
          </div>

          <section class="section">
            <div class="section-header">
              <span class="section-marker"></span>
              <span class="section-title">بيانات المريض</span>
            </div>

            <div class="data-card">
              <div class="data-grid">
                <div class="data-item">
                  <span class="data-label">اسم المريض</span>
                  <span class="data-value">
                    ${patientName || ""}
                  </span>
                </div>

                <div class="data-item">
                  <span class="data-label">رقم الإثبات</span>
                  <span class="data-value">
                    ${nationalId || ""}
                  </span>
                </div>

                <div class="data-item">
                  <span class="data-label">الجنسية</span>
                  <span class="data-value">
                    ${nationality || "SAUDI"}
                  </span>
                </div>

                <div class="data-item">
                  <span class="data-label">رقم التواصل</span>
                  <span class="data-value">
                    ${mobileNumber || ""}
                  </span>
                </div>

                <div class="data-item full">
                  <span class="data-label">المستشفى المحيل</span>
                  <span class="data-value">
                    ${sourceProvider || ""}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section class="section">
            <div class="section-header">
              <span class="section-marker"></span>

              <span class="section-title">
                ${isRejection ? "بيانات الرفض" : "بيانات القبول"}
              </span>
            </div>

            ${
              isRejection
                ? `
                  <div class="rejection-card">
                    ${__reasonName__ || "لا يوجد سرير متاح في الوقت الحالي"}
                  </div>
                `
                : `
                  <div class="data-card">
                    <div class="data-grid">
                      <div class="data-item">
                        <span class="data-label">
                          رقم الملف الطبي
                        </span>
                        <span class="data-value"></span>
                      </div>

                      <div class="data-item">
                        <span class="data-label">القسم</span>
                        <span class="data-value">
                          ${specialty || ""}
                        </span>
                      </div>

                      <div class="data-item">
                        <span class="data-label">
                          الطبيب المعالج
                        </span>
                        <span class="data-value">
                          ${subSpecialty || ""}
                        </span>
                      </div>

                      <div class="data-item">
                        <span class="data-label">نوع السرير</span>
                        <span class="data-value">
                          ${requestedBedType || ""}
                        </span>
                      </div>

                      <div class="data-item">
                        <span class="data-label">مدة الحجز</span>
                        <span class="data-value">
                          ٤٨ ساعة
                        </span>
                      </div>

                      <div class="data-item">
                        <span class="data-label">رقم الغرفة</span>
                        <span class="data-value"></span>
                      </div>

                      <div class="data-item">
                        <span class="data-label">
                          التاريخ الميلادي
                        </span>
                        <span class="data-value">
                          ${requestDate || ""}
                        </span>
                      </div>

                      <div class="data-item">
                        <span class="data-label">
                          التاريخ الهجري
                        </span>
                        <span class="data-value"></span>
                      </div>
                    </div>
                  </div>
                `
            }
          </section>

          <section class="letter-card">
            <div class="letter-text">
              <p>
                سعادة مدير مستشفى /
                <strong>${sourceProvider || ""}</strong>
                المحترم
              </p>

              <p>السلام عليكم ورحمة الله وبركاته،</p>

              <p>
                إشارة إلى الإحالة رقم
                <strong>${referralId || ""}</strong>
                بتاريخ
                <strong>${requestDate || ""}</strong>
                بشأن المريض الموضحة بياناته أعلاه.
              </p>

              <p>
                ${
                  isRejection
                    ? `
                      نفيد سعادتكم بأنه تعذر قبول المريض بسبب
                      <strong>
                        ${__reasonName__ || "عدم توفر سرير في الوقت الحالي"}
                      </strong>.
                    `
                    : `
                      نفيد سعادتكم بأنه تم قبول المريض وفق
                      بيانات القبول والحجز الموضحة أعلاه.
                    `
                }
              </p>

              <p>
                يرجى اتخاذ كافة الإجراءات اللازمة لأمانة المريض،
                واستكمال المتطلبات الطبية والنظامية المطلوبة.
              </p>
            </div>

            <img
              src="${providerFileUrl}"
              class="provider-logo"
              alt="Provider Logo"
            />
          </section>

          <div class="signature">
            وتقبلوا تحياتنا
            <br />

            <span class="client-name">
              ${clientInPdf || ""}
            </span>
          </div>

          ${
            isRejection
              ? ""
              : `
                <section class="notes-card">
                  <div class="notes-title">ملاحظات مهمة</div>

                  <ul>
                    <li>
                      يلتزم المستشفى المحال باستقبال الحالة
                      المحولة عند تحقق الهدف الأساسي من العلاج.
                    </li>

                    <li>
                      يرجى إحضار أصل هوية المريض عند الحضور.
                    </li>

                    <li>
                      يرجى إحضار أصل التقرير الطبي وصور
                      الفحوصات والأشعة.
                    </li>

                    <li>
                      عند اختلاف التاريخ الهجري والميلادي يعتمد
                      التاريخ الميلادي.
                    </li>

                    <li>
                      يرجى الالتزام بتاريخ الموعد المحدد
                      ومدة حجز السرير.
                    </li>
                  </ul>
                </section>
              `
          }

          ${
            showLetterFinalFooter
              ? `
                <footer class="coordination-footer">
                  <div class="coordination-item">
                    <span class="coordination-label">التاريخ</span>
                    ${requestDate || ""}
                  </div>

                  <div class="coordination-item">
                    <span class="coordination-label">
                      مسؤول التنسيق
                    </span>
                    ${clientMangerName || ""}
                  </div>

                  <div class="coordination-item">
                    <span class="coordination-label">
                      هاتف قسم التنسيق
                    </span>
                    ${clientManagerPhone || ""}
                  </div>
                </footer>
              `
              : ""
          }

          <div class="bottom-line"></div>
        </main>
      </body>
    </html>
  `;
  },
};

const generateAcceptanceLetterHtml = ({
  nationalId,
  nationality,
  patientName,
  requestDate: _requestDate,
  referralId,
  specialty,
  subSpecialty,
  sourceProvider,
  mobileNumber,
  requestedBedType,
  isRejection,
  clientInPdf,
  clientMangerName,
  clientManagerPhone,
  letterType,
  __reasonName__,
}) => {
  const [date] = _requestDate.split("T");
  const [year, month, day] = date.split("-");
  const requestDate = `${day}/${month}/${year}`;

  const showLetterFinalFooter = !!(clientMangerName || clientManagerPhone);

  const _letterType = letterType || LETTER_LAYOUT_TYPES.STANDARD;
  const htmlCreator = htmlLayouts[_letterType];

  return htmlCreator({
    nationalId,
    nationality,
    patientName,
    requestDate,
    referralId,
    specialty,
    subSpecialty,
    sourceProvider,
    mobileNumber,
    requestedBedType,
    isRejection,
    clientInPdf,
    clientMangerName,
    clientManagerPhone,
    showLetterFinalFooter,
    __reasonName__,
  });
};

export default generateAcceptanceLetterHtml;

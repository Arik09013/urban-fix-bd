import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HTML_FILE_PATH = path.resolve("docs", "technical_doc.html");
const ROOT_PDF_PATH = path.resolve("..", "Urban_Fix_BD_Technical_Documentation.pdf");
const SUBDIR_PDF_PATH = path.resolve(".", "Urban_Fix_BD_Technical_Documentation.pdf");

async function generatePDF() {
  console.log("Reading HTML documentation source from:", HTML_FILE_PATH);
  const htmlContent = fs.readFileSync(HTML_FILE_PATH, 'utf-8');

  console.log("Launching Headless Chrome at:", CHROME_PATH);
  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const page = await browser.newPage();

  console.log("Setting document content and waiting for network idle...");
  await page.setContent(htmlContent, { waitUntil: 'networkidle' });

  console.log("Printing high-resolution A4 technical documentation PDF...");
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="width: 100%; font-size: 8pt; font-family: 'Inter', sans-serif; color: #64748B; padding: 0 16mm; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #E2E8F0; padding-bottom: 3px;">
        <span>Urban Fix BD — System Architecture & Technical Manual</span>
        <span style="font-family: 'JetBrains Mono', monospace; font-size: 7.5pt; color: #00A3C4;">DOC: UFIX-ENG-2026</span>
      </div>
    `,
    footerTemplate: `
      <div style="width: 100%; font-size: 8pt; font-family: 'Inter', sans-serif; color: #64748B; padding: 0 16mm; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #E2E8F0; padding-top: 3px;">
        <span style="font-weight: 600; color: #94A3B8; font-size: 7pt; letter-spacing: 0.05em;">CONFIDENTIAL & PROPRIETARY — GOVTECH CIVIC TRUST</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `,
    margin: {
      top: '18mm',
      bottom: '18mm',
      left: '16mm',
      right: '16mm'
    }
  });

  await browser.close();

  // Write to both ROOT and SUBDIR paths for accessibility
  fs.writeFileSync(ROOT_PDF_PATH, pdfBuffer);
  fs.writeFileSync(SUBDIR_PDF_PATH, pdfBuffer);

  console.log(`Successfully generated PDF at: ${ROOT_PDF_PATH}`);
  console.log(`Saved copy at: ${SUBDIR_PDF_PATH}`);
  console.log(`File Size: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);
}

generatePDF().catch(err => {
  console.error("PDF generation failed:", err);
  process.exit(1);
});

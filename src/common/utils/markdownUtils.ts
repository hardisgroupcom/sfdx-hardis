import c from "chalk"
import fs from './fsUtils.js';
import * as path from "path";
import { pathToFileURL } from "url";
import { marked } from "marked";
import puppeteer from "puppeteer-core";
import { getChromeExecutablePath } from "./orgConfigUtils.js";
import { uxLog } from "./index.js";
import { t } from './i18n.js';

// Base stylesheet applied to generated PDF documents
// (kept identical to the md-to-pdf markdown.css historically used, MIT license)
const MARKDOWN_PDF_BASE_CSS = `* {
  box-sizing: border-box;
}
html {
  font-size: 100%;
}
body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell',
    'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  line-height: 1.6;
  font-size: 0.6875em; /* 11 pt */
  color: #111;
  margin: 0;
}
body > :first-child {
  padding-top: 0;
  margin-top: 0;
}
body > :last-child {
  margin-bottom: 0;
  padding-bottom: 0;
}
h1, h2, h3, h4, h5, h6 {
  margin: 0;
  padding: 0.5em 0 0.25em;
}
h5, h6 {
  padding: 0;
}
h5 {
  font-size: 1em;
}
h6 {
  font-size: 0.875em;
  text-transform: uppercase;
}
p {
  margin: 0.25em 0 1em;
}
blockquote {
  margin: 0.5em 0 1em;
  padding-left: 0.5em;
  padding-right: 1em;
  border-left: 4px solid gainsboro;
  font-style: italic;
}
ul, ol {
  margin: 0;
  margin-left: 1em;
  padding: 0 1.5em 0.5em;
}
pre {
  white-space: pre-wrap;
}
h1 code, h2 code, h3 code, h4 code, h5 code, h6 code, p code, li code, pre code {
  background-color: #f8f8f8;
  padding: 0.1em 0.375em;
  border: 1px solid #f8f8f8;
  border-radius: 0.25em;
  font-family: monospace;
  font-size: 1.2em;
}
pre code {
  display: block;
  padding: 0.5em;
}
.page-break {
  page-break-after: always;
}
img {
  max-width: 100%;
  margin: 1em 0;
}
table {
  border-spacing: 0;
  border-collapse: collapse;
  display: block;
  margin: 0 0 1em;
  width: 100%;
  overflow: auto;
}
table th, table td {
  padding: 0.5em 1em;
  border: 1px solid gainsboro;
}
table th {
  font-weight: 600;
}
table tr {
  background-color: white;
  border-top: 1px solid gainsboro;
}
table tr:nth-child(2n) {
  background-color: whitesmoke;
}`;

// Document-specific stylesheet historically passed to md-to-pdf
const MARKDOWN_PDF_DOC_CSS = `img {
  max-width: 60%;
  max-height: 20%;
  display: block;
  margin: 0 auto;
}
table {
  width: 100%;
  table-layout: auto;
  border-collapse: collapse;
}
th {
  background-color: #f0f0f0;
  padding: 4px 8px;
  white-space: nowrap;
}
td {
  padding: 4px 8px;
  white-space: normal;
  word-break: normal;
}`;

// PDF page setup matching the historical md-to-pdf defaults
const MARKDOWN_PDF_OPTIONS = {
  printBackground: true,
  format: 'a4' as const,
  margin: { top: '30mm', right: '40mm', bottom: '30mm', left: '20mm' },
};

// Converts markdown to a full standalone HTML document ready to be printed to PDF
export function buildHtmlFromMarkdown(markdownContent: string, options: { title?: string, extraCss?: string } = {}): string {
  const htmlBody = marked.parse(markdownContent, { gfm: true, async: false }) as string;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${options.title || ''}</title>
<style>
${MARKDOWN_PDF_BASE_CSS}
${MARKDOWN_PDF_DOC_CSS}
${options.extraCss || ''}
</style>
</head>
<body>
${htmlBody}
</body>
</html>
`;
}

export async function generatePdfFileFromMarkdown(markdownFile: string, options: { timeoutMs?: number, landscape?: boolean, extraCss?: string } = {}): Promise<string | false> {
  try {
    const outputPdfFile = markdownFile.replace('.md', '.pdf');
    const timeoutMs = options.timeoutMs || 120000;

    // No local Chrome/Chromium: degrade to a warning like any other PDF failure,
    // with an actionable message instead of a puppeteer launch crash
    const chromeExecutablePath = getChromeExecutablePath();
    if (!chromeExecutablePath) {
      uxLog("warning", this, c.yellow(t('errorGeneratingPdfFileFromDocumentationWith', { markdownFile, message: 'No Chrome/Chromium browser found. Install one or set PUPPETEER_EXECUTABLE_PATH' })));
      return false;
    }

    // Convert markdown to a standalone HTML document, written next to the markdown
    // file so relative image paths keep resolving through the file:// URL
    const markdownContent = await fs.readFile(markdownFile, 'utf8');
    const html = buildHtmlFromMarkdown(markdownContent, {
      title: path.basename(markdownFile, '.md'),
      extraCss: options.extraCss,
    });
    const tmpHtmlFile = markdownFile.replace('.md', '.tmp-pdf.html');
    await fs.writeFile(tmpHtmlFile, html, 'utf8');

    // Print the HTML document to PDF using the local Chrome/Chromium
    const browser = await puppeteer.launch({
      executablePath: chromeExecutablePath,
      timeout: timeoutMs,
      protocolTimeout: timeoutMs,
      args: [
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });
    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(timeoutMs);
      page.setDefaultTimeout(timeoutMs);
      await page.goto(pathToFileURL(tmpHtmlFile).href, { waitUntil: ['load', 'networkidle0'], timeout: timeoutMs });
      await page.pdf({
        path: outputPdfFile,
        ...MARKDOWN_PDF_OPTIONS,
        landscape: options.landscape === true,
        timeout: timeoutMs,
      });
    } finally {
      await browser.close();
      await fs.remove(tmpHtmlFile);
    }

    uxLog("success", this, c.green(t('pdfFileGeneratedFromDocumentation', { markdownFile, outputPdfFile: c.bold(outputPdfFile) })));
    return outputPdfFile;
  } catch (e: any) {
    uxLog("warning", this, c.yellow(t('errorGeneratingPdfFileFromDocumentationWith', { markdownFile, message: e.message })) + "\n" + c.grey(e.stack));
    return false;
  }
}

// Add a new line before each start of list of items starting by "-"
// If the previous line is already empty, do nothing
// Example before:
// Some line
// - item 1
// - item 2
// Example after:
// Some line
//
// - item 1
// - item 2
export function formatMarkdownForMkDocs(markdown: string): string {
  const lines = markdown.split("\n");
  const formattedLines = lines.map((line, index) => {
    if (line.trim().startsWith("-") && (index === 0 || lines[index - 1].trim() !== "")) {
      return "\n" + line;
    }
    return line;
  });
  const formattedMarkdown = formattedLines.join("\n");
  return formattedMarkdown;
}

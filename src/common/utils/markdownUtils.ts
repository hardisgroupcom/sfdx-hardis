import c from "chalk"
import puppeteer from "puppeteer";
import getPort from "get-port";
import { uxLog } from "./index.js";
import { t } from './i18n.js';

export async function generatePdfFileFromMarkdown(markdownFile: string, options: { timeoutMs?: number } = {}): Promise<string | false> {
  try {
    const outputPdfFile = markdownFile.replace('.md', '.pdf');
    const timeoutMs = options.timeoutMs || 120000;

    // md-to-pdf does not expose any way to control Puppeteer's page navigation timeout
    // (hardcoded to 30s in page.goto/waitForNavigation), causing crashes on large documents.
    // Workaround: replicate mdToPdf() logic but wrap the browser so every new page
    // gets a higher default navigation timeout before md-to-pdf uses it.
    const { convertMdToPdf } = await import('md-to-pdf/dist/lib/md-to-pdf.js');
    const { defaultConfig } = await import('md-to-pdf/dist/lib/config.js');
    const { serveDirectory, closeServer } = await import('md-to-pdf/dist/lib/serve-dir.js');
    const { getDir } = await import('md-to-pdf/dist/lib/helpers.js');

    const config: any = {
      dest: outputPdfFile,
      css: `img {
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
            }`,
      stylesheet_encoding: 'utf-8',
      port: await getPort(),
      basedir: getDir(markdownFile),
    };
    const mergedConfig = {
      ...defaultConfig,
      ...config,
      pdf_options: { ...defaultConfig.pdf_options, ...(config.pdf_options || {}) },
    };

    const server = await serveDirectory(mergedConfig);
    const browser = await puppeteer.launch({
      timeout: timeoutMs,
      protocolTimeout: timeoutMs,
      args: [
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });

    // Wrap browser.newPage so every page created by md-to-pdf gets the timeout
    const origNewPage = browser.newPage.bind(browser);
    browser.newPage = async () => {
      const page = await origNewPage();
      page.setDefaultNavigationTimeout(timeoutMs);
      page.setDefaultTimeout(timeoutMs);
      return page;
    };

    const pdf = await convertMdToPdf({ path: markdownFile }, mergedConfig, { browser });
    await browser.close();
    await closeServer(server);

    // Write PDF if convertMdToPdf returned content but dest wasn't handled
    if (pdf?.content && !pdf?.filename) {
      const fs = await import('fs-extra');
      await fs.writeFile(outputPdfFile, pdf.content);
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
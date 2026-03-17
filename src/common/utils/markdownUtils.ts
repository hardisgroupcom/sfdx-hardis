import c from "chalk"
import { uxLog } from "./index.js";
import { mdToPdf } from 'md-to-pdf';
import { t } from './i18n.js';

export async function generatePdfFileFromMarkdown(markdownFile: string): Promise<string | false> {
  try {
    const outputPdfFile = markdownFile.replace('.md', '.pdf');
    await mdToPdf({ path: markdownFile }, {
      dest: outputPdfFile,
      css: `img {
              max-width: 50%;
              max-height: 20%;
              display: block;
              margin: 0 auto;
            }`,
      stylesheet_encoding: 'utf-8'
    });
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
import c from "chalk"
import { uxLog } from "./index.js";
import { mdToPdf } from 'md-to-pdf';

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
    return outputPdfFile;
  } catch (e: any) {
    uxLog(this, c.yellow(`Error generating PDF file from ${markdownFile} documentation with CLI: ${e.message}`) + "\n" + c.grey(e.stack));
    return false;
  }
}
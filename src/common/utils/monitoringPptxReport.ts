import * as path from 'path';
import fs from 'fs-extra';
import c from 'chalk';
import { uxLog } from './index.js';
import { t } from './i18n.js';
import { CodingAgentProvider } from '../aiProvider/codingAgentProvider.js';
import { buildPromptFromTemplate } from '../aiProvider/promptTemplates.js';

/**
 * Generate a PowerPoint monitoring report using a coding agent.
 *
 * The agent receives a structured prompt with monitoring data and a fixed
 * slide structure, then generates the .pptx file using pptxgenjs.
 *
 * Returns the path to the generated .pptx file, or null if generation fails.
 */
export async function generateMonitoringPptxReport(
  notifications: any[],
  aiSummary: string | null,
  orgUrl: string,
  reportDir: string,
): Promise<string | null> {
  uxLog("action", null, c.cyan(t('monitoringPptxReportGenerating')));

  const date = new Date().toISOString().split('T')[0];
  const fileName = `MonitoringReport_${date}.pptx`;
  const filePath = path.resolve(reportDir, fileName);
  await fs.ensureDir(reportDir);

  const prompt = await buildPromptFromTemplate("PROMPT_MONITORING_PPTX_REPORT", {
    NOTIFICATIONS_JSON: JSON.stringify(notifications),
    AI_SUMMARY: aiSummary || "No AI summary available.",
    ORG_URL: orgUrl,
    DATE: date,
    OUTPUT_FILE_PATH: filePath,
  });

  const runResult = await CodingAgentProvider.runPrompt(prompt);
  if (!runResult) {
    uxLog("warning", null, c.yellow(t('monitoringPptxNoCodingAgent')));
    return null;
  }

  if (await fs.pathExists(filePath)) {
    uxLog("success", null, c.green(t('monitoringPptxReportGenerated', { filePath })));
    return filePath;
  }

  uxLog("warning", null, c.yellow(t('monitoringPptxReportFailed', { message: 'Agent did not produce the expected file' })));
  return null;
}

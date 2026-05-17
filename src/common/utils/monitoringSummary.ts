import c from 'chalk';
import { AiProvider } from '../aiProvider/index.js';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';

// Slack section blocks reject text over 3000 chars. The prompt asks for <2800; this is a backstop.
const MONITORING_SUMMARY_MAX_LEN = 2800;

/**
 * Generate an AI-powered summary of monitoring notifications.
 * Returns the markdown summary string, or null if AI fails.
 */
export async function generateMonitoringAiSummary(
  notifications: any[],
  orgUrl: string,
): Promise<string | null> {
  try {
    uxLog("action", null, c.cyan(t('monitoringAiSummaryStarting')));
    const sanitizedJson = JSON.stringify(notifications);
    const prompt = await AiProvider.buildPrompt("PROMPT_MONITORING_SUMMARY", {
      NOTIFICATIONS_JSON: sanitizedJson,
      ORG_URL: orgUrl,
    });
    const aiResponse = await AiProvider.promptAi(prompt, "PROMPT_MONITORING_SUMMARY");
    if (aiResponse?.success && aiResponse.promptResponse) {
      uxLog("success", null, c.green(t('monitoringAiSummaryGenerated')));
      uxLog("log", null, c.grey(`[AI Summary]\n${aiResponse.promptResponse}`));
      let summary = aiResponse.promptResponse;
      if (summary.length > MONITORING_SUMMARY_MAX_LEN) {
        uxLog(
          "warning",
          null,
          c.yellow(`[MonitoringSummary] AI summary exceeded ${MONITORING_SUMMARY_MAX_LEN} chars (${summary.length}); truncating to fit Slack's 3000-char block limit.`),
        );
        const suffix = "\n...(truncated)";
        summary = summary.slice(0, MONITORING_SUMMARY_MAX_LEN - suffix.length).trimEnd() + suffix;
      }
      return summary;
    }
    uxLog("warning", null, c.yellow(t('monitoringAiSummaryFailed', { message: 'No response from AI provider' })));
    return null;
  } catch (e) {
    uxLog("warning", null, c.yellow(t('monitoringAiSummaryFailed', { message: (e as Error).message })));
    return null;
  }
}

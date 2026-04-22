import c from 'chalk';
import { AiProvider } from '../aiProvider/index.js';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';

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
      return aiResponse.promptResponse;
    }
    uxLog("warning", null, c.yellow(t('monitoringAiSummaryFailed', { message: 'No response from AI provider' })));
    return null;
  } catch (e) {
    uxLog("warning", null, c.yellow(t('monitoringAiSummaryFailed', { message: (e as Error).message })));
    return null;
  }
}

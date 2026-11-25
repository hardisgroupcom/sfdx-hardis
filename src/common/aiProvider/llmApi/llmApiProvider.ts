import c from "chalk";
import { AiResponse } from "../index.js";
import { AiProviderRoot } from "../aiProviderRoot.js";
import { PromptTemplate } from "../promptTemplates.js";
import { uxLog } from "../../utils/index.js";
import { t } from "../../utils/i18n.js";
import { LlmApiSettings, resolveExplicitLlmSettings, resolveOpenAiShortcutSettings } from "./llmApiConfig.js";
import { LlmClient } from "./llmClientBase.js";
import { createLlmClient } from "./llmClientFactory.js";

/**
 * Where the settings of the LLM API come from:
 * - "explicit": AI_LLM_PROVIDER / AI_LLM_MODEL (or their former LANGCHAIN_LLM_* names)
 * - "openaiShortcut": OPENAI_API_KEY alone, or an OpenAI gateway
 */
export type LlmApiSettingsSource = "explicit" | "openaiShortcut";

/** Calls an LLM API (OpenAI, Anthropic, Google Gemini, Ollama) over plain HTTP */
export class LlmApiProvider extends AiProviderRoot {
  private readonly client: LlmClient;
  private readonly settings: LlmApiSettings;

  private constructor(settings: LlmApiSettings) {
    super();
    this.settings = settings;
    this.client = createLlmClient(settings.provider, settings);
  }

  public static async isConfigured(source: LlmApiSettingsSource): Promise<boolean> {
    return (await this.resolveSettings(source)) != null;
  }

  public static async create(source: LlmApiSettingsSource): Promise<LlmApiProvider> {
    const settings = await this.resolveSettings(source);
    if (!settings) {
      throw new Error("LLM API provider is not properly configured");
    }
    return new LlmApiProvider(settings);
  }

  public getLabel(): string {
    return `${this.client.getLabel()} connector`;
  }

  public getSettings(): LlmApiSettings {
    return this.settings;
  }

  public async promptAi(promptText: string, template: PromptTemplate | null = null): Promise<AiResponse | null> {
    const label = this.client.getLabel();
    if (!this.checkAndWarnMaxAiCalls(label)) {
      return null;
    }
    const modelName = this.settings.modelName;
    const templateText = template ? ' using template ' + template : '';
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey(`[${label}] ` + t('llmRequestingPromptDebug', { modelName, template: templateText, promptText })));
    } else {
      uxLog("log", this, c.grey(`[${label}] ` + t('llmRequestingPrompt', { modelName, template: templateText })));
    }
    this.incrementAiCallsNumber();
    // An error is thrown to AiProvider.promptAi, which logs it and retries once after a tokens per minute limit
    const completion = await this.client.complete(promptText);
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey(`[${label}] ` + t('llmReceivedResponseDebug', { modelName: completion.model, response: JSON.stringify(completion, null, 2) })));
    } else {
      uxLog("log", this, c.grey(`[${label}] ` + t('llmReceivedResponse', { modelName: completion.model })));
    }
    const aiResponse: AiResponse = { success: false, model: completion.model || modelName };
    if (completion.text) {
      aiResponse.success = true;
      aiResponse.promptResponse = completion.text;
    } else if (completion.emptyReason) {
      uxLog("warning", this, c.yellow(`[${label}] ` + t('llmEmptyResponse', { reason: completion.emptyReason })));
    }
    return aiResponse;
  }

  private static async resolveSettings(source: LlmApiSettingsSource): Promise<LlmApiSettings | null> {
    return source === "openaiShortcut" ? resolveOpenAiShortcutSettings() : resolveExplicitLlmSettings();
  }
}

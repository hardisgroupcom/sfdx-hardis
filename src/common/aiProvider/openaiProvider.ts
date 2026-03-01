import { OpenAI } from "openai";
import { AiResponse } from "./index.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import c from "chalk";
import { uxLog } from "../utils/index.js";
import { PromptTemplate } from "./promptTemplates.js";
import { getEnvVar } from "../../config/index.js";
import { resolveBooleanFlag } from "./providerConfigUtils.js";
import { t } from '../utils/i18n.js';

export class OpenAiProvider extends AiProviderRoot {
  protected openai: OpenAI;
  private modelName: string;

  private constructor(modelName: string) {
    super();
    this.modelName = modelName || "gpt-4o-mini";
    this.openai = new OpenAI();
  }

  public getLabel(): string {
    return "OpenAi connector";
  }

  public static async isConfigured(): Promise<boolean> {
    const config = await this.resolveConfig();
    return config != null;
  }

  public static async create(): Promise<OpenAiProvider> {
    const config = await this.resolveConfig();
    if (!config) {
      throw new Error("OpenAI provider is not properly configured");
    }
    return new OpenAiProvider(config.modelName);
  }

  private static async resolveConfig(): Promise<OpenAiResolvedConfig | null> {
    if (!getEnvVar("OPENAI_API_KEY")) {
      return null;
    }
    const { enabled, rootConfig } = await resolveBooleanFlag({
      envVar: "USE_OPENAI_DIRECT",
      configKey: "useOpenaiDirect",
      defaultValue: true,
    });
    if (!enabled) {
      return null;
    }
    const modelName = getEnvVar("OPENAI_MODEL")
      || rootConfig.openaiModel
      || rootConfig.OPENAI_MODEL
      || "gpt-4o-mini";
    return { modelName };
  }

  public async promptAi(promptText: string, template: PromptTemplate | null = null): Promise<AiResponse | null> {
    if (!this.checkAndWarnMaxAiCalls("OpenAi")) {
      return null;
    }
    const gptModel = this.modelName;
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey(t('openaiRequestingPromptDebug', { modelName: gptModel, template: template ? ' using template ' + template : '', promptText })));
    }
    else {
      uxLog("log", this, c.grey(t('openaiRequestingPrompt', { modelName: gptModel, template: template ? ' using template ' + template : '' })));
    }
    this.incrementAiCallsNumber();
    const completion = await this.openai.chat.completions.create({
      messages: [{ role: "system", content: promptText }],
      model: gptModel,
    });
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey(t('openaiReceivedResponseDebug', { modelName: gptModel, response: JSON.stringify(completion, null, 2) })));
    }
    else {
      uxLog("log", this, c.grey(t('openaiReceivedResponse', { modelName: gptModel })));
    }
    const aiResponse: AiResponse = {
      success: false,
      model: completion.model,
    };
    if (completion?.choices?.length > 0) {
      aiResponse.success = true;
      aiResponse.promptResponse = completion.choices[0].message.content ?? undefined;
    }
    return aiResponse;
  }
}

interface OpenAiResolvedConfig {
  modelName: string;
}

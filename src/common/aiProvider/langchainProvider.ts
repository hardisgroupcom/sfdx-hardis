import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AiResponse } from "./index.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import c from "chalk";
import { uxLog } from "../utils/index.js";
import { PromptTemplate } from "./promptTemplates.js";
import { LangChainProviderFactory } from "./langChainProviders/langChainProviderFactory.js";
import { ModelConfig, ProviderType } from "./langChainProviders/langChainBaseProvider.js";
import { getConfig, getEnvVar } from "../../config/index.js";

export class LangChainProvider extends AiProviderRoot {
  private model: BaseChatModel;
  private modelName: string;

  private constructor(options: LangChainResolvedConfig) {
    super();
    if (!options.provider) {
      throw new Error("LangChain provider must be defined (ex: openai, anthropic, google-genai, ollama)");
    }
    if (!options.modelName) {
      throw new Error("LangChain model must be defined to use LangChain integration");
    }

    this.modelName = options.modelName;
    const providerType = options.provider.toLowerCase() as ProviderType;

    // Common configuration for all providers
    const config: ModelConfig = {
      temperature: options.temperature,
      timeout: options.timeout,
      maxTokens: options.maxTokens,
      maxRetries: options.maxRetries,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey
    };

    const llmProvider = LangChainProviderFactory.createProvider(providerType, this.modelName, config);
    this.model = llmProvider.getModel();
  }

  public static async isConfigured(): Promise<boolean> {
    const options = await this.resolveConfig();
    return options != null;
  }

  public static async create(): Promise<LangChainProvider> {
    const options = await this.resolveConfig();
    if (!options) {
      throw new Error("LangChain provider is not properly configured");
    }
    return new LangChainProvider(options);
  }

  private static async resolveConfig(): Promise<LangChainResolvedConfig | null> {
    const projectConfig = await getConfig('user');
    const langchainConfig = projectConfig?.ai?.langchain || {};
    const provider = getEnvVar("LANGCHAIN_LLM_PROVIDER") || langchainConfig.provider;
    const modelName = getEnvVar("LANGCHAIN_LLM_MODEL") || langchainConfig.modelName;
    const enabled = this.parseBoolean(getEnvVar("USE_LANGCHAIN_LLM"), langchainConfig.enabled, provider && modelName);

    if (!enabled || !provider || !modelName) {
      return null;
    }

    return {
      provider,
      modelName,
      temperature: this.parseNumber(getEnvVar("LANGCHAIN_LLM_TEMPERATURE"), langchainConfig.temperature),
      timeout: this.parseNumber(getEnvVar("LANGCHAIN_LLM_TIMEOUT"), langchainConfig.timeout),
      maxTokens: this.parseNumber(getEnvVar("LANGCHAIN_LLM_MAX_TOKENS"), langchainConfig.maxTokens),
      maxRetries: this.parseNumber(getEnvVar("LANGCHAIN_LLM_MAX_RETRIES"), langchainConfig.maxRetries),
      baseUrl: getEnvVar("LANGCHAIN_LLM_BASE_URL") || langchainConfig.baseUrl,
      apiKey: getEnvVar("LANGCHAIN_LLM_MODEL_API_KEY") || undefined,
    };
  }

  private static parseBoolean(envValue: string | null, configValue?: boolean, fallback?: boolean): boolean {
    if (envValue != null) {
      const normalized = envValue.toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }
    if (configValue !== undefined) {
      return configValue;
    }
    return Boolean(fallback);
  }

  private static parseNumber(envValue: string | null, configValue?: number): number | undefined {
    if (envValue != null) {
      const parsed = Number(envValue);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return configValue;
  }

  public getLabel(): string {
    return "LangChain connector";
  }

  public async promptAi(promptText: string, template: PromptTemplate | null = null): Promise<AiResponse | null> {
    // re-use the same check for max ai calls number as in the original openai provider implementation
    if (!this.checkMaxAiCallsNumber()) {
      const maxCalls = this.getAiMaxCallsNumber();
      uxLog("warning", this, c.yellow(`[LangChain] Already performed maximum ${maxCalls} calls. Increase it by defining AI_MAXIMUM_CALL_NUMBER env variable`));
      return null;
    }

    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey(`[LangChain] Requesting the following prompt to ${this.modelName}${template ? ' using template ' + template : ''}:\n${promptText}`));
    } else {
      uxLog("log", this, c.grey(`[LangChain] Requesting prompt to ${this.modelName}${template ? ' using template ' + template : ''} (define DEBUG_PROMPTS=true to see details)`));
    }

    this.incrementAiCallsNumber();

    try {
      const response = await this.model.invoke([
        {
          role: "user",
          content: promptText
        }
      ]);

      if (process.env?.DEBUG_PROMPTS === "true") {
        uxLog("log", this, c.grey("[LangChain] Received prompt response\n" + JSON.stringify(response, null, 2)));
      } else {
        uxLog("log", this, c.grey("[LangChain] Received prompt response"));
      }

      const aiResponse: AiResponse = {
        success: false,
        model: this.modelName,
      };

      if (response.content) {
        aiResponse.success = true;
        aiResponse.promptResponse = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      }

      return aiResponse;
    } catch (error: unknown) {
      if (error instanceof Error) {
        uxLog("error", this, c.red(`[LangChain] Error while calling LLM API: ${error.message}`));
      } else {
        uxLog("error", this, c.red(`[LangChain] Unexpected error occurred`));
      }
      return null;
    }
  }
}

interface LangChainResolvedConfig {
  provider: string;
  modelName: string;
  temperature?: number;
  timeout?: number;
  maxTokens?: number;
  maxRetries?: number;
  baseUrl?: string;
  apiKey?: string;
}
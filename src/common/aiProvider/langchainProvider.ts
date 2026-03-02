import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AiResponse } from "./index.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import c from "chalk";
import { uxLog } from "../utils/index.js";
import { PromptTemplate } from "./promptTemplates.js";
import { LangChainProviderFactory } from "./langChainProviders/langChainProviderFactory.js";
import { ModelConfig, ProviderType } from "./langChainProviders/langChainBaseProvider.js";
import { getConfig, getEnvVar } from "../../config/index.js";
import { t } from '../utils/i18n.js';

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
    const projectConfig = await getConfig('user', { cache: true });
    const rootConfig = projectConfig || {};
    const provider = getEnvVar("LANGCHAIN_LLM_PROVIDER") || rootConfig.langchainLlmProvider || rootConfig.LANGCHAIN_LLM_PROVIDER;
    const modelName = getEnvVar("LANGCHAIN_LLM_MODEL") || rootConfig.langchainLlmModel || rootConfig.LANGCHAIN_LLM_MODEL;
    const configEnabled = typeof rootConfig.useLangchainLlm === "boolean"
      ? rootConfig.useLangchainLlm
      : (typeof rootConfig.USE_LANGCHAIN_LLM === "boolean" ? rootConfig.USE_LANGCHAIN_LLM : undefined);
    const enabled = this.parseBoolean(getEnvVar("USE_LANGCHAIN_LLM"), configEnabled, provider && modelName);

    if (!enabled || !provider || !modelName) {
      return null;
    }

    return {
      provider,
      modelName,
      temperature: this.parseNumber(
        getEnvVar("LANGCHAIN_LLM_TEMPERATURE"),
        rootConfig.langchainLlmTemperature ?? rootConfig.LANGCHAIN_LLM_TEMPERATURE
      ),
      timeout: this.parseNumber(
        getEnvVar("LANGCHAIN_LLM_TIMEOUT"),
        rootConfig.langchainLlmTimeout ?? rootConfig.LANGCHAIN_LLM_TIMEOUT
      ),
      maxTokens: this.parseNumber(
        getEnvVar("LANGCHAIN_LLM_MAX_TOKENS"),
        rootConfig.langchainLlmMaxTokens ?? rootConfig.LANGCHAIN_LLM_MAX_TOKENS
      ),
      maxRetries: this.parseNumber(
        getEnvVar("LANGCHAIN_LLM_MAX_RETRIES"),
        rootConfig.langchainLlmMaxRetries ?? rootConfig.LANGCHAIN_LLM_MAX_RETRIES
      ),
      baseUrl: getEnvVar("LANGCHAIN_LLM_BASE_URL") || rootConfig.langchainLlmBaseUrl || rootConfig.LANGCHAIN_LLM_BASE_URL,
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
    if (!this.checkAndWarnMaxAiCalls("LangChain")) {
      return null;
    }

    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey('[LangChain] ' + t('langchainRequestingPromptDebug', { modelName: this.modelName, template: template ? ' using template ' + template : '', promptText })));
    } else {
      uxLog("log", this, c.grey('[LangChain] ' + t('langchainRequestingPrompt', { modelName: this.modelName, template: template ? ' using template ' + template : '' })));
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
        uxLog("log", this, c.grey('[LangChain] ' + t('langchainReceivedResponseDebug', { response: JSON.stringify(response, null, 2) })));
      } else {
        uxLog("log", this, c.grey('[LangChain] ' + t('langchainReceivedResponse')));
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
        uxLog("error", this, c.red('[LangChain] ' + t('langchainErrorCallingLLM', { message: error.message })));
      } else {
        uxLog("error", this, c.red('[LangChain] ' + t('langchainUnexpectedError')));
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
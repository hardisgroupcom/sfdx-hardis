import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AiResponse } from "./index.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import c from "chalk";
import { uxLog } from "../utils/index.js";
import { PromptTemplate } from "./promptTemplates.js";
import { getEnvVar } from "../../config/index.js";
import { LangChainProviderFactory } from "./langChainProviders/langChainProviderFactory.js";
import { ModelConfig, ProviderType } from "./langChainProviders/langChainBaseProvider.js";

export class LangChainProvider extends AiProviderRoot {
  private model: BaseChatModel;
  private modelName: string;

  constructor() {
    super();
    const provider = getEnvVar("LANGCHAIN_LLM_PROVIDER");
    if (!provider) {
      throw new Error("LANGCHAIN_LLM_PROVIDER environment variable must be set to use LangChain integration");
    }

    const providerType = provider.toLowerCase() as ProviderType;
    const modelName = getEnvVar("LANGCHAIN_LLM_MODEL");
    const apiKey = getEnvVar("LANGCHAIN_LLM_MODEL_API_KEY");

    if (!modelName) {
      throw new Error("LANGCHAIN_LLM_MODEL environment variable must be set to use LangChain integration");
    }

    this.modelName = modelName;

    // Common configuration for all providers
    const config: ModelConfig = {
      temperature: Number(getEnvVar("LANGCHAIN_LLM_TEMPERATURE")) || undefined,
      timeout: Number(getEnvVar("LANGCHAIN_LLM_TIMEOUT")) || undefined,
      maxTokens: Number(getEnvVar("LANGCHAIN_LLM_MAX_TOKENS")) || undefined,
      maxRetries: Number(getEnvVar("LANGCHAIN_LLM_MAX_RETRIES")) || undefined,
      baseUrl: getEnvVar("LANGCHAIN_LLM_BASE_URL") || undefined,
      apiKey: apiKey || undefined
    };

    // factory pattern so that adding support for new providers is easy in the future
    const llmProvider = LangChainProviderFactory.createProvider(providerType, modelName, config);
    this.model = llmProvider.getModel();
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
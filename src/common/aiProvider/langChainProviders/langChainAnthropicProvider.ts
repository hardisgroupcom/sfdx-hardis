import { ChatAnthropic } from "@langchain/anthropic";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AbstractLLMProvider, ModelConfig } from "./langChainBaseProvider.js";

export class LangChainAnthropicProvider extends AbstractLLMProvider {
  constructor(modelName: string, config: ModelConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required for Anthropic provider. Define it in a secured env var LANGCHAIN_LLM_MODEL_API_KEY");
    }
    super(modelName, config);
    this.model = this.getModel();
  }

  getModel(): BaseChatModel {
    const config = {
      modelName: this.modelName,
      anthropicApiKey: this.config.apiKey!,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      maxRetries: this.config.maxRetries
    };

    return new ChatAnthropic(config) as BaseChatModel;
  }
} 
import { ChatAnthropic } from "@langchain/anthropic";
import { AbstractLLMProvider, ModelConfig, SupportedModel } from "./langChainBaseProvider.js";

export class LangChainAnthropicProvider extends AbstractLLMProvider {
  constructor(modelName: string, config: ModelConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required for Anthropic provider. Define it in a secured env var LANGCHAIN_LLM_MODEL_API_KEY");
    }
    super(modelName, config);
    this.model = this.getModel();
  }

  getModel(): SupportedModel {
    const config = {
      model: this.modelName,
      apiKey: this.config.apiKey!,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      maxRetries: this.config.maxRetries
    };

    return new ChatAnthropic(config);
  }
} 
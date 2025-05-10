import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AbstractLLMProvider, ModelConfig } from "./langChainBaseProvider.js";

export class LangChainGoogleGenAiProvider extends AbstractLLMProvider {
  constructor(modelName: string, config: ModelConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required for Google GenAI provider. Define it in a secured env var LANGCHAIN_LLM_MODEL_API_KEY");
    }
    super(modelName, config);
    this.model = this.getModel();
  }

  getModel(): BaseChatModel {
    const config = {
      model: this.modelName,
      apiKey: this.config.apiKey!,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      maxRetries: this.config.maxRetries
    };

    return new ChatGoogleGenerativeAI(config) as BaseChatModel;
  }
} 
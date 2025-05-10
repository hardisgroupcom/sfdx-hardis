import { ChatOllama } from "@langchain/ollama";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AbstractLLMProvider, ModelConfig } from "./langChainBaseProvider.js";

export class LangChainOllamaProvider extends AbstractLLMProvider {
  constructor(modelName: string, config: ModelConfig) {
    super(modelName, config);
    this.model = this.getModel();
  }

  getModel(): BaseChatModel {
    return new ChatOllama({
      model: this.modelName,
      baseUrl: this.config.baseUrl || "http://localhost:11434",
      temperature: this.config.temperature,
      maxRetries: this.config.maxRetries
    });
  }
} 
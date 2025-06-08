import { ChatOllama } from "@langchain/ollama";
import { AbstractLLMProvider, ModelConfig, SupportedModel } from "./langChainBaseProvider.js";

export class LangChainOllamaProvider extends AbstractLLMProvider {
  constructor(modelName: string, config: ModelConfig) {
    super(modelName, config);
    this.model = this.getModel();
  }

  getModel(): SupportedModel {
    const config = {
      model: this.modelName,
      baseUrl: this.config.baseUrl || "http://localhost:11434",
      temperature: this.config.temperature,
      maxRetries: this.config.maxRetries
    };

    return new ChatOllama(config);
  }
} 
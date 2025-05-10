import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface ModelConfig {
  temperature?: number;
  timeout?: number;
  maxTokens?: number;
  maxRetries?: number;
  baseUrl?: string;
  apiKey?: string;
}

export type ProviderType = "ollama" | "openai" | "anthropic";

export interface BaseLLMProvider {
  getModel(): BaseChatModel;
  getModelName(): string;
  getLabel(): string;
}

export abstract class AbstractLLMProvider implements BaseLLMProvider {
  protected model: BaseChatModel;
  protected modelName: string;
  protected config: ModelConfig;

  constructor(modelName: string, config: ModelConfig) {
    this.modelName = modelName;
    this.config = config;
  }

  abstract getModel(): BaseChatModel;
  
  getModelName(): string {
    return this.modelName;
  }

  getLabel(): string {
    return "LangChain connector";
  }
} 
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LLM } from "@langchain/core/language_models/llms";

export interface ModelConfig {
  temperature?: number;
  timeout?: number;
  maxTokens?: number;
  maxRetries?: number;
  baseUrl?: string;
  apiKey?: string;
}

export type ProviderType = "ollama" | "openai" | "anthropic" | "google-genai" | "huggingface";

// Union type to support both chat models and LLMs
export type SupportedModel = BaseChatModel | LLM;

export interface BaseLLMProvider {
  getModel(): SupportedModel;
  getModelName(): string;
  getLabel(): string;
}

export abstract class AbstractLLMProvider implements BaseLLMProvider {
  protected model: SupportedModel;
  protected modelName: string;
  protected config: ModelConfig;

  constructor(modelName: string, config: ModelConfig) {
    this.modelName = modelName;
    this.config = config;
  }

  abstract getModel(): SupportedModel;

  getModelName(): string {
    return this.modelName;
  }

  getLabel(): string {
    return "LangChain connector";
  }
}
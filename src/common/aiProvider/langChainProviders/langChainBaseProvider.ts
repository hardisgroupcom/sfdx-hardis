import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface ModelConfig {
  temperature?: number;
  timeout?: number;
  maxTokens?: number;
  maxRetries?: number;
  baseUrl?: string;
  apiKey?: string;
}

export type ProviderType = "ollama" | "openai" | "anthropic" | "google-genai";

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

/**
 * Information about the coding agent CLI associated with a LangChain provider.
 * Each LangChain sub-provider can expose this via a static getCodingAgentInfo() method.
 */
export interface CodingAgentInfo {
  /** The coding agent type identifier (e.g. "claude", "codex-cli", "gemini-cli") */
  agentType: string;
  /** The CLI command name used for availability checks (e.g. "claude", "codex", "gemini") */
  command: string;
  /** The environment variable name the coding agent CLI uses for authentication, or null */
  apiKeyEnvVar: string | null;
  /** Set the coding agent CLI's API key env var, reusing the LangChain API key */
  setupApiKey(langchainApiKey: string | null): void;
  /** Build the full CLI command string to invoke the agent with the given escaped prompt */
  buildCommand(escapedPrompt: string): string;
}
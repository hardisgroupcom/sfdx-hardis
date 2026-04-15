import { BaseLLMProvider, CodingAgentInfo, ModelConfig, ProviderType } from "./langChainBaseProvider.js";
import { LangChainOllamaProvider } from "./langChainOllamaProvider.js";
import { LangChainOpenAIProvider } from "./langChainOpenAIProvider.js";
import { LangChainAnthropicProvider } from "./langChainAnthropicProvider.js";
import { LangChainGoogleGenAiProvider } from "./langChainGoogleGenAi.js";

const ALL_PROVIDERS = ["ollama", "openai", "anthropic", "google-genai"];

export class LangChainProviderFactory {
  static createProvider(providerType: ProviderType, modelName: string, config: ModelConfig): BaseLLMProvider {
    switch (providerType.toLowerCase()) {
      case "ollama":
        return new LangChainOllamaProvider(modelName, config);
      case "openai":
        return new LangChainOpenAIProvider(modelName, config);
      case "anthropic":
        return new LangChainAnthropicProvider(modelName, config);
      case "google-genai":
        return new LangChainGoogleGenAiProvider(modelName, config);
      default:
        throw new Error(`Unsupported LLM provider: ${providerType}. Supported providers are: ${ALL_PROVIDERS.join(", ")}`);
    }
  }

  /**
   * Get the coding agent info for a given LangChain provider type.
   * Returns null if the provider has no associated coding agent CLI.
   */
  static getCodingAgentInfo(providerType: string): CodingAgentInfo | null {
    switch (providerType.toLowerCase()) {
      case "anthropic":
        return LangChainAnthropicProvider.getCodingAgentInfo();
      case "google-genai":
        return LangChainGoogleGenAiProvider.getCodingAgentInfo();
      case "openai":
        return LangChainOpenAIProvider.getCodingAgentInfo();
      case "ollama":
        return LangChainOllamaProvider.getCodingAgentInfo();
      default:
        return null;
    }
  }
} 
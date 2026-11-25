import { LLM_PROVIDER_TYPES, LlmClient, LlmClientConfig } from "./llmClientBase.js";
import { OpenAiClient } from "./clients/openAiClient.js";
import { AnthropicClient } from "./clients/anthropicClient.js";
import { GoogleGenAiClient } from "./clients/googleGenAiClient.js";
import { OllamaClient } from "./clients/ollamaClient.js";

/** The client of the LLM API named by AI_LLM_PROVIDER, checked for the credentials it needs */
export function createLlmClient(provider: string, config: LlmClientConfig): LlmClient {
  switch ((provider || "").toLowerCase()) {
    case "openai": {
      const hasGatewayAuth = config.baseUrl && config.defaultHeaders && Object.keys(config.defaultHeaders).length > 0;
      if (!config.apiKey && !hasGatewayAuth) {
        throw new Error(
          "OpenAI provider requires either an API key (AI_LLM_API_KEY) " +
          "or a base URL with default headers (AI_LLM_BASE_URL + AI_LLM_DEFAULT_HEADERS) for gateway authentication."
        );
      }
      return new OpenAiClient(config);
    }
    case "anthropic":
      if (!config.apiKey) {
        throw new Error("API key is required for Anthropic provider. Define it in a secured env var AI_LLM_API_KEY");
      }
      return new AnthropicClient(config);
    case "google-genai":
      if (!config.apiKey) {
        throw new Error("API key is required for Google GenAI provider. Define it in a secured env var AI_LLM_API_KEY");
      }
      return new GoogleGenAiClient(config);
    case "ollama":
      return new OllamaClient(config);
    default:
      throw new Error(`Unsupported LLM provider: ${provider}. Supported providers are: ${LLM_PROVIDER_TYPES.join(", ")}`);
  }
}

import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AbstractLLMProvider, CodingAgentInfo, CodingAgentOptions, ModelConfig } from "./langChainBaseProvider.js";
import { getEnvVar } from "../../../config/index.js";

export class LangChainOpenAIProvider extends AbstractLLMProvider {
  constructor(modelName: string, config: ModelConfig) {
    const hasGatewayAuth = config.baseUrl && config.defaultHeaders && Object.keys(config.defaultHeaders).length > 0;
    if (!config.apiKey && !hasGatewayAuth) {
      throw new Error(
        "OpenAI provider requires either an API key (LANGCHAIN_LLM_MODEL_API_KEY) " +
        "or a base URL with default headers (LANGCHAIN_LLM_BASE_URL + LANGCHAIN_LLM_DEFAULT_HEADERS) for gateway authentication."
      );
    }
    super(modelName, config);
    this.model = this.getModel();
  }

  getModel(): BaseChatModel {
    const config: Record<string, unknown> = {
      modelName: this.modelName,
      openAIApiKey: this.config.apiKey || "",
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      maxRetries: this.config.maxRetries,
    };

    const clientConfig: Record<string, unknown> = {};
    if (this.config.baseUrl) {
      clientConfig.baseURL = this.config.baseUrl;
    }
    if (this.config.defaultHeaders) {
      clientConfig.defaultHeaders = this.config.defaultHeaders;
    }
    if (Object.keys(clientConfig).length > 0) {
      config.configuration = clientConfig;
    }

    return new ChatOpenAI(config) as BaseChatModel;
  }

  static getCodingAgentInfo(): CodingAgentInfo {
    const GATEWAY_PROVIDER_ID = "sfdx-hardis-gateway";

    return {
      agentType: "codex-cli",
      command: "codex",
      apiKeyEnvVar: "OPENAI_API_KEY",
      setupApiKey(langchainApiKey: string | null): void {
        if (!process.env.OPENAI_API_KEY && !process.env.CODEX_API_KEY && langchainApiKey) {
          process.env.OPENAI_API_KEY = langchainApiKey;
        }
        const baseUrl = getEnvVar("LANGCHAIN_LLM_BASE_URL");
        if (baseUrl && !process.env.OPENAI_BASE_URL) {
          process.env.OPENAI_BASE_URL = baseUrl;
        }
        const headersRaw = getEnvVar("LANGCHAIN_LLM_DEFAULT_HEADERS");
        if (headersRaw && !process.env.OPENAI_API_KEY && !process.env.CODEX_API_KEY) {
          process.env.OPENAI_API_KEY = "";
        }
      },
      buildCommand(promptFilePath: string, options?: CodingAgentOptions): string {
        let modelFlag = options?.model ? ` --model ${options.model}` : "";
        let configFlags = "";

        const headersRaw = getEnvVar("LANGCHAIN_LLM_DEFAULT_HEADERS")
          || getEnvVar("CODEX_DEFAULT_HEADERS")
          || getEnvVar("OPENAI_DEFAULT_HEADERS");
        if (headersRaw) {
          try {
            const headers: Record<string, string> = JSON.parse(headersRaw);
            const baseUrl = getEnvVar("LANGCHAIN_LLM_BASE_URL")
              || getEnvVar("CODEX_BASE_URL")
              || getEnvVar("OPENAI_BASE_URL")
              || "https://api.openai.com/v1";

            configFlags += ` --config model_providers.${GATEWAY_PROVIDER_ID}.base_url=${baseUrl}`;
            configFlags += ` --config model_providers.${GATEWAY_PROVIDER_ID}.wire_api=responses`;
            for (const [key, value] of Object.entries(headers)) {
              configFlags += ` --config model_providers.${GATEWAY_PROVIDER_ID}.http_headers.${key}=${value}`;
            }

            const modelName = options?.model || "";
            if (modelName && !modelName.includes("/")) {
              modelFlag = ` --model ${GATEWAY_PROVIDER_ID}/${modelName}`;
            } else if (!modelName) {
              modelFlag = ` --model ${GATEWAY_PROVIDER_ID}/gpt-4o`;
            }
          } catch {
            // Invalid JSON — fall through without config flags
          }
        }

        return `cat "${promptFilePath}" | codex${modelFlag}${configFlags} --approval-mode full-auto -q -`;
      },
    };
  }
}
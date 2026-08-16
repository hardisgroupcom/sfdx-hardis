import { ChatAnthropic } from "@langchain/anthropic";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AbstractLLMProvider, CodingAgentInfo, CodingAgentOptions, ModelConfig } from "./langChainBaseProvider.js";

export class LangChainAnthropicProvider extends AbstractLLMProvider {
  constructor(modelName: string, config: ModelConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required for Anthropic provider. Define it in a secured env var LANGCHAIN_LLM_MODEL_API_KEY");
    }
    super(modelName, config);
    this.model = this.getModel();
  }

  getModel(): BaseChatModel {
    const config = {
      modelName: this.modelName,
      anthropicApiKey: this.config.apiKey!,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      maxRetries: this.config.maxRetries
    };

    return new ChatAnthropic(config) as BaseChatModel;
  }

  static getCodingAgentInfo(): CodingAgentInfo {
    return {
      agentType: "claude",
      command: "claude",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      setupApiKey(langchainApiKey: string | null): void {
        if (!process.env.ANTHROPIC_API_KEY && langchainApiKey) {
          process.env.ANTHROPIC_API_KEY = langchainApiKey;
        }
      },
      buildCommand(promptFilePath: string, options?: CodingAgentOptions): string {
        // Use --allowedTools with broad patterns instead of --dangerously-skip-permissions.
        // This works consistently in all environments (root, Docker, non-root) and is safer.
        const modelFlag = options?.model ? ` --model ${options.model}` : "";
        const maxTurnsFlag = options?.maxTurns ? ` --max-turns ${options.maxTurns}` : "";
        return `cat "${promptFilePath}" | claude -p${modelFlag}${maxTurnsFlag} --allowedTools "Bash(*)" "Read" "Edit" "Write" "WebFetch(*)" -`;
      },
    };
  }
}
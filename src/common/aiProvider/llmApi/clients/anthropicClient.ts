import { AbstractLlmClient, LlmCompletion } from "../llmClientBase.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
// The Messages API requires max_tokens: what the former SDK sent for current models
const DEFAULT_MAX_TOKENS = 16384;

/** Anthropic Messages API */
export class AnthropicClient extends AbstractLlmClient {
  getLabel(): string {
    return "Anthropic";
  }

  async complete(prompt: string): Promise<LlmCompletion> {
    const body: Record<string, any> = {
      model: this.config.modelName,
      max_tokens: this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    };
    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature;
    }
    const headers: Record<string, string> = { "anthropic-version": ANTHROPIC_VERSION };
    if (this.config.apiKey) {
      headers["x-api-key"] = this.config.apiKey;
    }
    const data = await this.postJson(`${this.trimmedBaseUrl(DEFAULT_BASE_URL)}/v1/messages`, body, headers);
    const text = (data?.content || [])
      .filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text)
      .join("");
    return {
      text,
      model: data?.model || this.config.modelName,
      emptyReason: text ? undefined : (data?.stop_reason || undefined),
    };
  }
}

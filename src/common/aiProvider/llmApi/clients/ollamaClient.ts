import { AbstractLlmClient, LlmCompletion } from "../llmClientBase.js";

const DEFAULT_BASE_URL = "http://localhost:11434";

/** Ollama chat API, local or remote */
export class OllamaClient extends AbstractLlmClient {
  getLabel(): string {
    return "Ollama";
  }

  async complete(prompt: string): Promise<LlmCompletion> {
    const options: Record<string, any> = {};
    if (this.config.temperature !== undefined) {
      options.temperature = this.config.temperature;
    }
    if (this.config.maxTokens !== undefined) {
      options.num_predict = this.config.maxTokens;
    }
    const body: Record<string, any> = {
      model: this.config.modelName,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    };
    if (Object.keys(options).length > 0) {
      body.options = options;
    }
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    const data = await this.postJson(`${this.trimmedBaseUrl(DEFAULT_BASE_URL)}/api/chat`, body, headers);
    const text = typeof data?.message?.content === "string" ? data.message.content : "";
    return {
      text,
      model: data?.model || this.config.modelName,
      emptyReason: text ? undefined : (data?.done_reason || undefined),
    };
  }
}

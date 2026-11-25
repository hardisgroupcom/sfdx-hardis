import { AbstractLlmClient, LlmCompletion } from "../llmClientBase.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * OpenAI API, and every gateway speaking it.
 * - "chat" mode calls /chat/completions with a user message, what most gateways support
 * - "responses" mode calls the Responses API with the prompt as system message, with the
 *   service tier and the reasoning effort, sent for any model name (gateway aliases included)
 */
export class OpenAiClient extends AbstractLlmClient {
  getLabel(): string {
    return "OpenAI";
  }

  async complete(prompt: string): Promise<LlmCompletion> {
    if (this.config.openAiApi === "responses") {
      return this.completeWithResponsesApi(prompt);
    }
    return this.completeWithChatCompletions(prompt);
  }

  private async completeWithChatCompletions(prompt: string): Promise<LlmCompletion> {
    const body: Record<string, any> = {
      model: this.config.modelName,
      messages: [{ role: "user", content: prompt }],
    };
    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature;
    }
    if (this.config.maxTokens !== undefined) {
      // Reasoning models refuse max_tokens
      body[isReasoningModel(this.config.modelName) ? "max_completion_tokens" : "max_tokens"] = this.config.maxTokens;
    }
    const data = await this.postJson(`${this.trimmedBaseUrl(DEFAULT_BASE_URL)}/chat/completions`, body, this.authHeaders());
    const message = data?.choices?.[0]?.message;
    const text = typeof message?.content === "string" ? message.content : "";
    return {
      text,
      model: data?.model || this.config.modelName,
      emptyReason: text ? undefined : (message?.refusal || data?.choices?.[0]?.finish_reason || undefined),
    };
  }

  private async completeWithResponsesApi(prompt: string): Promise<LlmCompletion> {
    const body: Record<string, any> = {
      model: this.config.modelName,
      input: [{ role: isReasoningModel(this.config.modelName) ? "developer" : "system", content: prompt }],
    };
    if (this.config.serviceTier) {
      body.service_tier = this.config.serviceTier;
    }
    if (this.config.reasoningEffort) {
      body.reasoning = { effort: this.config.reasoningEffort };
    }
    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature;
    }
    if (this.config.maxTokens !== undefined) {
      body.max_output_tokens = this.config.maxTokens;
    }
    const data = await this.postJson(`${this.trimmedBaseUrl(DEFAULT_BASE_URL)}/responses`, body, this.authHeaders());
    const parts: string[] = [];
    let refusal: string | undefined;
    for (const item of data?.output || []) {
      if (item?.type !== "message") {
        continue;
      }
      for (const content of item.content || []) {
        if (content?.type === "output_text" && typeof content.text === "string") {
          parts.push(content.text);
        } else if (content?.type === "refusal") {
          refusal = content.refusal;
        }
      }
    }
    const text = parts.join("");
    return {
      text,
      model: data?.model || this.config.modelName,
      emptyReason: text ? undefined : (refusal || data?.incomplete_details?.reason || data?.status || undefined),
    };
  }

  // A gateway authenticated by its default headers needs no API key
  private authHeaders(): Record<string, string> {
    return this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {};
  }
}

// o1, o3, o4-mini, gpt-5...: the models that take developer messages and max_completion_tokens
function isReasoningModel(modelName: string): boolean {
  const name = (modelName || "").split("/").pop() || "";
  return /^(o\d|gpt-5)/i.test(name);
}

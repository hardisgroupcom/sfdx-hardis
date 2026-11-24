import { HttpError, httpPost } from "../../utils/httpUtils.js";
import { retryOnThrottling } from "../../utils/adaptiveBatch.js";

/** The LLM APIs sfdx-hardis can call */
export type LlmProviderType = "ollama" | "openai" | "anthropic" | "google-genai";

export const LLM_PROVIDER_TYPES: LlmProviderType[] = ["ollama", "openai", "anthropic", "google-genai"];

/** The settings of one LLM API, resolved from the environment variables and .sfdx-hardis.yml */
export interface LlmClientConfig {
  modelName: string;
  apiKey?: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  /** Timeout of one call, in milliseconds */
  timeout?: number;
  /** OpenAI only: "chat" calls /chat/completions (works with most gateways), "responses" calls the Responses API */
  openAiApi?: "chat" | "responses";
  /** OpenAI Responses API only */
  serviceTier?: string;
  /** OpenAI Responses API only */
  reasoningEffort?: string;
}

export interface LlmCompletion {
  /** The text of the answer, empty when the provider returned none */
  text: string;
  /** The model that answered, as the provider names it */
  model: string;
  /** Why there is no text, when the provider said so (safety block, refusal...) */
  emptyReason?: string;
}

export interface LlmClient {
  /** Display name of the provider, used as log prefix */
  getLabel(): string;
  /** Send one user prompt and return the text of the answer */
  complete(prompt: string): Promise<LlmCompletion>;
}

/** An error returned by an LLM API, with the message of the provider itself */
export class LlmApiError extends Error {
  public status: number | null;
  public response?: HttpError["response"];

  constructor(message: string, status: number | null, response?: HttpError["response"]) {
    super(message);
    this.name = "LlmApiError";
    this.status = status;
    this.response = response;
  }
}

// Same defaults as the SDKs used before: 6 retries (LangChain), 10 minutes per call (OpenAI and Anthropic SDKs)
export const DEFAULT_LLM_MAX_RETRIES = 6;
export const DEFAULT_LLM_TIMEOUT_MS = 600_000;

/**
 * Base of the LLM API clients: one JSON POST, tried again after a throttling (429, 5xx, dropped
 * connection) with the delay the provider asked for. Sending a prompt again has no side effect.
 */
export abstract class AbstractLlmClient implements LlmClient {
  protected config: LlmClientConfig;

  constructor(config: LlmClientConfig) {
    this.config = config;
  }

  abstract getLabel(): string;

  abstract complete(prompt: string): Promise<LlmCompletion>;

  protected async postJson(url: string, body: any, headers: Record<string, string>): Promise<any> {
    const maxRetries = this.config.maxRetries ?? DEFAULT_LLM_MAX_RETRIES;
    try {
      const response = await retryOnThrottling(
        () => httpPost(url, body, {
          headers: { ...headers, ...(this.config.defaultHeaders || {}) },
          timeout: this.config.timeout ?? DEFAULT_LLM_TIMEOUT_MS,
          responseType: "json",
        }),
        { attempts: Math.max(0, maxRetries) + 1 },
      );
      return response.data;
    } catch (error) {
      throw this.toLlmApiError(error);
    }
  }

  protected trimmedBaseUrl(defaultBaseUrl: string): string {
    return (this.config.baseUrl || defaultBaseUrl).replace(/\/+$/, "");
  }

  private toLlmApiError(error: unknown): Error {
    if (error instanceof HttpError) {
      const providerMessage = providerErrorMessage(error.response?.data);
      return new LlmApiError(
        `${this.getLabel()} API error ${error.status}: ${providerMessage || error.response?.statusText || error.message}`,
        error.status,
        error.response,
      );
    }
    return error as Error;
  }
}

// The error formats of the APIs: { error: { message } } (OpenAI, Anthropic, Gemini), { error: "..." } (Ollama)
function providerErrorMessage(data: any): string | null {
  if (!data) {
    return null;
  }
  if (typeof data === "string") {
    return data.substring(0, 1000);
  }
  if (typeof data.error === "string") {
    return data.error;
  }
  if (data.error?.message) {
    return data.error.message;
  }
  if (data.message) {
    return data.message;
  }
  return JSON.stringify(data).substring(0, 1000);
}

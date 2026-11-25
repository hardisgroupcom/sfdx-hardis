import { AbstractLlmClient, LlmCompletion } from "../llmClientBase.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

/** Google Gemini API (generateContent) */
export class GoogleGenAiClient extends AbstractLlmClient {
  getLabel(): string {
    return "Google GenAI";
  }

  async complete(prompt: string): Promise<LlmCompletion> {
    const generationConfig: Record<string, any> = {};
    if (this.config.temperature !== undefined) {
      generationConfig.temperature = this.config.temperature;
    }
    if (this.config.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = this.config.maxTokens;
    }
    const body: Record<string, any> = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    };
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers["x-goog-api-key"] = this.config.apiKey;
    }
    const modelPath = this.config.modelName.startsWith("models/") ? this.config.modelName : `models/${this.config.modelName}`;
    const data = await this.postJson(`${this.trimmedBaseUrl(DEFAULT_BASE_URL)}/v1beta/${modelPath}:generateContent`, body, headers);
    const candidate = data?.candidates?.[0];
    const text = (candidate?.content?.parts || [])
      .filter((part: any) => typeof part?.text === "string" && part.thought !== true)
      .map((part: any) => part.text)
      .join("");
    return {
      text,
      model: data?.modelVersion || this.config.modelName,
      // A prompt or an answer blocked by the safety filters comes back without text
      emptyReason: text ? undefined : (data?.promptFeedback?.blockReason || candidate?.finishReason || undefined),
    };
  }
}

import { UtilsAi } from "./utils.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import { OpenAiProvider } from "./openaiProvider.js";
import { SfError } from "@salesforce/core";

export abstract class AiProvider {
  static isAiAvailable(): boolean {
    return this.getInstance() != null;
  }

  static getInstance(): AiProviderRoot | null {
    // OpenAi
    if (UtilsAi.isOpenApiAvailable()) {
      return new OpenAiProvider();
    }
    return null;
  }

  static async promptAi(prompt: string): Promise<AiResponse | null> {
    const aiInstance = this.getInstance();
    if (!aiInstance) {
      throw new SfError("aiInstance should be set");
    }
    return await aiInstance.promptAi(prompt);
  }
}

export interface AiResponse {
  success: boolean;
  model: string;
  promptResponse?: string;
}

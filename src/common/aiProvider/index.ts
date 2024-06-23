import { UtilsAi } from "./utils";
import { AiProviderRoot } from "./aiProviderRoot";
import { OpenApiProvider } from "./openapiProvider";

export abstract class AiProvider {
  static isAiAvailable(): boolean {
    return this.getInstance() != null
  }

  static getInstance(): AiProviderRoot {
    // OpenAi
    if (UtilsAi.isOpenApiAvailable()) {
      return new OpenApiProvider();
    }
    return null;
  }

  static async promptAi(prompt: string): Promise<AiResponse> {
    const aiInstance = this.getInstance();
    return await aiInstance.promptAi(prompt);
  }
}

export interface AiResponse {
  success: boolean;
  model: string;
  promptResponse?: string;
}
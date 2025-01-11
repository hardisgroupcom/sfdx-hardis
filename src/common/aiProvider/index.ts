import { UtilsAi } from "./utils.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import { OpenAiProvider } from "./openaiProvider.js";
import { SfError } from "@salesforce/core";
import { buildPromptFromTemplate, PromptTemplate } from "./promptTemplates.js";

export abstract class AiProvider {
  static isAiAvailable(): boolean {
    return this.getInstance() != null;
  }

  static getInstance(): AiProviderRoot | null {
    // OpenAi
    if (UtilsAi.isOpenAiAvailable()) {
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

  static buildPrompt(template: PromptTemplate, variables: object): string {
    return buildPromptFromTemplate(template, variables);
  }

}

export interface AiResponse {
  success: boolean;
  model: string;
  promptResponse?: string;
}

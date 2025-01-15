import { UtilsAi } from "./utils.js";
import c from 'chalk';
import { AiProviderRoot } from "./aiProviderRoot.js";
import { OpenAiProvider } from "./openaiProvider.js";
import { SfError } from "@salesforce/core";
import { buildPromptFromTemplate, PromptTemplate } from "./promptTemplates.js";
import { isCI, uxLog } from "../utils/index.js";
import { prompts } from "../utils/prompts.js";

let IS_AI_AVAILABLE: boolean | null = null;

export abstract class AiProvider {
  static isAiAvailable(): boolean {
    if (process.env?.DISABLE_AI === "true") {
      uxLog(this, c.yellow("[AI Provider] AI calls have been disabled using env var DISABLE_AI=true"))
      return false;
    }
    return this.getInstance() != null;
  }

  static async isAiAvailableWithUserPrompt() {
    if (IS_AI_AVAILABLE !== null) {
      return IS_AI_AVAILABLE;
    }
    if (this.isAiAvailable()) {
      IS_AI_AVAILABLE = true;
      return IS_AI_AVAILABLE;
    }
    if (!isCI) {
      const promptRes = await prompts({
        type: 'text',
        name: 'token',
        message: 'Input your OpenAi API token if you want to use it. Leave empty to skip.',
      });
      if (promptRes.token) {
        process.env.OPENAI_API_KEY = promptRes.token;
      }
    }
    IS_AI_AVAILABLE = this.isAiAvailable();
    return IS_AI_AVAILABLE;
  }

  static getInstance(): AiProviderRoot | null {
    // OpenAi
    if (UtilsAi.isOpenAiAvailable()) {
      return new OpenAiProvider();
    }
    return null;
  }

  static async promptAi(prompt: string, template: PromptTemplate | null = null): Promise<AiResponse | null> {
    const aiInstance = this.getInstance();
    if (!aiInstance) {
      throw new SfError("aiInstance should be set");
    }
    try {
      return await aiInstance.promptAi(prompt, template);
    } catch (e: any) {
      uxLog(this, c.red(`Error while calling AI provider: ${e.message}`));
      return null;
    }
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

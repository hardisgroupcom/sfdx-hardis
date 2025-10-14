import { UtilsAi } from "./utils.js";
import c from 'chalk';
import { AiProviderRoot } from "./aiProviderRoot.js";
import { OpenAiProvider } from "./openaiProvider.js";
import { SfError } from "@salesforce/core";
import { buildPromptFromTemplate, PromptTemplate } from "./promptTemplates.js";
import { isCI, uxLog } from "../utils/index.js";
import { prompts } from "../utils/prompts.js";
import { AgentforceProvider } from "./agentforceProvider.js";
import { LangChainProvider } from "./langchainProvider.js";
import { formatMarkdownForMkDocs } from "../utils/markdownUtils.js";

let IS_AI_AVAILABLE: boolean | null = null;

export abstract class AiProvider {
  static isAiAvailable(): boolean {
    if (process.env?.DISABLE_AI === "true") {
      uxLog("warning", this, c.yellow("[AI Provider] AI calls have been disabled using env var DISABLE_AI=true"))
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
        description: 'Provide your OpenAI API key to enable AI-powered features in sfdx-hardis',
      });
      if (promptRes.token) {
        process.env.OPENAI_API_KEY = promptRes.token;
      }
    }
    IS_AI_AVAILABLE = this.isAiAvailable();
    return IS_AI_AVAILABLE;
  }

  static getInstance(): AiProviderRoot | null {
    // LangChain
    if (UtilsAi.isLangChainAvailable()) {
      return new LangChainProvider();
    }
    // OpenAi
    else if (UtilsAi.isOpenAiAvailable()) {
      return new OpenAiProvider();
    }
    else if (UtilsAi.isAgentforceAvailable()) {
      return new AgentforceProvider();
    }
    return null;
  }

  static async promptAi(prompt: string, template: PromptTemplate): Promise<AiResponse | null> {
    const aiInstance = this.getInstance();
    if (!aiInstance) {
      throw new SfError("aiInstance should be set");
    }
    // Stop calling AI if a timeout has been reached
    const aiMaxTimeoutMinutes = parseInt(process.env.AI_MAX_TIMEOUT_MINUTES || (isCI ? "30" : "0"), 10);
    if (aiMaxTimeoutMinutes > 0) {
      globalThis.currentAiStartTime = globalThis.currentAiStartTime || Date.now();
      const elapsedMinutes = (Date.now() - globalThis.currentAiStartTime) / 60000; // Convert milliseconds to minutes
      if (elapsedMinutes >= aiMaxTimeoutMinutes) {
        uxLog("warning", this, c.yellow(`AI calls reached maximum time allowed of ${aiMaxTimeoutMinutes} minutes. You can either:
- Run command locally then commit + push
- Increase using variable \`AI_MAX_TIMEOUT_MINUTES\` in your CI config (ex: AI_MAX_TIMEOUT_MINUTES=120) after making sure than your CI job timeout can handle it 😊`));
        return { success: false, model: "none", forcedTimeout: true };
      }
    }
    // Call AI using API
    try {
      const aiResponse = await aiInstance.promptAi(prompt, template);
      if (aiResponse?.success && aiResponse?.promptResponse) {
        aiResponse.promptResponse = formatMarkdownForMkDocs(aiResponse.promptResponse);
      }
      return aiResponse;
    } catch (e: any) {
      if (e.message.includes("on tokens per min (TPM)")) {
        try {
          uxLog("warning", this, c.yellow(`Error while calling AI provider: ${e.message}`));
          uxLog("warning", this, c.yellow(`Trying again in 60 seconds...`));
          await new Promise((resolve) => setTimeout(resolve, 60000));
          return await aiInstance.promptAi(prompt, template);
        } catch (e2: any) {
          uxLog("error", this, c.red(`Error while calling AI provider: ${e2.message}`));
          return null;
        }
      }
      uxLog("error", this, c.red(`Error while calling AI provider: ${e.message}`));
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
  forcedTimeout?: boolean // In case AI_MAX_TIMEOUT_MINUTES has been set
}




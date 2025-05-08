import { AiResponse } from "./index.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import c from "chalk";
import { uxLog } from "../utils/index.js";
import { PromptTemplate } from "./promptTemplates.js";
import ollama from "ollama";
import { getEnvVar } from "../../config/index.js";

export class OllamaProvider extends AiProviderRoot {
  private model: string;

  constructor() {
    super();
    const model = getEnvVar("OLLAMA_MODEL");
    if (!model) {
      throw new Error("OLLAMA_MODEL environment variable must be set to use Ollama integration");
    }
    this.model = model;
  }

  public getLabel(): string {
    return "Ollama connector";
  }

  public async promptAi(promptText: string, template: PromptTemplate | null = null): Promise<AiResponse | null> {
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog(this, c.grey(`[Ollama] Requesting the following prompt to ${this.model}${template ? ' using template ' + template : ''}:\n${promptText}`));
    } else {
      uxLog(this, c.grey(`[Ollama] Requesting prompt to ${this.model}${template ? ' using template ' + template : ''} (define DEBUG_PROMPTS=true to see details)`));
    }

    try {
      const response = await ollama.chat({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: promptText
          }
        ]
      });

      if (process.env?.DEBUG_PROMPTS === "true") {
        uxLog(this, c.grey("[Ollama] Received prompt response\n" + JSON.stringify(response, null, 2)));
      } else {
        uxLog(this, c.grey("[Ollama] Received prompt response"));
      }

      const aiResponse: AiResponse = {
        success: false,
        model: this.model,
      };

      if (response.message?.content) {
        aiResponse.success = true;
        aiResponse.promptResponse = response.message.content;
      }

      return aiResponse;
    } catch (error: unknown) {
      if (error instanceof Error) {
        uxLog(this, c.red(`[Ollama] Error while calling Ollama API: ${error.message}`));
      } else {
        uxLog(this, c.red(`[Ollama] Unexpected error occurred`));
      }
      return null;
    }
  }
} 
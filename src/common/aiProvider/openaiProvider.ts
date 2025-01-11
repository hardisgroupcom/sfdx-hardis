import { OpenAI } from "openai";
import { AiResponse } from "./index.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import c from "chalk";
import { uxLog } from "../utils/index.js";
import { PromptTemplate } from "./promptTemplates.js";

export class OpenAiProvider extends AiProviderRoot {
  protected openai: OpenAI;

  constructor() {
    super();
    this.openai = new OpenAI();
  }

  public getLabel(): string {
    return "OpenAi connector";
  }

  public async promptAi(promptText: string, template: PromptTemplate | null = null): Promise<AiResponse | null> {
    if (!this.checkMaxAiCallsNumber()) {
      const maxCalls = this.getAiMaxCallsNumber();
      uxLog(this, c.yellow(`[OpenAi] Already performed maximum ${maxCalls} calls. Increase it by defining AI_MAXIMUM_CALL_NUMBER env variable`));
      return null;
    }
    const gptModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog(this, c.grey(`[OpenAi] Requesting the following prompt to ${gptModel}${template ? ' using template ' + template : ''}:\n${promptText}`));
    }
    else {
      uxLog(this, c.grey(`[OpenAi] Requesting prompt to ${gptModel}${template ? ' using template ' + template : ''} (define DEBUG_PROMPTS=true to see details)`));
    }
    this.incrementAiCallsNumber();
    const completion = await this.openai.chat.completions.create({
      messages: [{ role: "system", content: promptText }],
      model: gptModel,
    });
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog(this, c.grey("[OpenAi] Received prompt response from " + gptModel + "\n" + JSON.stringify(completion, null, 2)));
    }
    else {
      uxLog(this, c.grey("[OpenAi] Received prompt response from " + gptModel));
    }
    const aiResponse: AiResponse = {
      success: false,
      model: completion.model,
    };
    if (completion?.choices?.length > 0) {
      aiResponse.success = true;
      aiResponse.promptResponse = completion.choices[0].message.content ?? undefined;
    }
    return aiResponse;
  }
}

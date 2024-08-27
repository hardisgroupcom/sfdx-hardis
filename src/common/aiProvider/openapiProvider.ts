import OpenAI from "openai";
import { AiResponse } from "./index.js";
import { AiProviderRoot } from "./aiProviderRoot";
import c from "chalk";
import { uxLog } from "../utils/index.js";

export class OpenApiProvider extends AiProviderRoot {
  protected openai: OpenAI;

  constructor() {
    super();
    this.openai = new OpenAI();
  }

  public getLabel(): string {
    return "OpenApi connector";
  }

  public async promptAi(promptText: string): Promise<AiResponse> {
    if (!this.checkMaxAiCallsNumber()) {
      const maxCalls = this.getAiMaxCallsNumber();
      uxLog(this, c.grey(`[OpenAi] Already performed maximum ${maxCalls} calls. Increase it by defining OPENAI_MAXIMUM_CALL_NUMBER`));
      return null;
    }
    const gptModel = process.env.OPENAI_MODEL || "gpt-4o";
    uxLog(this, c.grey("[OpenAi] Requesting the following prompt to " + gptModel + ": " + promptText + " ..."));
    this.incrementAiCallsNumber();
    const completion = await this.openai.chat.completions.create({
      messages: [{ role: "system", content: promptText }],
      model: gptModel,
    });
    const aiResponse: AiResponse = {
      success: false,
      model: completion.model,
    };
    if (completion?.choices?.length > 0) {
      aiResponse.success = true;
      aiResponse.promptResponse = completion.choices[0].message.content;
    }
    return aiResponse;
  }
}

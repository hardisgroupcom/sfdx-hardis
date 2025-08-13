
import { AiResponse } from "./index.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import c from "chalk";
import { uxLog } from "../utils/index.js";
import { PromptTemplate } from "./promptTemplates.js";
import { Connection } from "@salesforce/core";
import { UtilsAi } from "./utils.js";

export class AgentforceProvider extends AiProviderRoot {
  protected conn: Connection;

  constructor() {
    super();
    this.conn = globalThis.jsForceConnTechnical || globalThis.jsForceConn;
  }

  public getLabel(): string {
    return "Agentforce connector";
  }

  public async promptAi(promptText: string, template: PromptTemplate): Promise<AiResponse | null> {
    if (!this.checkMaxAiCallsNumber()) {
      const maxCalls = this.getAiMaxCallsNumber();
      uxLog("warning", this, c.yellow(`[Agentforce] Already performed maximum ${maxCalls} calls. Increase it by defining AI_MAXIMUM_CALL_NUMBER env variable`));
      return null;
    }
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey(`[Agentforce] Requesting the following prompt${template ? (' using template ' + template) : ''}:\n${promptText}`));
    }
    else {
      uxLog("log", this, c.grey(`[Agentforce] Requesting prompt${template ? (' using template ' + template) : ''} (define DEBUG_PROMPTS=true to see details)`));
    }
    this.incrementAiCallsNumber();
    const genericPromptTemplate = process.env.GENERIC_AGENTFORCE_PROMPT_TEMPLATE || "SfdxHardisGenericPrompt";
    const promptUrl = process.env.GENERIC_AGENTFORCE_PROMPT_URL || `/services/data/v${this.conn.getApiVersion()}/einstein/prompt-templates/${genericPromptTemplate}/generations`
    const payload = {
      "isPreview": "false",
      "inputParams": {
        "valueMap": {
          "Input:PromptText": {
            "value": promptText
          }
        }
      },
      "outputLanguage": UtilsAi.getPromptsLanguage(),
      "additionalConfig": {
        /*  "numGenerations": 1,
            "temperature": 0,
            "frequencyPenalty": 0.0,
            "presencePenalty": 0.0,
            "additionalParameters": {},*/
        "applicationName": "PromptTemplateGenerationsInvocable"
      }
    }
    const agentforceResponse: any = await this.conn.requestPost(promptUrl, payload);
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey("[Agentforce] Received prompt response\n" + JSON.stringify(agentforceResponse, null, 2)));
    }
    else {
      uxLog("log", this, c.grey("[Agentforce] Received prompt response"));
    }
    const aiResponse: AiResponse = {
      success: false,
      model: "Agentforce",
    };
    if (agentforceResponse?.generations?.length > 0 && agentforceResponse.generations[0]?.text) {
      aiResponse.success = true;
      aiResponse.promptResponse = agentforceResponse.generations[0]?.text;
    }
    return aiResponse;
  }
}


import { AiResponse } from "./index.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import c from "chalk";
import { uxLog } from "../utils/index.js";
import { PromptTemplate } from "./promptTemplates.js";
import { Connection } from "@salesforce/core";
import { UtilsAi } from "./utils.js";
import { getEnvVar } from "../../config/index.js";
import { resolveBooleanFlag } from "./providerConfigUtils.js";
import { t } from '../utils/i18n.js';

export class AgentforceProvider extends AiProviderRoot {
  protected conn: Connection;
  private promptTemplate: string;
  private promptUrlTemplate: string;

  private constructor(config: AgentforceResolvedConfig) {
    super();
    this.conn = globalThis.jsForceConnTechnical || globalThis.jsForceConn;
    if (!this.conn) {
      throw new Error("A Salesforce connection is required to use Agentforce prompts");
    }
    this.promptTemplate = config.promptTemplate;
    this.promptUrlTemplate = config.promptUrlTemplate;
  }

  public static async isConfigured(): Promise<boolean> {
    const config = await this.resolveConfig();
    return config != null;
  }

  public static async create(): Promise<AgentforceProvider> {
    const config = await this.resolveConfig();
    if (!config) {
      throw new Error("Agentforce provider is not properly configured");
    }
    return new AgentforceProvider(config);
  }

  private static async resolveConfig(): Promise<AgentforceResolvedConfig | null> {
    const hasConnection = Boolean(globalThis.jsForceConnTechnical || globalThis.jsForceConn);
    if (!hasConnection) {
      return null;
    }
    const { enabled, rootConfig } = await resolveBooleanFlag({
      envVar: "USE_AGENTFORCE",
      configKey: "useAgentforce",
      defaultValue: false,
    });
    if (!enabled) {
      return null;
    }
    const promptTemplate = getEnvVar("GENERIC_AGENTFORCE_PROMPT_TEMPLATE")
      || rootConfig.genericAgentforcePromptTemplate
      || rootConfig.GENERIC_AGENTFORCE_PROMPT_TEMPLATE
      || "SfdxHardisGenericPrompt";
    const promptUrlTemplate = getEnvVar("GENERIC_AGENTFORCE_PROMPT_URL")
      || rootConfig.genericAgentforcePromptUrl
      || rootConfig.GENERIC_AGENTFORCE_PROMPT_URL
      || `/services/data/v{{API_VERSION}}/einstein/prompt-templates/{{PROMPT_TEMPLATE}}/generations`;
    return { promptTemplate, promptUrlTemplate };
  }

  public getLabel(): string {
    return "Agentforce connector";
  }

  public async promptAi(promptText: string, template: PromptTemplate): Promise<AiResponse | null> {
    if (!this.checkAndWarnMaxAiCalls("Agentforce")) {
      return null;
    }
    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey('[Agentforce] ' + t('agentforceRequestingPromptDebug', { template: template ? (' using template ' + template) : '', promptText })));
    }
    else {
      uxLog("log", this, c.grey('[Agentforce] ' + t('agentforceRequestingPrompt', { template: template ? (' using template ' + template) : '' })));
    }
    this.incrementAiCallsNumber();
    const promptUrl = this.interpolatePromptUrl(this.promptUrlTemplate, this.promptTemplate);
    const payload = {
      "isPreview": "false",
      "inputParams": {
        "valueMap": {
          "Input:PromptText": {
            "value": promptText
          }
        }
      },
      "outputLanguage": (await UtilsAi.getPromptsLanguage()),
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
      uxLog("log", this, c.grey('[Agentforce] ' + t('agentforceReceivedResponseDebug', { response: JSON.stringify(agentforceResponse, null, 2) })));
    }
    else {
      uxLog("log", this, c.grey('[Agentforce] ' + t('agentforceReceivedResponse')));
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

  private interpolatePromptUrl(template: string, promptTemplate: string): string {
    return template
      .replace(/{{API_VERSION}}/g, this.conn.getApiVersion())
      .replace(/{{PROMPT_TEMPLATE}}/g, promptTemplate)
      .replace(/{{GENERIC_AGENTFORCE_PROMPT_TEMPLATE}}/g, promptTemplate);
  }
}

interface AgentforceResolvedConfig {
  promptTemplate: string;
  promptUrlTemplate: string;
}

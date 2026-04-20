import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import c from "chalk";
import { Codex, type CodexOptions } from "@openai/codex-sdk";
import { getEnvVar } from "../../config/index.js";
import { PromptTemplate } from "./promptTemplates.js";
import { resolveBooleanFlag, parseDefaultHeaders } from "./providerConfigUtils.js";
import { uxLog } from "../utils/index.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import { AiResponse } from "./index.js";
import { t } from '../utils/i18n.js';

export class CodexProvider extends AiProviderRoot {
  private static readonly DEFAULT_MODEL = "gpt-5.1-codex";
  private static readonly DEFAULT_REASONING_EFFORT: CodexReasoningEffort = "high";
  private static readonly SUPPORTED_REASONING_EFFORTS: CodexReasoningEffort[] = ["low", "medium", "high", "xhigh"];
  private static readonly CUSTOM_PROVIDER_ID = "sfdx-hardis-gateway";

  private codex: Codex | null = null;
  private readonly modelName: string;
  private readonly apiKey?: string;
  private readonly baseUrl?: string;
  private readonly defaultHeaders?: Record<string, string>;
  private readonly reasoningEffort: CodexReasoningEffort;

  private constructor(config: CodexResolvedConfig) {
    super();
    this.modelName = config.modelName;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.defaultHeaders = config.defaultHeaders;
    this.reasoningEffort = config.reasoningEffort;
  }

  public getLabel(): string {
    return "Codex connector";
  }

  public static async isConfigured(): Promise<boolean> {
    const config = await this.resolveConfig();
    return config != null;
  }

  public static async shouldPromptForApiKey(): Promise<boolean> {
    const { enabled } = await resolveBooleanFlag({
      envVar: "USE_CODEX_DIRECT",
      configKey: "useCodexDirect",
      defaultValue: false,
    });
    if (!enabled) {
      return false;
    }
    if (getEnvVar("CODEX_API_KEY")) {
      return false;
    }
    const gatewayHeaders = parseDefaultHeaders(
      getEnvVar("CODEX_DEFAULT_HEADERS") || getEnvVar("OPENAI_DEFAULT_HEADERS"),
      "Codex",
    );
    const gatewayBaseUrl = (getEnvVar("CODEX_BASE_URL") || getEnvVar("OPENAI_BASE_URL") || "").trim();
    if (gatewayHeaders && gatewayBaseUrl) {
      return false;
    }
    return !existsSync(this.resolveAuthFilePath());
  }

  public static async create(): Promise<CodexProvider> {
    const config = await this.resolveConfig();
    if (!config) {
      throw new Error("Codex provider is not properly configured");
    }
    return new CodexProvider(config);
  }

  private static async resolveConfig(): Promise<CodexResolvedConfig | null> {
    const { enabled, rootConfig } = await resolveBooleanFlag({
      envVar: "USE_CODEX_DIRECT",
      configKey: "useCodexDirect",
      defaultValue: false,
    });
    if (!enabled) {
      return null;
    }

    const apiKey = getEnvVar("CODEX_API_KEY") || undefined;
    const baseUrl = getEnvVar("CODEX_BASE_URL") || getEnvVar("OPENAI_BASE_URL") || undefined;

    const defaultHeaders = parseDefaultHeaders(
      getEnvVar("CODEX_DEFAULT_HEADERS") || getEnvVar("OPENAI_DEFAULT_HEADERS"),
      "Codex",
      (level, _scope, msg) => uxLog(level, this, c.yellow(msg)),
    );

    const hasGatewayAuth = baseUrl && defaultHeaders && Object.keys(defaultHeaders).length > 0;
    if (!apiKey && !hasGatewayAuth && !existsSync(this.resolveAuthFilePath())) {
      return null;
    }

    const modelName = getEnvVar("CODEX_MODEL")
      || rootConfig.codexModel
      || rootConfig.CODEX_MODEL
      || CodexProvider.DEFAULT_MODEL;
    const reasoningEffort = this.resolveReasoningEffort(
      getEnvVar("CODEX_REASONING_EFFORT")
      || rootConfig.codexReasoningEffort
      || rootConfig.CODEX_REASONING_EFFORT
      || CodexProvider.DEFAULT_REASONING_EFFORT
    );

    return { apiKey, baseUrl, defaultHeaders, modelName, reasoningEffort };
  }

  private static resolveAuthFilePath(): string {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    return path.join(codexHome, "auth.json");
  }

  private static resolveReasoningEffort(rawValue: string): CodexReasoningEffort {
    const normalizedValue = rawValue.toLowerCase();
    if (CodexProvider.SUPPORTED_REASONING_EFFORTS.includes(normalizedValue as CodexReasoningEffort)) {
      return normalizedValue as CodexReasoningEffort;
    }

    uxLog("warning", this, c.yellow('[Codex] ' + t('codexUnsupportedReasoningEffort', { rawValue, defaultEffort: CodexProvider.DEFAULT_REASONING_EFFORT })));
    return CodexProvider.DEFAULT_REASONING_EFFORT;
  }

  private getCodexClient(): Codex {
    if (!this.codex) {
      const options: CodexOptions = {};
      if (this.apiKey) {
        options.apiKey = this.apiKey;
      }
      if (this.baseUrl) {
        options.baseUrl = this.baseUrl;
      }
      if (this.defaultHeaders && Object.keys(this.defaultHeaders).length > 0) {
        options.config = {
          model_providers: {
            [CodexProvider.CUSTOM_PROVIDER_ID]: {
              name: "sfdx-hardis Gateway",
              base_url: this.baseUrl || "https://api.openai.com/v1",
              wire_api: "responses",
              http_headers: this.defaultHeaders,
            },
          },
        };
      }
      this.codex = new Codex(options);
    }
    return this.codex;
  }

  private getEffectiveModel(): string {
    if (this.defaultHeaders && Object.keys(this.defaultHeaders).length > 0) {
      return `${CodexProvider.CUSTOM_PROVIDER_ID}/${this.modelName}`;
    }
    return this.modelName;
  }

  public async promptAi(promptText: string, template: PromptTemplate | null = null): Promise<AiResponse | null> {
    if (!this.checkAndWarnMaxAiCalls("Codex")) {
      return null;
    }

    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey('[Codex] ' + t('codexRequestingPromptDebug', { modelName: this.modelName, template: template ? " using template " + template : "", promptText })));
    } else {
      uxLog("log", this, c.grey('[Codex] ' + t('codexRequestingPrompt', { modelName: this.modelName, template: template ? " using template " + template : "" })));
    }

    this.incrementAiCallsNumber();

    const thread = this.getCodexClient().startThread({
      model: this.getEffectiveModel(),
      modelReasoningEffort: this.reasoningEffort,
      sandboxMode: "read-only",
      approvalPolicy: "never",
    });
    const turn = await thread.run(promptText);

    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey('[Codex] ' + t('codexReceivedResponseDebug', { modelName: this.modelName, response: JSON.stringify(turn, null, 2) })));
    } else {
      uxLog("log", this, c.grey('[Codex] ' + t('codexReceivedResponse', { modelName: this.modelName })));
    }

    const aiResponse: AiResponse = {
      success: false,
      model: this.modelName,
    };
    if (turn.finalResponse) {
      aiResponse.success = true;
      aiResponse.promptResponse = turn.finalResponse;
    }
    return aiResponse;
  }
}

interface CodexResolvedConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  modelName: string;
  reasoningEffort: CodexReasoningEffort;
}

type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh";

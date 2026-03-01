import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import c from "chalk";
import { Codex } from "@openai/codex-sdk";
import { getEnvVar } from "../../config/index.js";
import { PromptTemplate } from "./promptTemplates.js";
import { resolveBooleanFlag } from "./providerConfigUtils.js";
import { uxLog } from "../utils/index.js";
import { AiProviderRoot } from "./aiProviderRoot.js";
import { AiResponse } from "./index.js";
import { t } from '../utils/i18n.js';

export class CodexProvider extends AiProviderRoot {
  private static readonly DEFAULT_MODEL = "gpt-5.1-codex";
  private static readonly DEFAULT_REASONING_EFFORT: CodexReasoningEffort = "high";
  private static readonly SUPPORTED_REASONING_EFFORTS: CodexReasoningEffort[] = ["low", "medium", "high", "xhigh"];

  private codex: Codex | null = null;
  private readonly modelName: string;
  private readonly apiKey?: string;
  private readonly reasoningEffort: CodexReasoningEffort;

  private constructor(config: CodexResolvedConfig) {
    super();
    this.modelName = config.modelName;
    this.apiKey = config.apiKey;
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
    if (!apiKey && !existsSync(this.resolveAuthFilePath())) {
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

    return { apiKey, modelName, reasoningEffort };
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

    uxLog("warning", this, c.yellow(t('codexUnsupportedReasoningEffort', { rawValue, defaultEffort: CodexProvider.DEFAULT_REASONING_EFFORT })));
    return CodexProvider.DEFAULT_REASONING_EFFORT;
  }

  private getCodexClient(): Codex {
    if (!this.codex) {
      this.codex = this.apiKey ? new Codex({ apiKey: this.apiKey }) : new Codex();
    }
    return this.codex;
  }

  public async promptAi(promptText: string, template: PromptTemplate | null = null): Promise<AiResponse | null> {
    if (!this.checkAndWarnMaxAiCalls("Codex")) {
      return null;
    }

    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey(t('codexRequestingPromptDebug', { modelName: this.modelName, template: template ? " using template " + template : "", promptText })));
    } else {
      uxLog("log", this, c.grey(t('codexRequestingPrompt', { modelName: this.modelName, template: template ? " using template " + template : "" })));
    }

    this.incrementAiCallsNumber();

    const thread = this.getCodexClient().startThread({
      model: this.modelName,
      modelReasoningEffort: this.reasoningEffort,
      sandboxMode: "read-only",
      approvalPolicy: "never",
    });
    const turn = await thread.run(promptText);

    if (process.env?.DEBUG_PROMPTS === "true") {
      uxLog("log", this, c.grey(t('codexReceivedResponseDebug', { modelName: this.modelName, response: JSON.stringify(turn, null, 2) })));
    } else {
      uxLog("log", this, c.grey(t('codexReceivedResponse', { modelName: this.modelName })));
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
  modelName: string;
  reasoningEffort: CodexReasoningEffort;
}

type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh";

import c from "chalk";
import path from "path";
import fs from "fs-extra";
import { execCommand, isCI, uxLog } from "../utils/index.js";
import { getConfig, getEnvVar, getReportDirectory } from "../../config/index.js";
import { t } from "../utils/i18n.js";
import { LangChainProviderFactory } from "./langChainProviders/langChainProviderFactory.js";
import { CodingAgentInfo, CodingAgentOptions } from "./langChainProviders/langChainBaseProvider.js";

export type CodingAgentType = "claude" | "codex-cli" | "gemini-cli" | "copilot-cli";

export interface CodingAgentRunResult {
  agent: CodingAgentType;
  stdout: string;
  stderr: string;
  status: number;
}

export interface CodingAgentConfig {
  agent: CodingAgentType;
  command: string;
  available: boolean;
  /** Provider-specific coding agent info (from LangChain sub-provider), if available */
  codingAgentInfo?: CodingAgentInfo | null;
}

/** Fallback coding agent info for copilot-cli (no LangChain provider) */
const COPILOT_CLI_AGENT_INFO: CodingAgentInfo = {
  agentType: "copilot-cli",
  command: "copilot",
  apiKeyEnvVar: null,
  setupApiKey(): void {
    // Priority: COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN
    const copilotToken = process.env.COPILOT_GITHUB_TOKEN;
    if (copilotToken && !process.env.GH_TOKEN) {
      process.env.GH_TOKEN = copilotToken;
    }
  },
  buildCommand(promptFilePath: string, options?: CodingAgentOptions): string {
    const modelFlag = options?.model ? ` --model ${options.model}` : "";
    return `cat "${promptFilePath}" | copilot -p -${modelFlag} --allow-all-tools`;
  },
};

/**
 * Manages coding agents (Claude, Codex CLI, Gemini CLI, GitHub Copilot CLI)
 * that can run arbitrary prompts via CLI.
 *
 * Agent-specific logic (CLI commands, API key setup) is defined in each
 * LangChain sub-provider class via CodingAgentInfo. This class orchestrates
 * agent detection, execution, and cleanup.
 *
 * Configuration is read from:
 * 1. Environment variables (SFDX_HARDIS_CODING_AGENT, SFDX_HARDIS_CODING_AGENT_AUTO_FIX)
 * 2. .sfdx-hardis.yml branch config (codingAgent, codingAgentAutoFix)
 * 3. Active AI provider detection (LangChain provider type → matching agent)
 */
export class CodingAgentProvider {

  /**
   * Detects which coding agent is configured and available.
   *
   * The codingAgent property (or SFDX_HARDIS_CODING_AGENT env var) must be set.
   * If not configured, no agent detection is attempted.
   *
   * In local mode (outside CI), API keys are not required — agents use their
   * own login mechanisms (claude login, gh auth login, etc.).
   */
  static async getConfiguredAgent(): Promise<CodingAgentConfig | null> {
    const branchConfig = await getConfig("branch");
    const langchainApiKey = getEnvVar("LANGCHAIN_LLM_MODEL_API_KEY");

    const preferredAgent = (getEnvVar("SFDX_HARDIS_CODING_AGENT") || branchConfig?.codingAgent || null) as CodingAgentType | null;
    if (!preferredAgent) {
      return null;
    }

    const config = await this.buildAgentConfig(preferredAgent, branchConfig);
    if (config?.available) {
      if (langchainApiKey) {
        config.codingAgentInfo?.setupApiKey(langchainApiKey);
        uxLog("log", this, c.grey(t("codingAgentReusingApiKey", { agent: config.agent, source: "LANGCHAIN_LLM_MODEL_API_KEY" })));
      } else if (!isCI) {
        uxLog("log", this, c.grey(t("codingAgentDetectedLocally", { agent: config.agent })));
      }
      return config;
    }

    uxLog("warning", this, c.yellow(t("codingAgentNotAvailable", { agent: preferredAgent })));
    this.warnAgentNotInstalledSuggestUbuntu(preferredAgent);
    return null;
  }

  /**
   * Check if coding agent auto-fix is enabled.
   * Sources: env var SFDX_HARDIS_CODING_AGENT_AUTO_FIX or .sfdx-hardis.yml codingAgentAutoFix
   */
  static async isAutoFixEnabled(): Promise<boolean> {
    if (getEnvVar("SFDX_HARDIS_CODING_AGENT_AUTO_FIX") === "true") {
      return true;
    }
    const branchConfig = await getConfig("branch");
    return branchConfig?.codingAgentAutoFix === true;
  }

  /**
   * Run a coding agent with the given prompt string.
   *
   * This is the generic public entry point for invoking any coding agent.
   * It handles agent detection, temp file management, command building,
   * execution, and cleanup.
   *
   * Returns null if no agent is available.
   */
  static async runPrompt(prompt: string): Promise<CodingAgentRunResult | null> {
    const agentConfig = await this.getConfiguredAgent();
    if (!agentConfig) {
      uxLog("warning", this, c.yellow(t("noCodingAgentAvailable")));
      return null;
    }
    return this.runPromptWithConfig(agentConfig, prompt);
  }

  /**
   * Run a coding agent with the given prompt string and a pre-resolved config.
   * Handles temp file management, command building, execution, and cleanup.
   */
  private static async runPromptWithConfig(
    agentConfig: CodingAgentConfig,
    prompt: string,
  ): Promise<CodingAgentRunResult> {
    const timestamp = Date.now();

    // Write prompt to hardis-report/prompts for record keeping
    const reportDir = await getReportDirectory();
    const promptsDir = path.join(reportDir, "prompts");
    await fs.ensureDir(promptsDir);
    const promptFilePath = path.join(promptsDir, `prompt-${timestamp}-${agentConfig.agent}.txt`);
    await fs.writeFile(promptFilePath, prompt, "utf-8");

    const agentInfo = agentConfig.codingAgentInfo;
    if (!agentInfo) {
      throw new Error(t("codingAgentNoProviderInfo", { agent: agentConfig.agent }));
    }

    const agentOptions = await this.getCodingAgentOptions();
    const commandStr = agentInfo.buildCommand(promptFilePath, agentOptions);

    if (agentOptions.model || agentOptions.maxTurns) {
      uxLog("log", this, c.grey(t("codingAgentUsingOptions", {
        model: agentOptions.model || "default",
        maxTurns: String(agentOptions.maxTurns || "default"),
      })));
    }

    uxLog("log", this, c.grey(t("codingAgentRunningCommand", { command: commandStr.substring(0, 200) + "..." })));

    try {
      const result = await execCommand(commandStr, null, {
        fail: false,
        output: true,
        debug: process.env?.DEBUG_CODING_AGENT === "true",
      });

      return {
        agent: agentConfig.agent,
        stdout: result?.stdout || "",
        stderr: result?.stderr || "",
        status: result?.status ?? 1,
      };
    } finally {
      // Keep prompt files in hardis-report for auditing
    }
  }

  /**
   * Read coding agent CLI options from config / environment variables.
   *
   * Sources (env var takes priority over .sfdx-hardis.yml):
   * - codingAgentModel / SFDX_HARDIS_CODING_AGENT_MODEL → model override
   * - codingAgentMaxTurns / SFDX_HARDIS_CODING_AGENT_MAX_TURNS → max agentic turns
   */
  private static async getCodingAgentOptions(): Promise<CodingAgentOptions> {
    const branchConfig = await getConfig("branch");
    const model = getEnvVar("SFDX_HARDIS_CODING_AGENT_MODEL") || branchConfig?.codingAgentModel || undefined;
    const maxTurnsRaw = getEnvVar("SFDX_HARDIS_CODING_AGENT_MAX_TURNS") || branchConfig?.codingAgentMaxTurns;
    const maxTurns = maxTurnsRaw ? parseInt(String(maxTurnsRaw), 10) : undefined;
    return { model, maxTurns: Number.isNaN(maxTurns) ? undefined : maxTurns };
  }

  private static async isAgentAvailable(command: string): Promise<boolean> {
    try {
      const result = await execCommand(`${command} --version`, null, {
        fail: false,
        output: false,
        debug: false,
      });
      return result?.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Build agent configuration. Tries to resolve CodingAgentInfo from LangChain provider
   * matching this agent type, or uses the copilot-cli fallback.
   */
  private static async buildAgentConfig(agent: CodingAgentType, branchConfig: any): Promise<CodingAgentConfig | null> {
    // Try to find CodingAgentInfo from LangChain providers
    const langchainProvider = getEnvVar("LANGCHAIN_LLM_PROVIDER") || branchConfig?.langchainLlmProvider || null;
    let codingAgentInfo: CodingAgentInfo | null = null;

    if (langchainProvider) {
      const info = LangChainProviderFactory.getCodingAgentInfo(langchainProvider);
      if (info?.agentType === agent) {
        codingAgentInfo = info;
      }
    }

    // If no matching LangChain provider, check if it's copilot-cli
    if (!codingAgentInfo && agent === "copilot-cli") {
      codingAgentInfo = COPILOT_CLI_AGENT_INFO;
    }

    // For agents without a matching LangChain provider, try all providers
    if (!codingAgentInfo) {
      for (const providerType of ["anthropic", "google-genai", "openai", "ollama"]) {
        const info = LangChainProviderFactory.getCodingAgentInfo(providerType);
        if (info?.agentType === agent) {
          codingAgentInfo = info;
          break;
        }
      }
    }

    if (!codingAgentInfo) {
      return null;
    }

    const available = await this.isAgentAvailable(codingAgentInfo.command);
    return { agent, command: codingAgentInfo.command, available, codingAgentInfo };
  }

  /**
   * Detect if the current system uses musl libc (Alpine Linux).
   */
  private static isMuslSystem(): boolean {
    try {
      // Alpine Linux uses musl; check /etc/os-release or ldd version output
      if (fs.existsSync("/etc/alpine-release")) {
        return true;
      }
    } catch {
      // Ignore
    }
    return false;
  }

  /**
   * Warn the user when an API key is configured for an agent but its CLI is not available.
   * On Alpine/musl systems, suggest using the Ubuntu-based Docker image instead.
   */
  private static warnAgentNotInstalledSuggestUbuntu(agent: CodingAgentType): void {
    if (this.isMuslSystem()) {
      uxLog("warning", this, c.yellow(t("codingAgentNotInstalledSuggestUbuntu", { agent, ubuntuImage: "hardisgroupcom/sfdx-hardis-ubuntu:latest" })));
    }
  }
}

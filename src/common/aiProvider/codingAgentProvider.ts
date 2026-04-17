import c from "chalk";
import path from "path";
import os from "os";
import fs from "fs-extra";
import { execCommand, git, uxLog } from "../utils/index.js";
import { getConfig, getEnvVar } from "../../config/index.js";
import { t } from "../utils/i18n.js";
import { buildPromptFromTemplate } from "./promptTemplates.js";
import { LangChainProviderFactory } from "./langChainProviders/langChainProviderFactory.js";
import { CodingAgentInfo } from "./langChainProviders/langChainBaseProvider.js";

export type CodingAgentType = "claude" | "codex-cli" | "gemini-cli" | "copilot-cli";

export interface CodingAgentResult {
  success: boolean;
  agent: CodingAgentType;
  fixedFiles: string[];
  errorsDescription: string;
  fixesDescription: string;
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
  buildCommand(promptFilePath: string): string {
    return `cat "${promptFilePath}" | copilot -p - --allow-all-tools`;
  },
};

/**
 * Manages coding agents (Claude, Codex CLI, Gemini CLI, GitHub Copilot CLI)
 * that can analyze deployment errors and fix local metadata files.
 *
 * Agent-specific logic (CLI commands, API key setup) is defined in each
 * LangChain sub-provider class via CodingAgentInfo. This class orchestrates
 * agent detection, prompt building, execution, and result parsing.
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
   * Resolution order:
   * 1. Explicit config: env var SFDX_HARDIS_CODING_AGENT or .sfdx-hardis.yml codingAgent
   * 2. AI provider mapping: derives agent from active LangChain provider
   * 3. Auto-detect: tries each agent CLI in priority order
   */
  static async getConfiguredAgent(): Promise<CodingAgentConfig | null> {
    const branchConfig = await getConfig("branch");
    const langchainApiKey = getEnvVar("LANGCHAIN_LLM_MODEL_API_KEY");

    // 1. Explicit preference from env var or config
    const preferredAgent = (getEnvVar("SFDX_HARDIS_CODING_AGENT") || branchConfig?.codingAgent || null) as CodingAgentType | null;
    if (preferredAgent) {
      const config = await this.buildAgentConfig(preferredAgent, branchConfig);
      if (config?.available) {
        config.codingAgentInfo?.setupApiKey(langchainApiKey);
        if (config.codingAgentInfo) {
          uxLog("log", this, c.grey(t("codingAgentReusingApiKey", { agent: config.agent, source: "LANGCHAIN_LLM_MODEL_API_KEY" })));
        }
        return config;
      }
      uxLog("warning", this, c.yellow(t("codingAgentNotAvailable", { agent: preferredAgent })));
      this.warnAgentNotInstalledSuggestUbuntu(preferredAgent);
    }

    // 2. Derive from active AI provider
    const langchainProvider = getEnvVar("LANGCHAIN_LLM_PROVIDER") || branchConfig?.langchainLlmProvider || null;
    if (langchainProvider) {
      const agentInfo = LangChainProviderFactory.getCodingAgentInfo(langchainProvider);
      if (agentInfo) {
        const config = await this.buildAgentConfigFromInfo(agentInfo);
        if (config?.available) {
          agentInfo.setupApiKey(langchainApiKey);
          uxLog("log", this, c.grey(t("codingAgentReusingApiKey", { agent: config.agent, source: "LANGCHAIN_LLM_MODEL_API_KEY" })));
          return config;
        }
      }
    }

    // Check direct provider configs (codex, openai)
    const directAgent = await this.getAgentFromDirectProvider(branchConfig);
    if (directAgent) {
      const config = await this.buildAgentConfig(directAgent, branchConfig);
      if (config?.available) {
        return config;
      }
    }

    // 3. Auto-detect: only select agents that have an API key configured and are installed
    const agentOrder: CodingAgentType[] = ["claude", "codex-cli", "gemini-cli", "copilot-cli"];
    for (const agent of agentOrder) {
      if (this.hasApiKeyConfigured(agent)) {
        const config = await this.buildAgentConfig(agent, branchConfig);
        if (config?.available) {
          return config;
        }
        // API key is set but CLI is not available — warn and suggest Ubuntu image if on Alpine/musl
        this.warnAgentNotInstalledSuggestUbuntu(agent);
      }
    }
    return null;
  }

  /**
   * Check for direct (non-LangChain) provider configurations that map to a coding agent.
   */
  private static async getAgentFromDirectProvider(branchConfig: any): Promise<CodingAgentType | null> {
    const useCodex = getEnvVar("USE_CODEX_DIRECT") || branchConfig?.useCodexDirect;
    if (useCodex === "true" || useCodex === true) {
      return "codex-cli";
    }
    const useOpenAi = getEnvVar("USE_OPENAI_DIRECT") || branchConfig?.useOpenaiDirect;
    const openAiKey = getEnvVar("OPENAI_API_KEY");
    if ((useOpenAi === "true" || useOpenAi === true) || openAiKey) {
      return "codex-cli";
    }
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
   * Run a coding agent to fix deployment errors.
   */
  static async runAgentToFixErrors(
    errorsAndTips: any[],
    failedTests: any[],
    targetUsername: string | null,
  ): Promise<CodingAgentResult | null> {
    const agentConfig = await this.getConfiguredAgent();
    if (!agentConfig) {
      uxLog("warning", this, c.yellow(t("noCodingAgentAvailable")));
      return null;
    }

    uxLog("action", this, c.cyan(t("startingCodingAgentToFixErrors", { agent: agentConfig.agent })));

    const prompt = await this.buildAgentPrompt(errorsAndTips, failedTests, targetUsername);

    try {
      const result = await this.executeAgent(agentConfig, prompt);
      return result;
    } catch (e) {
      uxLog("error", this, c.red(t("codingAgentExecutionError", { agent: agentConfig.agent, message: (e as Error).message })));
      return null;
    }
  }

  /**
   * Build the prompt using the prompt template system.
   * The template PROMPT_CODING_AGENT_FIX_DEPLOYMENT_ERRORS can be overridden
   * by placing a file in config/prompt-templates/PROMPT_CODING_AGENT_FIX_DEPLOYMENT_ERRORS.txt
   */
  private static async buildAgentPrompt(
    errorsAndTips: any[],
    failedTests: any[],
    targetUsername: string | null,
  ): Promise<string> {
    const errorsText = this.formatErrorsForPrompt(errorsAndTips);
    const failedTestsText = this.formatFailedTestsForPrompt(failedTests);

    return await buildPromptFromTemplate("PROMPT_CODING_AGENT_FIX_DEPLOYMENT_ERRORS", {
      ERRORS: errorsText || "No deployment errors.",
      FAILED_TESTS: failedTestsText || "No failed tests.",
      TARGET_ORG: targetUsername || "N/A",
    });
  }

  private static formatErrorsForPrompt(errorsAndTips: any[]): string {
    if (errorsAndTips.length === 0) return "";
    const lines: string[] = [];
    for (const item of errorsAndTips) {
      lines.push(`### Error: ${item.error?.message || "Unknown error"}`);
      if (item.tip?.message) {
        lines.push(`Tip: ${item.tip.message}`);
      }
      if (item.tipFromAi?.promptResponse) {
        lines.push(`AI Suggestion: ${item.tipFromAi.promptResponse}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  private static formatFailedTestsForPrompt(failedTests: any[]): string {
    if (failedTests.length === 0) return "";
    const lines: string[] = [];
    for (const test of failedTests) {
      lines.push(`### Test: ${test.class}.${test.method}`);
      lines.push(`Error: ${test.error}`);
      if (test.stack) {
        lines.push(`Stack: ${test.stack}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  /**
   * Execute the coding agent with the given prompt.
   * Delegates command building to the CodingAgentInfo from the provider.
   */
  private static async executeAgent(
    agentConfig: CodingAgentConfig,
    prompt: string,
  ): Promise<CodingAgentResult> {
    // Write prompt to a temp file to avoid shell escaping issues with special characters
    const promptFilePath = path.join(os.tmpdir(), `sfdx-hardis-agent-prompt-${Date.now()}.txt`);
    await fs.writeFile(promptFilePath, prompt, "utf-8");

    // Delegate command building to the provider's CodingAgentInfo
    const agentInfo = agentConfig.codingAgentInfo;
    if (!agentInfo) {
      await fs.remove(promptFilePath);
      throw new Error(t("codingAgentNoProviderInfo", { agent: agentConfig.agent }));
    }
    const commandStr = agentInfo.buildCommand(promptFilePath);

    uxLog("log", this, c.grey(t("codingAgentRunningCommand", { command: commandStr.substring(0, 200) + "..." })));

    try {
      const result = await execCommand(commandStr, null, {
        fail: false,
        output: true,
        debug: process.env?.DEBUG_CODING_AGENT === "true",
      });

      const fixedFiles = await this.getChangedFiles();
      const fixesDescription = this.parseFixesSummary(result?.stdout || "");
      const errorsDescription = this.buildErrorsDescription([], []);

      return {
        success: fixedFiles.length > 0,
        agent: agentConfig.agent,
        fixedFiles,
        errorsDescription,
        fixesDescription: fixesDescription || t("codingAgentAppliedFixes", { count: String(fixedFiles.length) }),
      };
    } finally {
      // Clean up temp file
      await fs.remove(promptFilePath).catch(() => { });
    }
  }

  private static async getChangedFiles(): Promise<string[]> {
    try {
      const status = await git().status();
      return [
        ...status.modified,
        ...status.created,
        ...status.renamed.map((r) => r.to),
      ];
    } catch {
      return [];
    }
  }

  private static parseFixesSummary(output: string): string {
    // Match both '---SUMMARY---' (template) and '--- FIXES SUMMARY ---' (agent output)
    const summaryMatch = output.match(/---[\s\w]*SUMMARY[\s\w]*---([\s\S]*?)(?:---|$)/i);
    if (summaryMatch) {
      return summaryMatch[1].trim();
    }
    if (output.length > 0) {
      return output.slice(-2000).trim();
    }
    return "";
  }

  static buildErrorsDescription(errorsAndTips: any[], failedTests: any[]): string {
    const lines: string[] = [];

    if (errorsAndTips.length > 0) {
      lines.push("## Deployment Errors");
      lines.push("");
      for (const item of errorsAndTips) {
        lines.push(`- **Error**: ${item.error?.message || "Unknown error"}`);
        if (item.tip?.message) {
          lines.push(`  - **Tip**: ${item.tip.message}`);
        }
      }
      lines.push("");
    }

    if (failedTests.length > 0) {
      lines.push("## Failed Tests");
      lines.push("");
      for (const test of failedTests) {
        lines.push(`- **${test.class}.${test.method}**: ${test.error}`);
      }
      lines.push("");
    }

    return lines.join("\n");
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
   * Check if an API key is configured for the given agent type.
   */
  private static hasApiKeyConfigured(agent: CodingAgentType): boolean {
    switch (agent) {
      case "claude":
        return !!(process.env.ANTHROPIC_API_KEY || getEnvVar("LANGCHAIN_LLM_MODEL_API_KEY"));
      case "codex-cli":
        return !!(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || getEnvVar("LANGCHAIN_LLM_MODEL_API_KEY"));
      case "gemini-cli":
        return !!(process.env.GEMINI_API_KEY || getEnvVar("LANGCHAIN_LLM_MODEL_API_KEY"));
      case "copilot-cli":
        return !!(process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
      default:
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
   * Build agent configuration directly from a CodingAgentInfo (from factory lookup).
   */
  private static async buildAgentConfigFromInfo(agentInfo: CodingAgentInfo): Promise<CodingAgentConfig | null> {
    const available = await this.isAgentAvailable(agentInfo.command);
    return {
      agent: agentInfo.agentType as CodingAgentType,
      command: agentInfo.command,
      available,
      codingAgentInfo: agentInfo,
    };
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

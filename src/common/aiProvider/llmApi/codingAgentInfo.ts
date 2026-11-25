import { getEnvVar } from "../../../config/index.js";
import { parseDefaultHeaders, shellEscape } from "../utils/providerConfigUtils.js";
import { readLlmEnvSetting } from "./llmApiConfig.js";

/**
 * Options that can be passed to a coding agent CLI command.
 * Configured via .sfdx-hardis.yml properties or environment variables.
 */
export interface CodingAgentOptions {
  /** Override the model used by the coding agent CLI (e.g. "claude-sonnet-4-20250514", "o3", "gemini-2.5-pro") */
  model?: string;
  /** Maximum number of agentic turns / iterations the CLI is allowed to perform */
  maxTurns?: number;
}

/**
 * Information about the coding agent CLI associated with an LLM provider.
 */
export interface CodingAgentInfo {
  /** The coding agent type identifier (e.g. "claude", "codex-cli", "gemini-cli") */
  agentType: string;
  /** The CLI command name used for availability checks (e.g. "claude", "codex", "gemini") */
  command: string;
  /** The environment variable name the coding agent CLI uses for authentication, or null */
  apiKeyEnvVar: string | null;
  /** Set the coding agent CLI's API key env var, reusing the LLM API key */
  setupApiKey(llmApiKey: string | null): void;
  /** Build the full CLI command string to invoke the agent with the prompt read from a file */
  buildCommand(promptFilePath: string, options?: CodingAgentOptions): string;
}

/** The coding agent CLI matching an LLM provider (claude for anthropic...), or null when it has none */
export function getCodingAgentInfo(providerType: string): CodingAgentInfo | null {
  switch ((providerType || "").toLowerCase()) {
    case "anthropic":
      return claudeCodingAgentInfo();
    case "google-genai":
      return geminiCodingAgentInfo();
    case "openai":
      return codexCodingAgentInfo();
    default:
      // Ollama has no corresponding coding agent CLI
      return null;
  }
}

function claudeCodingAgentInfo(): CodingAgentInfo {
  return {
    agentType: "claude",
    command: "claude",
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    setupApiKey(llmApiKey: string | null): void {
      if (!process.env.ANTHROPIC_API_KEY && llmApiKey) {
        process.env.ANTHROPIC_API_KEY = llmApiKey;
      }
    },
    buildCommand(promptFilePath: string, options?: CodingAgentOptions): string {
      // Use --allowedTools with broad patterns instead of --dangerously-skip-permissions.
      // This works consistently in all environments (root, Docker, non-root) and is safer.
      const modelFlag = options?.model ? ` --model ${options.model}` : "";
      const maxTurnsFlag = options?.maxTurns ? ` --max-turns ${options.maxTurns}` : "";
      return `cat "${promptFilePath}" | claude -p${modelFlag}${maxTurnsFlag} --allowedTools "Bash(*)" "Read" "Edit" "Write" "WebFetch(*)" -`;
    },
  };
}

function geminiCodingAgentInfo(): CodingAgentInfo {
  return {
    agentType: "gemini-cli",
    command: "gemini",
    apiKeyEnvVar: "GEMINI_API_KEY",
    setupApiKey(llmApiKey: string | null): void {
      if (!process.env.GEMINI_API_KEY && llmApiKey) {
        process.env.GEMINI_API_KEY = llmApiKey;
      }
    },
    buildCommand(promptFilePath: string, options?: CodingAgentOptions): string {
      const modelFlag = options?.model ? ` --model ${options.model}` : "";
      return `cat "${promptFilePath}" | gemini${modelFlag} -p -`;
    },
  };
}

function codexCodingAgentInfo(): CodingAgentInfo {
  const GATEWAY_PROVIDER_ID = "sfdx-hardis-gateway";

  return {
    agentType: "codex-cli",
    command: "codex",
    apiKeyEnvVar: "OPENAI_API_KEY",
    setupApiKey(llmApiKey: string | null): void {
      if (!process.env.OPENAI_API_KEY && !process.env.CODEX_API_KEY && llmApiKey) {
        process.env.OPENAI_API_KEY = llmApiKey;
      }
      const baseUrl = readLlmEnvSetting("baseUrl");
      if (baseUrl && !process.env.OPENAI_BASE_URL) {
        process.env.OPENAI_BASE_URL = baseUrl;
      }
      const { headers: gatewayHeaders } = parseDefaultHeaders(readLlmEnvSetting("defaultHeaders"));
      if (gatewayHeaders && !process.env.OPENAI_API_KEY && !process.env.CODEX_API_KEY) {
        process.env.OPENAI_API_KEY = "";
      }
    },
    buildCommand(promptFilePath: string, options?: CodingAgentOptions): string {
      let modelFlag = options?.model ? ` --model ${shellEscape(options.model)}` : "";
      let configFlags = "";

      const { headers } = parseDefaultHeaders(
        readLlmEnvSetting("defaultHeaders")
          || getEnvVar("CODEX_DEFAULT_HEADERS")
          || getEnvVar("OPENAI_DEFAULT_HEADERS"),
      );
      const baseUrl = readLlmEnvSetting("baseUrl")
        || getEnvVar("CODEX_BASE_URL")
        || getEnvVar("OPENAI_BASE_URL");
      if (headers && baseUrl) {
        configFlags += ` --config model_providers.${GATEWAY_PROVIDER_ID}.base_url=${shellEscape(baseUrl)}`;
        configFlags += ` --config model_providers.${GATEWAY_PROVIDER_ID}.wire_api=responses`;
        for (const [key, value] of Object.entries(headers)) {
          configFlags += ` --config model_providers.${GATEWAY_PROVIDER_ID}.http_headers.${shellEscape(key)}=${shellEscape(value)}`;
        }

        const modelName = options?.model || "";
        if (modelName && !modelName.includes("/")) {
          modelFlag = ` --model ${shellEscape(`${GATEWAY_PROVIDER_ID}/${modelName}`)}`;
        } else if (!modelName) {
          modelFlag = ` --model ${shellEscape(`${GATEWAY_PROVIDER_ID}/gpt-4o`)}`;
        }
      }

      return `cat "${promptFilePath}" | codex${modelFlag}${configFlags} --approval-mode full-auto -q -`;
    },
  };
}

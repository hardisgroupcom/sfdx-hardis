// Runs the Codex CLI (`codex exec --json`) for the Codex AI provider.
// sfdx-hardis does not bundle Codex: the CLI is installed by the user (npm install -g @openai/codex),
// or found with the CODEX_CLI_PATH environment variable.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { whichSync, type WhichOptions } from "../utils/whichUtils.js";

export const CODEX_GATEWAY_PROVIDER_ID = "sfdx-hardis-gateway";

export interface CodexCommand {
  /** Executable to start */
  command: string;
  /** Arguments placed before the Codex arguments (the codex.js script when started with node) */
  prefixArgs: string[];
}

export interface CodexExecConfig {
  model: string;
  reasoningEffort: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

export interface CodexExecResult {
  finalResponse: string;
}

export interface ResolveCodexCommandOptions extends WhichOptions {
  /** Explicit location of the Codex CLI (defaults to the CODEX_CLI_PATH environment variable) */
  cliPath?: string;
}

/**
 * Finds the Codex CLI: CODEX_CLI_PATH first, then `codex` in PATH.
 * On Windows, an npm shim (codex.cmd) cannot be started without a shell, so the codex.js script
 * next to it is started with the current Node.js instead.
 * Returns null when no usable CLI is found.
 */
export function resolveCodexCommand(options: ResolveCodexCommandOptions = {}): CodexCommand | null {
  const windows = options.windows ?? process.platform === "win32";
  const cliPath = (options.cliPath ?? process.env.CODEX_CLI_PATH ?? "").trim();
  let executable: string | null;
  if (cliPath) {
    executable = existsSync(cliPath) ? cliPath : null;
  } else {
    executable = whichSync("codex", { ...options, nothrow: true });
  }
  if (!executable) {
    return null;
  }
  if (windows && /\.(cmd|bat|ps1)$/i.test(executable)) {
    const codexJs = path.join(path.dirname(executable), "node_modules", "@openai", "codex", "bin", "codex.js");
    if (!existsSync(codexJs)) {
      return null;
    }
    return { command: process.execPath, prefixArgs: [codexJs] };
  }
  if (/\.(c|m)?js$/i.test(executable)) {
    return { command: process.execPath, prefixArgs: [executable] };
  }
  return { command: executable, prefixArgs: [] };
}

/**
 * Builds the `codex exec` arguments: JSON events on stdout, read-only sandbox, no approval prompt.
 * With a base URL and gateway headers, a custom model provider holds the headers.
 */
export function buildCodexExecArgs(config: CodexExecConfig): string[] {
  const args = ["exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check"];
  const hasGateway = !!config.baseUrl && !!config.defaultHeaders && Object.keys(config.defaultHeaders).length > 0;
  args.push("--model", hasGateway ? `${CODEX_GATEWAY_PROVIDER_ID}/${config.model}` : config.model);
  args.push("--config", `approval_policy=${toTomlValue("never")}`);
  args.push("--config", `model_reasoning_effort=${toTomlValue(config.reasoningEffort)}`);
  if (config.baseUrl) {
    args.push("--config", `openai_base_url=${toTomlValue(config.baseUrl)}`);
  }
  if (hasGateway) {
    const prefix = `model_providers.${CODEX_GATEWAY_PROVIDER_ID}`;
    args.push("--config", `${prefix}.name=${toTomlValue("sfdx-hardis Gateway")}`);
    args.push("--config", `${prefix}.base_url=${toTomlValue(config.baseUrl as string)}`);
    args.push("--config", `${prefix}.wire_api=${toTomlValue("responses")}`);
    args.push("--config", `${prefix}.http_headers=${toTomlValue(config.defaultHeaders as Record<string, string>)}`);
  }
  return args;
}

/**
 * Starts the Codex CLI, writes the prompt on stdin and returns the last agent message.
 * Throws when the CLI cannot start, exits with an error, or reports a failed turn.
 */
export async function runCodexExec(
  codexCommand: CodexCommand,
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CodexExecResult> {
  const child = spawn(codexCommand.command, [...codexCommand.prefixArgs, ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let spawnError: Error | null = null;
  child.once("error", (err) => (spawnError = err));
  // The CLI may exit before reading stdin: the exit code tells why, not the write error
  child.stdin.on("error", () => undefined);
  child.stdin.end(input);

  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", (data: Buffer) => stderrChunks.push(data));
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  const lines: string[] = [];
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) {
    lines.push(line);
  }
  const { code, signal } = await exitPromise;
  if (spawnError) {
    throw spawnError;
  }
  if (code !== 0 || signal) {
    // A failed turn also ends with exit code 1: its message says more than the stderr logs
    try {
      parseCodexEvents(lines);
    } catch (error) {
      if (!(error as Error).message.startsWith("Failed to parse Codex event")) {
        throw error;
      }
    }
    const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    throw new Error(`Codex CLI exited with ${detail}: ${stderr.slice(-2000)}`);
  }
  return parseCodexEvents(lines);
}

/**
 * Reads the JSON events printed by `codex exec --json`, one per line.
 * The last completed agent message is the response; unknown event types are ignored.
 * An `error` event can be a retry notice, so it only fails the call when no message came.
 */
export function parseCodexEvents(lines: string[]): CodexExecResult {
  let finalResponse = "";
  let lastError = "";
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let event: any;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`Failed to parse Codex event: ${line}`, { cause: error });
    }
    if (event?.type === "item.completed" && event.item?.type === "agent_message") {
      finalResponse = event.item.text ?? "";
    } else if (event?.type === "turn.failed") {
      throw new Error(event.error?.message || "Codex turn failed");
    } else if (event?.type === "error") {
      lastError = event.message || "Codex error";
    }
  }
  if (!finalResponse && lastError) {
    throw new Error(lastError);
  }
  return { finalResponse };
}

function toTomlValue(value: string | Record<string, string>): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  const parts = Object.entries(value).map(([key, child]) => `${formatTomlKey(key)} = ${JSON.stringify(child)}`);
  return `{${parts.join(", ")}}`;
}

function formatTomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

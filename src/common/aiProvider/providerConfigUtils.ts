import { getConfig, getEnvVar } from "../../config/index.js";
import { LogType } from "../websocketClient.js";

interface BooleanFlagOptions {
  envVar: string;
  configKey: string;
  legacyConfigKey?: string;
  defaultValue?: boolean;
}

interface BooleanFlagResult {
  enabled: boolean;
  rootConfig: Record<string, any>;
}

export async function resolveBooleanFlag(options: BooleanFlagOptions): Promise<BooleanFlagResult> {
  const projectConfig = await getConfig("user", { cache: true });
  const rootConfig = projectConfig || {};
  const envValue = parseBoolean(getEnvVar(options.envVar));
  const configValue = readBooleanConfig(rootConfig, options.configKey, options.legacyConfigKey);
  const enabled = envValue ?? configValue ?? (options.defaultValue ?? false);
  return { enabled, rootConfig };
}

function readBooleanConfig(rootConfig: Record<string, any>, camelCaseKey: string, legacyKey?: string): boolean | undefined {
  const camelValue = rootConfig[camelCaseKey];
  if (typeof camelValue === "boolean") {
    return camelValue;
  }
  const uppercaseKey = (legacyKey ?? camelCaseKey.toUpperCase());
  const legacyValue = rootConfig[uppercaseKey];
  if (typeof legacyValue === "boolean") {
    return legacyValue;
  }
  return undefined;
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value == null) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

/**
 * Parse and validate a JSON string into a Record<string, string> of HTTP headers.
 * Returns undefined if the input is falsy, not valid JSON, not a plain object,
 * or contains non-string values.
 */
export function parseDefaultHeaders(
  raw: string | null | undefined,
  label: string,
  logger?: (level: LogType, scope: unknown, message: string) => void,
): Record<string, string> | undefined {
  if (!raw) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger?.("warning", null, `[${label}] Default headers value is not valid JSON — ignoring.`);
    return undefined;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    logger?.("warning", null, `[${label}] Default headers must be a JSON object — ignoring.`);
    return undefined;
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) {
    return undefined;
  }
  for (const [key, value] of entries) {
    if (typeof value !== "string") {
      logger?.("warning", null, `[${label}] Default header "${key}" has a non-string value — ignoring all headers.`);
      return undefined;
    }
  }
  return parsed as Record<string, string>;
}

/**
 * Shell-escape a value for safe interpolation into a shell command string.
 * Wraps the value in single quotes with proper escaping of embedded single quotes.
 */
export function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

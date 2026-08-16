import { getConfig, getEnvVar } from "../../config/index.js";

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

export type HeaderParseErrorCode =
  | "invalidJson"
  | "notObject"
  | "nonStringValue"
  | "invalidHeaderName";

/** Maps each error code to the corresponding i18n translation key. */
export const HEADER_PARSE_I18N_KEYS: Record<HeaderParseErrorCode, string> = {
  invalidJson: "defaultHeadersInvalidJson",
  notObject: "defaultHeadersNotObject",
  nonStringValue: "defaultHeadersNonStringValue",
  invalidHeaderName: "defaultHeadersInvalidHeaderName",
};

export interface HeaderParseResult {
  headers?: Record<string, string>;
  error?: HeaderParseErrorCode;
  /** The offending header key, when the error is key-specific. */
  errorKey?: string;
}

/**
 * Parse and validate a JSON string into a Record<string, string> of HTTP headers.
 *
 * Returns `{ headers }` on success. On failure, returns `{ error, errorKey? }`
 * so callers can emit a localized warning via `t()`.
 * Returns `{}` (no headers, no error) when the input is falsy or an empty object.
 */
export function parseDefaultHeaders(raw: string | null | undefined): HeaderParseResult {
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "invalidJson" };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "notObject" };
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) {
    return {};
  }
  for (const [key, value] of entries) {
    if (typeof value !== "string") {
      return { error: "nonStringValue", errorKey: key };
    }
    if (!isValidHeaderName(key)) {
      return { error: "invalidHeaderName", errorKey: key };
    }
  }
  return { headers: parsed as Record<string, string> };
}

/** RFC 7230 token characters allowed in HTTP header field-names. */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/;

function isValidHeaderName(name: string): boolean {
  return HEADER_NAME_RE.test(name);
}

/**
 * Shell-escape a value for safe interpolation into a shell command string.
 * Wraps the value in single quotes with proper escaping of embedded single quotes.
 */
export function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

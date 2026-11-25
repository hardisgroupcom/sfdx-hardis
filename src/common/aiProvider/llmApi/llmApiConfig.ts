import c from "chalk";
import { getConfig, getEnvVar } from "../../../config/index.js";
import { uxLog } from "../../utils/index.js";
import { t } from "../../utils/i18n.js";
import { HEADER_PARSE_I18N_KEYS, parseDefaultHeaders, resolveBooleanFlag } from "../utils/providerConfigUtils.js";
import { LlmClientConfig, LlmProviderType } from "./llmClientBase.js";

/**
 * Settings of the LLM API provider.
 *
 * The AI_LLM_* environment variables and aiLlm* config keys replace the LANGCHAIN_LLM_* and
 * langchainLlm* ones, which keep working with a warning. A new name always wins over an old one,
 * and an environment variable over a config key.
 */
export interface LlmApiSettings extends LlmClientConfig {
  provider: string;
}

type LlmSettingKey =
  | "enabled"
  | "provider"
  | "model"
  | "apiKey"
  | "baseUrl"
  | "defaultHeaders"
  | "temperature"
  | "maxTokens"
  | "maxRetries"
  | "timeout";

interface LlmSettingNames {
  env: string;
  legacyEnv: string;
  config?: string;
  legacyConfig?: string[];
}

const LLM_SETTING_NAMES: Record<LlmSettingKey, LlmSettingNames> = {
  enabled: { env: "USE_AI_LLM", legacyEnv: "USE_LANGCHAIN_LLM", config: "useAiLlm", legacyConfig: ["useLangchainLlm", "USE_LANGCHAIN_LLM"] },
  provider: { env: "AI_LLM_PROVIDER", legacyEnv: "LANGCHAIN_LLM_PROVIDER", config: "aiLlmProvider", legacyConfig: ["langchainLlmProvider", "LANGCHAIN_LLM_PROVIDER"] },
  model: { env: "AI_LLM_MODEL", legacyEnv: "LANGCHAIN_LLM_MODEL", config: "aiLlmModel", legacyConfig: ["langchainLlmModel", "LANGCHAIN_LLM_MODEL"] },
  apiKey: { env: "AI_LLM_API_KEY", legacyEnv: "LANGCHAIN_LLM_MODEL_API_KEY" },
  baseUrl: { env: "AI_LLM_BASE_URL", legacyEnv: "LANGCHAIN_LLM_BASE_URL", config: "aiLlmBaseUrl", legacyConfig: ["langchainLlmBaseUrl", "LANGCHAIN_LLM_BASE_URL"] },
  defaultHeaders: { env: "AI_LLM_DEFAULT_HEADERS", legacyEnv: "LANGCHAIN_LLM_DEFAULT_HEADERS" },
  temperature: { env: "AI_LLM_TEMPERATURE", legacyEnv: "LANGCHAIN_LLM_TEMPERATURE", config: "aiLlmTemperature", legacyConfig: ["langchainLlmTemperature", "LANGCHAIN_LLM_TEMPERATURE"] },
  maxTokens: { env: "AI_LLM_MAX_TOKENS", legacyEnv: "LANGCHAIN_LLM_MAX_TOKENS", config: "aiLlmMaxTokens", legacyConfig: ["langchainLlmMaxTokens", "LANGCHAIN_LLM_MAX_TOKENS"] },
  maxRetries: { env: "AI_LLM_MAX_RETRIES", legacyEnv: "LANGCHAIN_LLM_MAX_RETRIES", config: "aiLlmMaxRetries", legacyConfig: ["langchainLlmMaxRetries", "LANGCHAIN_LLM_MAX_RETRIES"] },
  timeout: { env: "AI_LLM_TIMEOUT", legacyEnv: "LANGCHAIN_LLM_TIMEOUT", config: "aiLlmTimeout", legacyConfig: ["langchainLlmTimeout", "LANGCHAIN_LLM_TIMEOUT"] },
};

const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_SERVICE_TIERS = ["auto", "default", "flex"];
const OPENAI_REASONING_EFFORTS = ["low", "medium", "high"];

// Each deprecated name is reported once per run, not at every AI call
const warnedDeprecatedNames = new Set<string>();

/**
 * The settings of an LLM API explicitly configured with AI_LLM_* (or the former LANGCHAIN_LLM_*),
 * or null when none is enabled.
 */
export async function resolveExplicitLlmSettings(): Promise<LlmApiSettings | null> {
  const rootConfig = (await getConfig("user", { cache: true })) || {};
  const provider = readStringSetting("provider", rootConfig);
  const modelName = readStringSetting("model", rootConfig);
  const enabledValue = readSetting("enabled", rootConfig);
  const enabled = parseBooleanValue(enabledValue) ?? Boolean(provider && modelName);
  if (!enabled || !provider || !modelName) {
    return null;
  }
  return {
    provider: provider.toLowerCase(),
    modelName,
    openAiApi: "chat",
    apiKey: readStringSetting("apiKey", rootConfig) || undefined,
    baseUrl: readStringSetting("baseUrl", rootConfig) || undefined,
    defaultHeaders: readDefaultHeaders(readStringSetting("defaultHeaders", rootConfig), "AI LLM"),
    temperature: parseNumberValue(readSetting("temperature", rootConfig)),
    maxTokens: parseNumberValue(readSetting("maxTokens", rootConfig)),
    maxRetries: parseNumberValue(readSetting("maxRetries", rootConfig)),
    timeout: parseNumberValue(readSetting("timeout", rootConfig)),
  };
}

/**
 * The settings of the OpenAI shortcut: OPENAI_API_KEY (or a gateway with OPENAI_BASE_URL and
 * OPENAI_DEFAULT_HEADERS) calls the OpenAI Responses API, unless USE_OPENAI_DIRECT is false.
 */
export async function resolveOpenAiShortcutSettings(): Promise<LlmApiSettings | null> {
  const apiKey = getEnvVar("OPENAI_API_KEY") || undefined;
  const baseUrl = getEnvVar("OPENAI_BASE_URL") || undefined;
  const defaultHeaders = readDefaultHeaders(getEnvVar("OPENAI_DEFAULT_HEADERS"), "OpenAI");
  const hasGatewayAuth = baseUrl && defaultHeaders && Object.keys(defaultHeaders).length > 0;
  if (!apiKey && !hasGatewayAuth) {
    return null;
  }
  const { enabled, rootConfig } = await resolveBooleanFlag({
    envVar: "USE_OPENAI_DIRECT",
    configKey: "useOpenaiDirect",
    defaultValue: true,
  });
  if (!enabled) {
    return null;
  }
  return {
    provider: "openai",
    modelName: getEnvVar("OPENAI_MODEL") || rootConfig.openaiModel || rootConfig.OPENAI_MODEL || OPENAI_DEFAULT_MODEL,
    openAiApi: "responses",
    apiKey,
    baseUrl,
    defaultHeaders,
    serviceTier: enumValue(getEnvVar("OPENAI_SERVICE_TIER") || rootConfig.openaiServiceTier || rootConfig.OPENAI_SERVICE_TIER, OPENAI_SERVICE_TIERS),
    reasoningEffort: enumValue(
      getEnvVar("OPENAI_REASONING_EFFORT") || rootConfig.openaiReasoningEffort || rootConfig.OPENAI_REASONING_EFFORT,
      OPENAI_REASONING_EFFORTS,
    ),
  };
}

/** The configured LLM provider type (AI_LLM_PROVIDER or its former name), from env or the given config */
export function readLlmProviderSetting(config: Record<string, any> | null | undefined): LlmProviderType | null {
  const provider = readStringSetting("provider", config || {});
  return provider ? (provider.toLowerCase() as LlmProviderType) : null;
}

/** The LLM API key (AI_LLM_API_KEY or its former name) and the name of the variable that holds it */
export function readLlmApiKeySetting(): { value: string; name: string } | null {
  return readEnvSetting("apiKey");
}

/** A setting read from the environment only (AI_LLM_* first, then LANGCHAIN_LLM_*) */
export function readLlmEnvSetting(key: "baseUrl" | "defaultHeaders"): string | null {
  return readEnvSetting(key)?.value ?? null;
}

/** Test seam: report the deprecated names again */
export function resetDeprecatedNameWarningsForTests(): void {
  warnedDeprecatedNames.clear();
}

function readEnvSetting(key: LlmSettingKey): { value: string; name: string } | null {
  const names = LLM_SETTING_NAMES[key];
  const value = getEnvVar(names.env);
  if (value) {
    return { value, name: names.env };
  }
  const legacyValue = getEnvVar(names.legacyEnv);
  if (legacyValue) {
    warnDeprecatedName(names.legacyEnv, names.env);
    return { value: legacyValue, name: names.legacyEnv };
  }
  return null;
}

function readSetting(key: LlmSettingKey, rootConfig: Record<string, any>): any {
  const fromEnv = readEnvSetting(key);
  if (fromEnv) {
    return fromEnv.value;
  }
  const names = LLM_SETTING_NAMES[key];
  if (!names.config) {
    return undefined;
  }
  if (isSet(rootConfig[names.config])) {
    return rootConfig[names.config];
  }
  for (const legacyKey of names.legacyConfig || []) {
    if (isSet(rootConfig[legacyKey])) {
      warnDeprecatedName(legacyKey, names.config);
      return rootConfig[legacyKey];
    }
  }
  return undefined;
}

function readStringSetting(key: LlmSettingKey, rootConfig: Record<string, any>): string | null {
  const value = readSetting(key, rootConfig);
  return isSet(value) ? String(value).trim() || null : null;
}

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function warnDeprecatedName(oldName: string, newName: string): void {
  if (warnedDeprecatedNames.has(oldName)) {
    return;
  }
  warnedDeprecatedNames.add(oldName);
  uxLog("warning", "LlmApiConfig", c.yellow(t("aiSettingDeprecated", { oldName, newName })));
}

function readDefaultHeaders(raw: string | null, label: string): Record<string, string> | undefined {
  const headerResult = parseDefaultHeaders(raw);
  if (headerResult.error) {
    uxLog("warning", "LlmApiConfig", c.yellow(t(HEADER_PARSE_I18N_KEYS[headerResult.error], { label, key: headerResult.errorKey })));
  }
  return headerResult.headers;
}

function parseBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
}

function parseNumberValue(value: unknown): number | undefined {
  if (!isSet(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function enumValue(rawValue: string | null | undefined, supportedValues: string[]): string | undefined {
  if (!rawValue) {
    return undefined;
  }
  const normalized = String(rawValue).toLowerCase();
  return supportedValues.includes(normalized) ? normalized : undefined;
}

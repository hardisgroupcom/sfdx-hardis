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

import { isAgentMode } from './envUtils.js';
import { whichSync } from './whichUtils.js';
import { runSilentCommand, SilentCommandResult } from './silentCommandUtils.js';
import { registerSecretValue } from './secretMaskingUtils.js';
import { t } from './i18n.js';

/*
Tokens of the command line tools of the git providers (gh, glab, az), for coding agents.

A coding agent on a workstation runs sfdx-hardis with --agent: when no token variable is set, or
when the one that is set is refused, the token of the CLI the developer is already logged in with
is used, for this process only. Nothing here names a provider: each provider class says which CLI
it uses and how to read its token, and this file runs it without ever showing the token.
*/

/** The command line tool a provider reads its token from */
export interface ProviderCliTokenSource {
  /** Name of the executable, also the token source reported to the user */
  cli: string;
  installUrl: string;
  loginCommand: (host: string) => string;
  /** Said when the provider refuses the token of the CLI for the repository of remoteUrl */
  refusedHint?: (remoteUrl: string) => Promise<string | null>;
}

export interface ProviderCliTokenResult {
  token: string | null;
  /** Null when the provider has no CLI */
  source: ProviderCliTokenSource | null;
  host: string;
  reason?: 'notInstalled' | 'notLoggedIn' | 'failed';
  exitCode?: number;
}

/** Where the token a provider uses comes from */
export interface ProviderTokenInfo {
  /** 'env' for a variable of the environment or of the .env file, otherwise the name of the CLI */
  source: string;
  variable: string;
}

/** Whether one git or ticketing provider accepts the credentials sfdx-hardis has for it */
export interface ProviderConnectionStatus {
  type: 'git' | 'ticketing';
  /** Key of the provider (github, jira...), null when none could be determined */
  provider: string | null;
  label: string | null;
  connected: boolean;
  /** 'env', the name of the CLI the token was read from, or null when there is no token */
  tokenSource: string | null;
  /** What to do when the provider is not connected, null otherwise */
  detail: string | null;
}

// The executables are found once per process
const cliPaths = new Map<string, string | null>();
const tokenInfos = new Map<string, ProviderTokenInfo>();
const cliFailures = new Map<string, string>();
// Tokens kept by a provider instead of a token variable (Azure Boards), null once the CLI gave none
const keptCliTokens = new Map<string, string | null>();
const CLI_TIMEOUT_MS = 20000;
const VALID_HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/;

/**
 * True when sfdx-hardis may read a token from a provider CLI: never in CI, always when
 * SFDX_HARDIS_PROVIDER_CLI_AUTH=true, never when it is false, and otherwise in agent mode.
 */
export function isProviderCliAuthEnabled(): boolean {
  // Read at each call, like the other settings of this function
  if (process.env.CI != null) {
    return false;
  }
  const setting = (process.env.SFDX_HARDIS_PROVIDER_CLI_AUTH || '').toLowerCase();
  if (setting === 'true') {
    return true;
  }
  if (setting === 'false') {
    return false;
  }
  return isAgentMode();
}

/** False when SFDX_HARDIS_PROVIDER_TOKEN_CHECK=false: a token is then used without the check call */
export function isProviderTokenCheckEnabled(): boolean {
  return (process.env.SFDX_HARDIS_PROVIDER_TOKEN_CHECK || '').toLowerCase() !== 'false';
}

/**
 * The host a CLI is logged in to, from the server URL a provider parsed out of a git remote, or ""
 * when it cannot be passed to a CLI. The port of an SSH remote is the SSH port, not part of the
 * host the CLI knows.
 */
export function cliHostFromServerUrl(serverUrl: string | null | undefined, remoteUrl: string): string {
  try {
    const url = new URL(serverUrl || '');
    const host = /^https?:\/\//i.test(remoteUrl) ? url.host : url.hostname;
    return VALID_HOST.test(host) ? host : '';
  } catch {
    return '';
  }
}

/**
 * Runs a provider CLI without displaying anything of it. Returns null when the CLI is not
 * installed. The variables a CLI reads its token from first are removed, so it answers with the
 * token it stores itself and not with the one sfdx-hardis already has.
 */
export async function runProviderCli(
  cli: string,
  args: string[],
  options: { removeEnvVars?: string[]; extraEnv?: Record<string, string> } = {},
): Promise<SilentCommandResult | null> {
  const executable = findProviderCli(cli);
  if (!executable) {
    return null;
  }
  const env: NodeJS.ProcessEnv = { ...process.env, ...(options.extraEnv || {}) };
  for (const name of options.removeEnvVars || []) {
    delete env[name];
  }
  return runSilentCommand(executable, args, { env, timeoutMs: CLI_TIMEOUT_MS });
}

/** The token read from a CLI: registered as a secret before anything can display it */
export function cliTokenFound(token: string, source: ProviderCliTokenSource, host: string): ProviderCliTokenResult {
  registerSecretValue(token);
  return { token, source, host };
}

export function recordProviderTokenInfo(providerKey: string, info: ProviderTokenInfo): void {
  tokenInfos.set(providerKey, info);
}

export function getProviderTokenInfo(providerKey: string): ProviderTokenInfo | null {
  return tokenInfos.get(providerKey) || null;
}

export function recordProviderCliFailure(providerKey: string, detail: string): void {
  cliFailures.set(providerKey, detail);
}

export function getProviderCliFailure(providerKey: string): string | null {
  return cliFailures.get(providerKey) || null;
}

/** A token of a CLI kept for one provider only, null when the CLI gave none, undefined when not asked yet */
export function recordKeptCliToken(providerKey: string, token: string | null): void {
  keptCliTokens.set(providerKey, token);
}

export function getKeptCliToken(providerKey: string): string | null | undefined {
  return keptCliTokens.get(providerKey);
}

/** What the user has to do when a CLI gave no token, or null when there is nothing to say */
export function describeCliTokenFailure(result: ProviderCliTokenResult): string | null {
  const source = result.source;
  if (!source || result.token) {
    return null;
  }
  const command = source.loginCommand(result.host);
  switch (result.reason) {
    case 'notInstalled':
      return t('providerCliNotInstalled', { cli: source.cli, url: source.installUrl, command });
    case 'notLoggedIn':
      return t('providerCliNotLoggedIn', { cli: source.cli, host: result.host, command });
    default:
      return t('providerCliFailed', { cli: source.cli, host: result.host, code: result.exitCode ?? 1, command });
  }
}

/** Joins the parts of a connection detail as sentences: an error message often has no final period */
export function joinDetailSentences(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .map((part) => (/[.!?:]$/.test(part) ? part : `${part}.`))
    .join(' ');
}

/** For tests only */
export function resetProviderCliAuthState(): void {
  cliPaths.clear();
  tokenInfos.clear();
  cliFailures.clear();
  keptCliTokens.clear();
}

function findProviderCli(cli: string): string | null {
  if (!cliPaths.has(cli)) {
    cliPaths.set(cli, whichSync(cli, { nothrow: true, skipCurrentDirectory: true }));
  }
  return cliPaths.get(cli) || null;
}

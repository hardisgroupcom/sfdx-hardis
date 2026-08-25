/*
 * In-process replacements for a few read-mostly `sf` commands.
 *
 * Spawning the Salesforce CLI costs 2.5 to 4 seconds per call, almost all of it startup
 * (node boot, oclif plugin manifests, import of the command module graph). For commands
 * that only read local auth/config files, `@salesforce/core` can do the same work in
 * a few milliseconds inside the sfdx-hardis process.
 *
 * Safety rules:
 * - The JSON returned mirrors the `--json` output of the real command, so call sites are unchanged.
 * - Anything not recognized (extra flags, scratch orgs, unknown keys, any exception) returns
 *   null and the caller falls back to spawning the real `sf` command.
 * - Disabled with SFDX_HARDIS_ENHANCE_PERFORMANCE=false.
 */
import { AuthInfo, Config, ConfigAggregator, Org, OrgConfigProperties, StateAggregator } from '@salesforce/core';
import c from 'chalk';
import { isSfPerformanceEnhanced, uxLog } from './index.js';

const REDACTED_ACCESS_TOKEN = "[REDACTED] Use 'sf org auth show-access-token' to view";
const REDACTED_PASSWORD = "[REDACTED] Use 'sf org auth show-user-password' to view";

export type ParsedSfCommand =
  | { kind: 'org-display'; targetOrg: string | null }
  | { kind: 'config-get'; keys: string[] }
  | { kind: 'config-set'; entries: Array<{ name: string; value: string }>; global: boolean };

// Split a command line on spaces, honoring simple single or double quotes.
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  let inToken = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      inToken = true;
    } else if (/\s/.test(char)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
    } else {
      current += char;
      inToken = true;
    }
  }
  if (inToken) {
    tokens.push(current);
  }
  return tokens;
}

// Recognize the exact command shapes handled in-process. Any other shape returns null.
export function parseSfCommand(command: string): ParsedSfCommand | null {
  const tokens = tokenizeCommand(command.trim());
  if (tokens.length < 3 || tokens[0] !== 'sf') {
    return null;
  }
  const topic = tokens[1];
  const action = tokens[2];
  const rest = tokens.slice(3).filter((token) => token !== '--json');

  if (topic === 'org' && action === 'display') {
    let targetOrg: string | null = null;
    for (let i = 0; i < rest.length; i++) {
      const token = rest[i];
      if ((token === '--target-org' || token === '-o') && i + 1 < rest.length && !rest[i + 1].startsWith('-')) {
        targetOrg = rest[i + 1];
        i++;
      } else if (token.startsWith('--target-org=')) {
        targetOrg = token.substring('--target-org='.length);
      } else {
        // --verbose, --api-version, or anything else: let the real CLI handle it
        return null;
      }
    }
    return { kind: 'org-display', targetOrg };
  }

  if (topic === 'config' && action === 'get') {
    if (rest.length === 0 || rest.some((token) => token.startsWith('-') && token !== '--verbose')) {
      return null;
    }
    return { kind: 'config-get', keys: rest.filter((token) => token !== '--verbose') };
  }

  if (topic === 'config' && action === 'set') {
    let global = false;
    const entries: Array<{ name: string; value: string }> = [];
    for (const token of rest) {
      if (token === '--global' || token === '-g') {
        global = true;
      } else if (token.startsWith('-')) {
        return null;
      } else {
        const eqPos = token.indexOf('=');
        if (eqPos <= 0) {
          return null;
        }
        entries.push({ name: token.substring(0, eqPos), value: token.substring(eqPos + 1) });
      }
    }
    if (entries.length === 0) {
      return null;
    }
    return { kind: 'config-set', entries, global };
  }

  return null;
}

// Try to run the command in-process. Returns null when the command must be run by the real sf CLI.
export async function tryRunSfCommandInProcess(command: string, commandThis: any): Promise<any | null> {
  if (!isSfPerformanceEnhanced()) {
    return null;
  }
  const parsed = parseSfCommand(command);
  if (parsed == null) {
    return null;
  }
  try {
    let result: any = null;
    if (parsed.kind === 'org-display') {
      result = await orgDisplayInProcess(parsed.targetOrg);
    } else if (parsed.kind === 'config-get') {
      result = await configGetInProcess(parsed.keys);
    } else if (parsed.kind === 'config-set') {
      result = await configSetInProcess(parsed.entries, parsed.global);
    }
    if (result == null) {
      return null;
    }
    uxLog('other', commandThis, `[sfdx-hardis][command] ${c.bold(c.bgWhite(c.blue(command)))} ${c.grey(c.italic('(in-process)'))}`);
    return { status: 0, result: result, warnings: [] };
  } catch (e) {
    // Any failure: fall back to the real CLI so behavior and error messages stay unchanged
    if (process.env.SFDX_HARDIS_DEBUG_ENV === 'true') {
      uxLog('other', commandThis, c.grey(`[sfdx-hardis] In-process run of "${command}" failed, falling back to sf CLI: ${(e as Error).message}`));
    }
    return null;
  }
}

// Mirrors @salesforce/plugin-org `org display` for non-scratch orgs
async function orgDisplayInProcess(targetOrg: string | null): Promise<any | null> {
  let aliasOrUsername = targetOrg;
  if (!aliasOrUsername) {
    const aggregator = await ConfigAggregator.create();
    await aggregator.reload();
    aliasOrUsername = (aggregator.getPropertyValue(OrgConfigProperties.TARGET_ORG) as string) || null;
    if (!aliasOrUsername) {
      return null;
    }
  }
  const org = await Org.create({ aliasOrUsername });
  const authInfo = await AuthInfo.create({ username: org.getUsername() });
  const fields: any = authInfo.getFields(true);
  if (fields.devHubUsername) {
    // Scratch org: `org display` queries the Dev Hub for status and expiration date, keep the real CLI for that
    return null;
  }
  let connectedStatus: string;
  try {
    await org.refreshAuth();
    connectedStatus = 'Connected';
  } catch (err: any) {
    const message: string = err?.message || '';
    if (message.includes('maintenance')) {
      connectedStatus = 'Down (Maintenance)';
    } else if (message.includes('<html>') || message.includes('<!DOCTYPE HTML>')) {
      connectedStatus = 'Bad Response';
    } else {
      connectedStatus = err?.code ?? message;
    }
  }
  const showSecrets = process.env.SF_TEMP_SHOW_SECRETS === 'true';
  const stateAggregator = await StateAggregator.getInstance();
  const aliases = stateAggregator.aliases.getAll(fields.username);
  const alias = aliases?.length ? aliases[aliases.length - 1] : undefined;
  return {
    id: fields.orgId,
    devHubId: undefined,
    apiVersion: fields.instanceApiVersion,
    accessToken: showSecrets ? fields.accessToken : REDACTED_ACCESS_TOKEN,
    instanceUrl: fields.instanceUrl,
    username: fields.username,
    clientId: fields.clientId,
    password: fields.password ? (showSecrets ? fields.password : REDACTED_PASSWORD) : undefined,
    connectedStatus: connectedStatus,
    sfdxAuthUrl: undefined,
    alias: alias,
    clientApps: fields.clientApps ? Object.keys(fields.clientApps).join(',') : undefined,
  };
}

// Mirrors @salesforce/plugin-settings `config get`
async function configGetInProcess(keys: string[]): Promise<any[] | null> {
  const aggregator = await ConfigAggregator.create();
  await aggregator.reload();
  const responses: any[] = [];
  for (const key of keys) {
    // Throws on unknown key: caller falls back to the real CLI which produces the usual error
    const info = aggregator.getInfo(key);
    if (info.value !== undefined && info.value !== null && typeof info.value === 'object') {
      return null;
    }
    responses.push({
      name: info.key,
      key: info.key,
      value: info.value,
      path: info.path,
      success: true,
      location: info.location,
    });
  }
  return responses;
}

// Mirrors @salesforce/plugin-settings `config set`
async function configSetInProcess(entries: Array<{ name: string; value: string }>, global: boolean): Promise<any | null> {
  const aggregator = await ConfigAggregator.create();
  const config = await Config.create(Config.getDefaultOptions(global));
  await config.read();
  const successes: any[] = [];
  for (const entry of entries) {
    if (!entry.value) {
      return null;
    }
    const resolvedName = aggregator.getPropertyMeta(entry.name)?.newKey ?? entry.name;
    if (resolvedName === OrgConfigProperties.TARGET_ORG || resolvedName === OrgConfigProperties.TARGET_DEV_HUB) {
      // Same validation as the CLI: the org must be authenticated
      await Org.create({ aliasOrUsername: entry.value });
    }
    config.set(resolvedName, entry.value);
    successes.push({ name: resolvedName, value: entry.value, success: true });
  }
  await config.write();
  return { successes, failures: [] };
}

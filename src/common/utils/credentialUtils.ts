import c from 'chalk';
import { SfError } from '@salesforce/core';
import { execSfdxJson, uxLog } from './index.js';
import { t } from './i18n.js';

// Detect redacted credential placeholders that Salesforce CLI may return
// after the 2026-05-27 credential redaction change in standard outputs.
const REDACTED_PATTERN = /redacted/i;

const LEGACY_WORKAROUND_DOC_URL = 'https://github.com/forcedotcom/cli/issues/3560';

export type CredentialKind = 'access-token' | 'sfdx-auth-url' | 'user-password';

interface CredentialOptions {
  fail?: boolean;
  debug?: boolean;
}

function isRedactedOrEmpty(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value !== 'string') {
    return true;
  }
  if (value.trim() === '') {
    return true;
  }
  return REDACTED_PATTERN.test(value);
}

// Legacy fallback used when `sf org auth show-*` is unavailable or also returns redacted output.
// Passes SF_TEMP_SHOW_SECRETS=true via execOptions so the legacy `sf org display --verbose` output
// still contains the credential. This workaround will be removed by Salesforce in Summer 2026.
async function getCredentialViaLegacy(
  resultField: string,
  targetOrg: string,
  options: CredentialOptions
): Promise<string | null> {
  const command = `sf org display --target-org ${targetOrg} --verbose`;
  const cmdResult = await execSfdxJson(command, this, {
    fail: false,
    output: false,
    debug: options.debug === true,
    env: { SF_TEMP_SHOW_SECRETS: 'true' },
  });
  const value = cmdResult?.result?.[resultField];
  if (isRedactedOrEmpty(value)) {
    return null;
  }
  return value as string;
}

async function getCredential(
  kind: CredentialKind,
  resultField: string,
  targetOrg: string,
  options: CredentialOptions = {}
): Promise<string | null> {
  const fail = options.fail === true;
  const debug = options.debug === true;

  // Primary path: dedicated `sf org auth show-*` command (post-2026-05-27 supported way).
  const command = `sf org auth show-${kind} --target-org ${targetOrg} --no-prompt`;
  const cmdResult = await execSfdxJson(command, this, {
    fail: false,
    output: false,
    debug,
  });
  const value = cmdResult?.result?.[resultField];
  if (!isRedactedOrEmpty(value)) {
    return value as string;
  }

  // Fallback: legacy `sf org display --verbose` with SF_TEMP_SHOW_SECRETS=true.
  // Used when the new command is unavailable (older Salesforce CLI) or also returns a redacted value.
  uxLog(
    'warning',
    this,
    c.yellow(t('credentialFallbackToLegacy', { org: targetOrg, kind, url: LEGACY_WORKAROUND_DOC_URL }))
  );
  const legacyValue = await getCredentialViaLegacy(resultField, targetOrg, options);
  if (legacyValue) {
    return legacyValue;
  }

  // Both paths failed.
  const message = t('unableToRetrieveCredential', { org: targetOrg, kind });
  if (fail) {
    throw new SfError(message);
  }
  uxLog('warning', this, c.yellow(message));
  return null;
}

export async function getOrgAccessToken(
  targetOrg: string,
  options: CredentialOptions = {}
): Promise<string | null> {
  return getCredential('access-token', 'accessToken', targetOrg, options);
}

export async function getOrgSfdxAuthUrl(
  targetOrg: string,
  options: CredentialOptions = {}
): Promise<string | null> {
  return getCredential('sfdx-auth-url', 'sfdxAuthUrl', targetOrg, options);
}

export async function getOrgUserPassword(
  targetOrg: string,
  options: CredentialOptions = {}
): Promise<string | null> {
  return getCredential('user-password', 'password', targetOrg, options);
}

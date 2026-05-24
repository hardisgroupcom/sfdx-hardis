import c from 'chalk';
import { SfError } from '@salesforce/core';
import { execSfdxJson, uxLog } from './index.js';
import { t } from './i18n.js';

// Detect redacted credential placeholders that Salesforce CLI may return
// after the 2026-05-27 credential redaction change in standard outputs.
const REDACTED_PATTERN = /redacted/i;

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

async function getCredential(
  kind: CredentialKind,
  resultField: string,
  targetOrg: string,
  options: CredentialOptions = {}
): Promise<string | null> {
  const fail = options.fail === true;
  const debug = options.debug === true;
  const command = `sf org auth show-${kind} --target-org ${targetOrg} --no-prompt`;
  const cmdResult = await execSfdxJson(command, this, {
    fail: false,
    output: false,
    debug,
  });
  const value = cmdResult?.result?.[resultField];
  if (isRedactedOrEmpty(value)) {
    const message = t('unableToRetrieveCredential', { org: targetOrg, kind });
    if (fail) {
      throw new SfError(message);
    }
    uxLog('warning', this, c.yellow(message));
    return null;
  }
  return value as string;
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

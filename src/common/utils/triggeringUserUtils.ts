/**
 * Resolve the identity of the user who triggered the current command run, so notifications
 * can tell readers who is behind an action instead of showing an anonymous message.
 *
 * Sources are tried in priority order (CI first, then Git, then OS). A candidate only wins
 * when it is actually identifiable: opaque UUIDs, generic CI accounts (`runner`, `root`...)
 * and purely numeric OS logins are rejected and the chain continues.
 *
 * Environment variables reference:
 *   Override:   SFDX_HARDIS_TRIGGERED_BY
 *   GitHub:     GITHUB_TRIGGERING_ACTOR, GITHUB_ACTOR
 *   GitLab:     GITLAB_USER_NAME, GITLAB_USER_EMAIL
 *   Azure:      BUILD_REQUESTEDFOR, BUILD_REQUESTEDFOREMAIL
 *   Jenkins:    BUILD_USER, BUILD_USER_EMAIL, CHANGE_AUTHOR_DISPLAY_NAME, CHANGE_AUTHOR,
 *               CHANGE_AUTHOR_EMAIL
 *   Bitbucket:  BITBUCKET_STEP_TRIGGERER_UUID (opaque, needs an API lookup to be usable)
 *   Generic CI: CI_USER_NAME, CI_USER_EMAIL
 *   sfdx-hardis: USER_EMAIL, userEmail config property
 */
import * as os from 'node:os';
import c from 'chalk';
import { getConfig, getEnvVar } from '../../config/index.js';
import { GitProvider } from '../gitProvider/index.js';
import { isJenkins } from '../gitProvider/jenkinsUtils.js';
import { git, isCI, uxLog } from './index.js';
import { t } from './i18n.js';

export type TriggeringUserSource =
  | 'override'
  | 'github'
  | 'gitlab'
  | 'azure'
  | 'jenkins'
  | 'bitbucket'
  | 'ciGeneric'
  | 'sfdxHardisConfig'
  | 'gitConfig'
  | 'gitCommit'
  | 'os'
  | 'unknown';

export interface TriggeringUser {
  name: string | null;
  email: string | null;
  source: TriggeringUserSource;
  isCiRun: boolean;
  // Display-ready string: "Name (email)", "Name", "email", or the translated "unknown"
  label: string;
}

// Service / runner accounts that identify a machine rather than a person
const GENERIC_ACCOUNT_NAMES = [
  'administrator',
  'azureuser',
  'bitbucket-pipelines',
  'build',
  'builder',
  'ci',
  'docker',
  'github-actions',
  'github-actions[bot]',
  'jenkins',
  'node',
  'root',
  'runner',
  'sfdx',
  'ubuntu',
  'vsts',
];

const UUID_RE = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
const NUMERIC_RE = /^\d+$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const ENRICHMENT_TIMEOUT_MS = 5000;

/**
 * A name identifies a person when it is not empty, not a bare UUID (Bitbucket triggerer),
 * not purely numeric (some Windows accounts are just a customer number) and not a well-known
 * service account.
 */
export function isIdentifiableName(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return false;
  }
  if (NUMERIC_RE.test(trimmed) || UUID_RE.test(trimmed)) {
    return false;
  }
  return !GENERIC_ACCOUNT_NAMES.includes(trimmed.toLowerCase());
}

/**
 * GitHub noreply addresses (123456+login@users.noreply.github.com) are kept on purpose:
 * they carry the login and identify the author.
 */
export function isIdentifiableEmail(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return EMAIL_RE.test(value.trim());
}

export function formatTriggeringUserLabel(user: { name: string | null; email: string | null }): string {
  if (user.name && user.email) {
    return `${user.name} (${user.email})`;
  }
  if (user.name) {
    return user.name;
  }
  if (user.email) {
    return user.email;
  }
  return t('triggeringUserUnknown');
}

// Returns null when neither the name nor the email survives the identifiability guard,
// so the caller keeps walking the source chain.
function buildCandidate(
  name: string | null | undefined,
  email: string | null | undefined,
  source: TriggeringUserSource
): TriggeringUser | null {
  const cleanName = isIdentifiableName(name) ? (name as string).trim() : null;
  const cleanEmail = isIdentifiableEmail(email) ? (email as string).trim() : null;
  if (!cleanName && !cleanEmail) {
    return null;
  }
  return {
    name: cleanName,
    email: cleanEmail,
    source,
    isCiRun: isCI,
    label: formatTriggeringUserLabel({ name: cleanName, email: cleanEmail }),
  };
}

// Only try an API lookup when the provider token is already available: GitProvider.getInstance()
// logs "To benefit from ... integration" guidance when a token is missing, and resolving a display
// name is never worth that noise.
function hasGitProviderToken(): boolean {
  return !!(
    getEnvVar('GITHUB_TOKEN') ||
    getEnvVar('CI_SFDX_HARDIS_GITHUB_TOKEN') ||
    getEnvVar('PAT') ||
    getEnvVar('CI_SFDX_HARDIS_BITBUCKET_TOKEN')
  );
}

// Best-effort: any failure or timeout falls back to the raw CI value or the next source.
async function resolveIdentityFromProvider(
  identifier: string
): Promise<{ name: string | null; email: string | null } | null> {
  if (!hasGitProviderToken()) {
    return null;
  }
  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ENRICHMENT_TIMEOUT_MS).unref?.();
    });
    return await Promise.race([GitProvider.resolveUserIdentity(identifier), timeoutPromise]);
  } catch (e) {
    uxLog(
      'log',
      this,
      c.grey(`[TriggeringUser] Unable to resolve identity of "${identifier}": ${(e as Error).message}`)
    );
    return null;
  }
}

async function getFromCiEnvironment(): Promise<TriggeringUser | null> {
  // GitHub: the actor login already identifies the person. Upgrade it to a full name and
  // public email when a token allows it, but never fail when the lookup does not work.
  const githubActor = getEnvVar('GITHUB_TRIGGERING_ACTOR') || getEnvVar('GITHUB_ACTOR');
  if (githubActor) {
    const enriched = await resolveIdentityFromProvider(githubActor);
    const candidate = buildCandidate(enriched?.name || githubActor, enriched?.email, 'github');
    if (candidate) {
      return candidate;
    }
  }

  const gitlabCandidate = buildCandidate(getEnvVar('GITLAB_USER_NAME'), getEnvVar('GITLAB_USER_EMAIL'), 'gitlab');
  if (gitlabCandidate) {
    return gitlabCandidate;
  }

  const azureCandidate = buildCandidate(
    getEnvVar('BUILD_REQUESTEDFOR'),
    getEnvVar('BUILD_REQUESTEDFOREMAIL'),
    'azure'
  );
  if (azureCandidate) {
    return azureCandidate;
  }

  if (isJenkins()) {
    // BUILD_USER / BUILD_USER_EMAIL require the build-user-vars plugin, CHANGE_AUTHOR* are
    // set by multibranch pipeline builds
    const jenkinsCandidate =
      buildCandidate(getEnvVar('BUILD_USER'), getEnvVar('BUILD_USER_EMAIL'), 'jenkins') ||
      buildCandidate(
        getEnvVar('CHANGE_AUTHOR_DISPLAY_NAME') || getEnvVar('CHANGE_AUTHOR'),
        getEnvVar('CHANGE_AUTHOR_EMAIL'),
        'jenkins'
      );
    if (jenkinsCandidate) {
      return jenkinsCandidate;
    }
  }

  // Bitbucket Pipelines exposes no name or email, only an opaque account UUID. The raw UUID is
  // never used as a display value: without a successful API lookup we fall through to Git.
  const bitbucketTriggerer = getEnvVar('BITBUCKET_STEP_TRIGGERER_UUID');
  if (bitbucketTriggerer) {
    const enriched = await resolveIdentityFromProvider(bitbucketTriggerer);
    const candidate = buildCandidate(enriched?.name, enriched?.email, 'bitbucket');
    if (candidate) {
      return candidate;
    }
  }

  return buildCandidate(getEnvVar('CI_USER_NAME'), getEnvVar('CI_USER_EMAIL'), 'ciGeneric');
}

async function getFromSfdxHardisConfig(): Promise<TriggeringUser | null> {
  const envUserEmail = getEnvVar('USER_EMAIL');
  if (envUserEmail) {
    const candidate = buildCandidate(null, envUserEmail, 'sfdxHardisConfig');
    if (candidate) {
      return candidate;
    }
  }
  try {
    const config = await getConfig('user');
    return buildCandidate(null, config?.userEmail, 'sfdxHardisConfig');
  } catch {
    return null;
  }
}

// Each git call is isolated: a repository with user.name but no user.email must still yield a name
async function runGitCommand(args: string[]): Promise<string | null> {
  try {
    const result = await git({ output: false, displayCommand: false }).raw(args);
    return (result || '').trim() || null;
  } catch {
    return null;
  }
}

async function getFromGitConfig(): Promise<TriggeringUser | null> {
  const name = await runGitCommand(['config', '--get', 'user.name']);
  const email = await runGitCommand(['config', '--get', 'user.email']);
  return buildCandidate(name, email, 'gitConfig');
}

// Covers CI containers that check out a repository without ever setting a git identity
async function getFromGitCommit(): Promise<TriggeringUser | null> {
  const name = await runGitCommand(['log', '-1', '--format=%an']);
  const email = await runGitCommand(['log', '-1', '--format=%ae']);
  return buildCandidate(name, email, 'gitCommit');
}

function getFromOs(): TriggeringUser | null {
  try {
    return buildCandidate(os.userInfo().username, null, 'os');
  } catch {
    return null;
  }
}

/**
 * Returns the identity behind the current run. Never throws and never blocks a command:
 * when every source fails, the label falls back to the translated "unknown".
 */
export async function getTriggeringUser(): Promise<TriggeringUser> {
  try {
    const override = getEnvVar('SFDX_HARDIS_TRIGGERED_BY');
    if (override) {
      // Explicitly set by the user: trusted as-is, without the identifiability guard
      return {
        name: override.trim(),
        email: null,
        source: 'override',
        isCiRun: isCI,
        label: override.trim(),
      };
    }
    const resolved =
      (await getFromCiEnvironment()) ||
      (await getFromSfdxHardisConfig()) ||
      (await getFromGitConfig()) ||
      (await getFromGitCommit()) ||
      getFromOs();
    if (resolved) {
      uxLog('log', this, c.grey(`[TriggeringUser] Resolved "${resolved.label}" from source ${resolved.source}`));
      return resolved;
    }
  } catch (e) {
    uxLog('log', this, c.grey(`[TriggeringUser] Unable to resolve triggering user: ${(e as Error).message}`));
  }
  return {
    name: null,
    email: null,
    source: 'unknown',
    isCiRun: isCI,
    label: t('triggeringUserUnknown'),
  };
}

/*
 * Release versioning around the pure rules of releaseVersionRules.ts: reads the tags of the
 * repository, creates the version tag of a deployment through the git provider API, publishes the
 * Release of a production version, and describes the versions for hardis:project:version:list (and
 * the DevOps Pipeline of VS Code, which reads that command).
 */

import c from 'chalk';
import * as path from 'path';
import fs from './fsUtils.js';
import { git, uxLog } from './index.js';
import { t } from './i18n.js';
import { getConfig, getEnvVar } from '../../config/index.js';
import { listMajorOrgs } from './orgConfigUtils.js';
import { GitProvider } from '../gitProvider/index.js';
import type { GitProviderRoot, ReleaseAsset } from '../gitProvider/gitProviderRoot.js';
import { setPullRequestData } from './gitUtils.js';
import { isMajorBranchCheckMode } from './majorBranchCheckUtils.js';
import { parsePromotionBranchName } from './promotionBranchUtils.js';
import {
  buildVersionedBranchGraph,
  compareTagsNewestFirst,
  computeNextReleaseVersion,
  DEFAULT_INITIAL_RELEASE_VERSION,
  DEFAULT_TAG_FORMAT,
  findLatestVersionTagOfBranch,
  findPreviousVersionTag,
  formatReleaseVersion,
  formatVersionTagMessage,
  isValidTagVariableValue,
  listTagVariableEnvNames,
  parseReleaseVersion,
  parseTagFormat,
  parseVersionTagMessage,
  ReleaseSourceKind,
  ReleaseVersionSettings,
  TagFormat,
  toConfigBranchName,
  VersionedBranchGraph,
  VersionedBranchRole,
  VersionTag,
} from './releaseVersionRules.js';

/** What a deployment on a versioned branch tagged */
export interface ReleaseVersionResult {
  tag: string;
  // Semver form (1.5.0-rc.3). The tag name may differ, with the tag format of the branch
  version: string;
  // Values of the custom variables of the tag format ({PI}, {IT})
  variables: Record<string, string>;
  prerelease: boolean;
  // Plain version on the highest versioned branch: a Release is published for it
  final: boolean;
  // False when the deployed commit already had its version tag (a job run again)
  created: boolean;
  branch: string;
  commit: string;
  tagUrl: string | null;
}

/** One version tag, as hardis:project:version:list returns it */
export interface ReleaseVersionEntry {
  tag: string;
  // Semver form (1.5.0-rc.3): with tag formats, two release candidates of two branches can share it
  version: string;
  variables: Record<string, string>;
  prerelease: boolean;
  branchName: string | null;
  commit: string;
  deployedAt: string | null;
  org: string | null;
  pullRequest: number | null;
  jobUrl: string | null;
  tagUrl: string | null;
  releaseUrl: string | null;
}

export interface ReleaseVersionsDescription {
  enabled: boolean;
  initialVersion: string;
  minimumVersion: string | null;
  branches: Array<{
    branchName: string;
    role: VersionedBranchRole;
    current: ReleaseVersionEntry | null;
    // Versions a promotion into this branch would create, by source branch
    nextOnPromotion: Array<{ sourceBranch: string; tag: string }>;
  }>;
  history: ReleaseVersionEntry[];
}

const MAX_TAG_ATTEMPTS = 3;
const FIELD_SEPARATOR = '\x1f';
const RECORD_SEPARATOR = '\x1e';
// CI/CD variable over the config: the tag format of every versioned branch below the highest one
const TAG_FORMAT_ENV_VAR = 'SFDX_HARDIS_RELEASE_VERSIONING_TAG_FORMAT';

/**
 * True when a deployment job on this branch creates a version: the branch declares
 * releaseVersioning, the job deploys (not a check) and the deployed commit is on the branch.
 */
export async function isReleaseVersioningActive(branch: string | null, options: { checkOnly: boolean }, commandRef: any): Promise<boolean> {
  if (!branch || options.checkOnly || isMajorBranchCheckMode()) {
    return false;
  }
  const graph = buildVersionedBranchGraph(await listMajorOrgs());
  if (!graph.roles[toConfigBranchName(branch)]) {
    return false;
  }
  if (GitProvider.isDeployBeforeMerge()) {
    uxLog("warning", commandRef, c.yellow(t('releaseVersionDeployBeforeMergeSkipped')));
    return false;
  }
  return true;
}

/**
 * Computes the version of a successful deployment and creates its tag on the deployed commit. When
 * another job created the same tag first, the tags are read again and the next version is computed.
 * Never throws: the metadata is in the org already, a failure here is a warning.
 */
export async function handlePostDeploymentReleaseVersion(options: { branch: string; org: string | null; commandRef: any }): Promise<ReleaseVersionResult | null> {
  const { branch, commandRef } = options;
  try {
    uxLog("action", commandRef, c.cyan(t('releaseVersionComputing', { branch })));
    const gitProvider = await GitProvider.getInstance();
    if (!gitProvider || !gitProvider.supportsVersionTags()) {
      uxLog("warning", commandRef, c.yellow(t('releaseVersionTagFailed', { tag: branch, message: t('gitProviderNotConfigured') })));
      return null;
    }
    await fetchVersionTags(commandRef);
    const headCommit = (await git().revparse(['HEAD'])).trim();
    const majorOrgs = await listMajorOrgs();
    const graph = buildVersionedBranchGraph(majorOrgs);
    const settings = await readReleaseVersionSettings(majorOrgs, graph, commandRef);
    const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
    const source = resolveReleaseSource(prInfo?.sourceBranch || null, majorOrgs);
    const jobUrl = await GitProvider.getJobUrl();
    // Names the provider refused although no version tag has them: tags made by hand
    const takenTagNames: string[] = [];
    for (let attempt = 1; attempt <= MAX_TAG_ATTEMPTS; attempt++) {
      const tags = await listVersionTags();
      const decision = computeNextReleaseVersion(
        {
          branch,
          sourceBranch: source.sourceBranch,
          sourceKind: source.sourceKind,
          headCommit,
          tagsMergedInHead: await listTagsMergedIn('HEAD'),
          takenTagNames,
        },
        tags,
        graph,
        settings
      );
      if (decision.reason === 'missing-variables') {
        uxLog("warning", commandRef, c.yellow(t('releaseVersionTagVariableMissing', { variables: (decision.missingVariables || []).join(', '), branch })));
        return null;
      }
      if (!decision.version || !decision.tagName) {
        return null;
      }
      const result: ReleaseVersionResult = {
        tag: decision.tagName,
        version: formatReleaseVersion(decision.version, false),
        variables: decision.variables,
        prerelease: decision.version.rc !== null,
        final: decision.role === 'final',
        created: false,
        branch,
        commit: headCommit,
        tagUrl: gitProvider.getTagUrl(decision.tagName),
      };
      if (decision.reason === 'already-tagged') {
        uxLog("log", commandRef, c.grey(t('releaseVersionAlreadyTagged', { commit: headCommit.substring(0, 8), version: decision.tagName })));
        return storeReleaseVersion(result);
      }
      uxLog("action", commandRef, c.cyan(t('releaseVersionComputed', { version: decision.tagName })));
      const message = formatVersionTagMessage(decision.tagName, {
        branch,
        version: decision.version,
        variables: decision.variables,
        org: options.org,
        deployedAt: new Date().toISOString(),
        pullRequest: prInfo?.idNumber ?? null,
        jobUrl,
      });
      const tagResult = await gitProvider.createAnnotatedTag({ name: decision.tagName, commitSha: headCommit, message });
      if (tagResult.alreadyExists) {
        uxLog("log", commandRef, c.grey(t('releaseVersionTagTakenRetry', { tag: decision.tagName })));
        takenTagNames.push(decision.tagName);
        await fetchVersionTags(commandRef);
        continue;
      }
      await fetchTag(decision.tagName);
      uxLog("success", commandRef, c.green(t('releaseVersionTagCreated', { tag: decision.tagName, commit: headCommit.substring(0, 8) })));
      return storeReleaseVersion({ ...result, created: true, tagUrl: tagResult.url || result.tagUrl });
    }
    uxLog("warning", commandRef, c.yellow(t('releaseVersionTagFailed', { tag: branch, message: `${MAX_TAG_ATTEMPTS} attempts` })));
  } catch (e: any) {
    uxLog("warning", commandRef, c.yellow(t('releaseVersionTagFailed', { tag: branch, message: e?.message || String(e) })));
  }
  return null;
}

/**
 * After a production version is tagged: generates its release notes and creates the Release of the
 * git provider with them (the Markdown as body, the PDF and XLSX attached), then sends the release
 * notes notification with a link to the Release. On a provider without Releases, the notes stay in
 * the job reports. When the notes fail, the Release links to the comparison with the previous version.
 */
export async function publishProductionRelease(result: ReleaseVersionResult | null, commandRef: any): Promise<void> {
  if (!result || !result.final) {
    return;
  }
  // A production job run again on a tagged commit publishes only what is missing: the Release of a
  // first run whose Release call failed after the tag was created
  if (!result.created && !(await isReleaseMissing(result.tag))) {
    return;
  }
  // Loaded when needed: releaseNotesUtils reads the version tags from this module
  const { buildReleaseNotes, sendReleaseNotification } = await import('./releaseNotesUtils.js');
  let notes: Awaited<ReturnType<typeof buildReleaseNotes>> | null = null;
  let releaseUrl: string | null = null;
  try {
    const gitProvider = await GitProvider.getInstance();
    let bodyMarkdown = '';
    const assets: ReleaseAsset[] = [];
    try {
      notes = await buildReleaseNotes(
        { mode: 'post', 'release-tag': result.tag, 'target-branch': result.branch, pdf: true, agent: true },
        commandRef
      );
      if (!notes?.result?.outputFile) {
        throw new Error('no release notes file');
      }
      bodyMarkdown = await fs.readFile(notes.result.outputFile, 'utf8');
      if (notes.pdfFile) {
        assets.push({ file: notes.pdfFile, name: path.basename(notes.pdfFile), contentType: 'application/pdf' });
      }
      if (notes.xlsxFile) {
        assets.push({ file: notes.xlsxFile, name: path.basename(notes.xlsxFile), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      }
    } catch (e: any) {
      uxLog("warning", commandRef, c.yellow(t('releaseVersionReleaseNotesFailed', { tag: result.tag, message: e?.message || String(e) })));
      bodyMarkdown = await buildFallbackReleaseBody(result, gitProvider);
    }
    if (!gitProvider || !gitProvider.supportsReleases()) {
      uxLog("log", commandRef, c.grey(t('releaseVersionReleaseNotSupported', { provider: gitProvider?.getLabel() || 'Git', tag: result.tag })));
    } else {
      const release = await gitProvider.createRelease({ tagName: result.tag, title: result.tag, bodyMarkdown, assets });
      releaseUrl = release.url;
      uxLog("success", commandRef, c.green(t('releaseVersionReleaseCreated', { provider: gitProvider.getLabel(), tag: result.tag, url: release.url || '' })));
    }
  } catch (e: any) {
    uxLog("warning", commandRef, c.yellow(t('releaseVersionReleaseFailed', { tag: result.tag, message: e?.message || String(e) })));
  }
  // The release notes notification (Slack, Teams, email...) goes last, to link the Release
  if (notes?.data) {
    await sendReleaseNotification(notes.data, notes.pdfFile, notes.xlsxFile, commandRef, { finalVersion: true, releaseUrl });
  }
}

/**
 * Versions of the repository for hardis:project:version:list: the current version of each
 * versioned branch, the version each promotion into it would create (computed by the same rules as
 * a deployment job), and the history of the version tags, newest first.
 */
export async function describeReleaseVersions(options: { fetch: boolean; historyLimit: number; withLinks: boolean; commandRef: any }): Promise<ReleaseVersionsDescription> {
  const { commandRef } = options;
  if (options.fetch) {
    await fetchVersionTags(commandRef);
  }
  const majorOrgs = await listMajorOrgs();
  const graph = buildVersionedBranchGraph(majorOrgs);
  const settings = await readReleaseVersionSettings(majorOrgs, graph, commandRef);
  const tags = await listVersionTags();
  // Building the git provider costs API calls (GitLab resolves its project): only for the links
  let gitProvider: GitProviderRoot | null = null;
  if (options.withLinks) {
    try {
      gitProvider = await GitProvider.getInstance();
    } catch {
      // Without a git provider the entries have no links
    }
  }
  const branches: ReleaseVersionsDescription['branches'] = [];
  for (const branch of graph.versioned) {
    const current = findLatestVersionTagOfBranch(tags, branch);
    branches.push({
      branchName: toGitBranchName(branch),
      role: graph.roles[branch],
      current: current ? toVersionEntry(current, gitProvider) : null,
      nextOnPromotion: await simulatePromotions(branch, majorOrgs, tags, graph, settings),
    });
  }
  return {
    enabled: graph.versioned.length > 0,
    initialVersion: formatReleaseVersion(settings.initialVersion, false),
    // The value the computation uses: an invalid one in the config is ignored there, and here
    minimumVersion: settings.minimumVersion ? formatReleaseVersion(settings.minimumVersion, false) : null,
    branches,
    history: [...tags].sort(compareTagsNewestFirst).slice(0, options.historyLimit).map((tag) => toVersionEntry(tag, gitProvider)),
  };
}

/**
 * Version tags of the local repository, with what their sfdx-hardis message says. A tag created by
 * sfdx-hardis gives its version in its message, whatever its name (v1.5.0-pi2-it4-uat-rc3). Any
 * other tag counts only when its name is a plain semver version (v1.5.0, v1.5.0-rc.3).
 */
export async function listVersionTags(): Promise<VersionTag[]> {
  const format = ['%(refname:strip=2)', '%(objecttype)', '%(objectname)', '%(*objectname)', '%(creatordate:iso-strict)', '%(contents)'].join('%1f') + '%1e';
  const raw = await git().raw(['for-each-ref', 'refs/tags', `--format=${format}`]);
  const tags: VersionTag[] = [];
  for (const record of raw.split(RECORD_SEPARATOR)) {
    const [name, objectType, objectName, peeledName, date, ...contents] = record.replace(/^\s+/, '').split(FIELD_SEPARATOR);
    if (!name) {
      continue;
    }
    // An annotated tag points to a tag object: the commit is the peeled object
    const isAnnotated = objectType === 'tag';
    const metadata = isAnnotated ? parseVersionTagMessage(contents.join(FIELD_SEPARATOR)) : null;
    const version = metadata?.version || parseReleaseVersion(name);
    if (!version) {
      continue;
    }
    tags.push({
      name,
      version,
      variables: metadata?.variables || {},
      commit: (isAnnotated ? peeledName : objectName) || objectName,
      date: date || null,
      managed: metadata !== null,
      branch: metadata?.branch || null,
      org: metadata?.org || null,
      deployedAt: metadata?.deployedAt || null,
      pullRequest: metadata?.pullRequest ?? null,
      jobUrl: metadata?.jobUrl || null,
    });
  }
  return tags;
}

// ---- Private ----

// True only when the provider has Releases and says this one does not exist
async function isReleaseMissing(tagName: string): Promise<boolean> {
  try {
    const gitProvider = await GitProvider.getInstance();
    if (!gitProvider || !gitProvider.supportsReleases()) {
      return false;
    }
    return (await gitProvider.releaseExists(tagName)) === false;
  } catch {
    return false;
  }
}

/**
 * The settings of release versioning: first and minimum versions from the project config, and for
 * each versioned branch its tag format and minimum variables, its branch config over the project
 * config. An invalid value is a warning and is ignored: it never fails a deployment.
 */
async function readReleaseVersionSettings(
  majorOrgs: any[],
  graph: VersionedBranchGraph,
  commandRef: any
): Promise<ReleaseVersionSettings> {
  const config = await getConfig("project");
  const tagFormats: Record<string, TagFormat> = {};
  const minimumVariables: Record<string, Record<string, string>> = {};
  const projectVariables = readMinimumVariables(config.releaseVersioningMinimumVariables, commandRef);
  for (const majorOrg of majorOrgs) {
    const branch = toConfigBranchName(majorOrg.branchName);
    const role = graph.roles[branch];
    if (!role) {
      continue;
    }
    if (role === 'final') {
      if (majorOrg.releaseVersioningTagFormat) {
        uxLog("warning", commandRef, c.yellow(t('releaseVersionTagFormatIgnoredOnFinalBranch', { branch: toGitBranchName(branch), example: 'v1.5.0' })));
      }
      continue;
    }
    const formatText = getEnvVar(TAG_FORMAT_ENV_VAR) ?? majorOrg.releaseVersioningTagFormat ?? config.releaseVersioningTagFormat;
    if (formatText !== undefined && formatText !== null && formatText !== '') {
      const format = parseTagFormat(String(formatText));
      if (format) {
        tagFormats[branch] = format;
      } else {
        uxLog(
          "warning",
          commandRef,
          c.yellow(t('releaseVersionInvalidTagFormat', { format: String(formatText), branch: toGitBranchName(branch), defaultFormat: DEFAULT_TAG_FORMAT }))
        );
      }
    }
    minimumVariables[branch] = {
      ...projectVariables,
      ...readMinimumVariables(majorOrg.releaseVersioningMinimumVariables, commandRef),
      ...readEnvMinimumVariables(branch, tagFormats[branch]?.variables || [], commandRef),
    };
  }
  return { ...readVersionSettings(config, commandRef), tagFormats, minimumVariables };
}

/**
 * The minimum variables a CI/CD variable sets, over the config: SFDX_HARDIS_RELEASE_VERSIONING_VAR_UAT_PI
 * for the branch uat, then SFDX_HARDIS_RELEASE_VERSIONING_VAR_PI for every branch. Only the variables
 * of the tag format of the branch are looked up. Like the config, a minimum: the tags still win
 * when they hold higher values.
 */
function readEnvMinimumVariables(branch: string, names: string[], commandRef: any): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const name of names) {
    const envName = listTagVariableEnvNames(branch, name).find((candidate) => getEnvVar(candidate) !== null);
    if (!envName) {
      continue;
    }
    const value = (getEnvVar(envName) as string).trim();
    if (isValidTagVariableValue(value)) {
      variables[name] = value;
    } else {
      uxLog("warning", commandRef, c.yellow(t('releaseVersionInvalidTagVariable', { key: envName, value })));
    }
  }
  return variables;
}

// releaseVersioningMinimumVariables ({PI: 3, IT: 1}): a value outside the allowed characters is ignored
function readMinimumVariables(value: any, commandRef: any): Record<string, string> {
  const variables: Record<string, string> = {};
  if (value === undefined || value === null) {
    return variables;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    uxLog("warning", commandRef, c.yellow(t('releaseVersionInvalidTagVariable', { key: 'releaseVersioningMinimumVariables', value: JSON.stringify(value) })));
    return variables;
  }
  for (const [name, raw] of Object.entries(value)) {
    const text = raw === undefined || raw === null ? '' : String(raw);
    if (isValidTagVariableValue(text)) {
      variables[name] = text;
    } else {
      uxLog("warning", commandRef, c.yellow(t('releaseVersionInvalidTagVariable', { key: `releaseVersioningMinimumVariables.${name}`, value: text })));
    }
  }
  return variables;
}

function readVersionSettings(config: any, commandRef: any): Pick<ReleaseVersionSettings, 'initialVersion' | 'minimumVersion'> {
  const readVersion = (key: string, fallback: string | null) => {
    const value = config[key];
    if (value === undefined || value === null || value === '') {
      return fallback ? parseReleaseVersion(fallback) : null;
    }
    const parsed = parseReleaseVersion(String(value));
    if (!parsed || parsed.rc !== null) {
      uxLog("warning", commandRef, c.yellow(t('releaseVersionInvalidConfig', { key, value: String(value) })));
      return fallback ? parseReleaseVersion(fallback) : null;
    }
    return parsed;
  };
  return {
    initialVersion: readVersion('releaseVersioningInitialVersion', DEFAULT_INITIAL_RELEASE_VERSION) as NonNullable<ReturnType<typeof parseReleaseVersion>>,
    minimumVersion: readVersion('releaseVersioningMinimumVersion', null),
  };
}

// The CI checkout may not have every tag: Azure Pipelines does not fetch them by default. A shallow
// clone (the default of GitLab) does not have the history either, and git tag --merged then misses
// the release candidates older than the depth: the history is fetched once, when it is shallow
async function fetchVersionTags(commandRef: any): Promise<void> {
  try {
    const shallow = (await git().raw(['rev-parse', '--is-shallow-repository']).catch(() => 'false')).trim() === 'true';
    if (shallow) {
      await git().raw(['fetch', 'origin', '--unshallow', '--quiet']);
    }
    await git().raw(['fetch', 'origin', '--tags', '--force', '--quiet']);
  } catch (e: any) {
    uxLog("warning", commandRef, c.yellow(t('releaseVersionFetchTagsFailed', { message: e?.message || String(e) })));
  }
}

// A tag created through the API is not in the local repository yet: the release notes need it
async function fetchTag(tagName: string): Promise<void> {
  try {
    await git().raw(['fetch', 'origin', `refs/tags/${tagName}:refs/tags/${tagName}`, '--quiet']);
  } catch {
    // The release notes fall back on the commit range when the tag is not local
  }
}

async function listTagsMergedIn(ref: string): Promise<string[]> {
  try {
    const raw = await git().raw(['tag', '--merged', ref]);
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Where the Pull Request of a deployment comes from: a major branch, a promotion branch (its source), or anything else */
function resolveReleaseSource(
  sourceBranch: string | null,
  majorOrgs: Array<{ branchName: string }>
): { sourceBranch: string | null; sourceKind: ReleaseSourceKind | null } {
  if (!sourceBranch) {
    return { sourceBranch: null, sourceKind: null };
  }
  const majorBranches = majorOrgs.map((org) => toConfigBranchName(org.branchName));
  if (majorBranches.includes(toConfigBranchName(sourceBranch))) {
    return { sourceBranch, sourceKind: 'majorBranch' };
  }
  const promotion = parsePromotionBranchName(sourceBranch);
  if (promotion) {
    return { sourceBranch: promotion.sourceBranch, sourceKind: 'promotionBranch' };
  }
  return { sourceBranch, sourceKind: 'other' };
}

/** The version each major branch merging into this one would create, from the head of that branch on origin */
async function simulatePromotions(
  branch: string,
  majorOrgs: Array<{ branchName: string; mergeTargets?: string[] }>,
  tags: VersionTag[],
  graph: VersionedBranchGraph,
  settings: ReleaseVersionSettings
): Promise<Array<{ sourceBranch: string; tag: string }>> {
  const promotions: Array<{ sourceBranch: string; tag: string }> = [];
  for (const sourceOrg of majorOrgs) {
    if (!(sourceOrg.mergeTargets || []).map((target) => toConfigBranchName(target)).includes(branch)) {
      continue;
    }
    const sourceBranch = toGitBranchName(sourceOrg.branchName);
    let merged = await listTagsMergedIn(`origin/${sourceBranch}`);
    if (merged.length === 0) {
      merged = await listTagsMergedIn(sourceBranch);
    }
    const decision = computeNextReleaseVersion(
      { branch, sourceBranch, sourceKind: 'majorBranch', headCommit: '', tagsMergedInHead: merged },
      tags,
      graph,
      settings
    );
    if (decision.tagName) {
      promotions.push({ sourceBranch, tag: decision.tagName });
    }
  }
  return promotions;
}

function toVersionEntry(tag: VersionTag, gitProvider: GitProviderRoot | null): ReleaseVersionEntry {
  return {
    tag: tag.name,
    version: formatReleaseVersion(tag.version, false),
    variables: tag.variables,
    prerelease: tag.version.rc !== null,
    branchName: tag.branch,
    commit: tag.commit,
    deployedAt: tag.deployedAt || tag.date,
    org: tag.org,
    pullRequest: tag.pullRequest,
    jobUrl: tag.jobUrl,
    tagUrl: gitProvider?.getTagUrl(tag.name) || null,
    releaseUrl: tag.version.rc === null && gitProvider?.supportsReleases() ? gitProvider.getReleaseUrl(tag.name) : null,
  };
}

function storeReleaseVersion(result: ReleaseVersionResult): ReleaseVersionResult {
  setPullRequestData({ releaseVersion: { tag: result.tag, url: result.tagUrl } });
  return result;
}

async function buildFallbackReleaseBody(result: ReleaseVersionResult, gitProvider: GitProviderRoot | null): Promise<string> {
  const lines = [`Release ${result.tag}`];
  const previous = findPreviousVersionTag(result.tag, await listVersionTags().catch(() => []));
  const compareUrl = previous && gitProvider ? gitProvider.getCompareUrl(previous.name, result.tag) : null;
  if (compareUrl) {
    lines.push('', `Changes since ${previous?.name}: ${compareUrl}`);
  }
  const jobUrl = await GitProvider.getJobUrl();
  if (jobUrl) {
    lines.push('', `Deployment job: ${jobUrl}`);
  }
  return lines.join('\n');
}

// Config file form back to the git name: release__uat is the branch release/uat
function toGitBranchName(branch: string): string {
  return branch.replace(/__/g, '/');
}

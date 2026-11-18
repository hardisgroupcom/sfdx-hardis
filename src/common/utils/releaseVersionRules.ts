/*
 * Pure rules of release versioning: which major branches handle versions and their role in the
 * chain, how a version tag is read and written, and which version a deployment creates. No I/O
 * here: the git and git provider calls are in releaseVersionUtils.ts.
 *
 * A versioned branch is one whose branch config declares releaseVersioning: true. Among them, the
 * highest of the chain (usually main) gets plain versions (v1.5.0), every other one gets release
 * candidates (v1.5.0-rc.3). The version only depends on the existing tags, the branch deployed and
 * where its Pull Request comes from.
 */

/** A semver version, with an optional release candidate number */
export interface ReleaseVersion {
  major: number;
  minor: number;
  patch: number;
  rc: number | null;
}

/** A semver tag of the repository, with what its sfdx-hardis tag message says */
export interface VersionTag {
  name: string;
  version: ReleaseVersion;
  commit: string;
  // ISO date the tag was created (annotated tag) or committed (lightweight tag)
  date: string | null;
  // True when the tag message was written by sfdx-hardis: branch, org and job are then known
  managed: boolean;
  branch: string | null;
  org: string | null;
  deployedAt: string | null;
  pullRequest: number | null;
  jobUrl: string | null;
}

/** What sfdx-hardis writes in the message of a version tag */
export interface VersionTagMetadata {
  branch: string;
  org: string | null;
  deployedAt: string;
  pullRequest: number | null;
  jobUrl: string | null;
}

export type VersionedBranchRole = 'first' | 'middle' | 'final';

/** The major branches as release versioning sees them. Branch names use the config file form (release__uat) */
export interface VersionedBranchGraph {
  versioned: string[];
  roles: Record<string, VersionedBranchRole>;
  // Every major branch reachable by following mergeTargets upwards, versioned or not
  reachableUp: Record<string, string[]>;
  // Versioned branches reachable upwards
  above: Record<string, string[]>;
  // Versioned branches from which this branch is reachable
  below: Record<string, string[]>;
}

export interface ReleaseVersionSettings {
  initialVersion: ReleaseVersion;
  minimumVersion: ReleaseVersion | null;
}

/** Where the Pull Request of a deployment comes from */
export type ReleaseSourceKind = 'majorBranch' | 'promotionBranch' | 'other';

export interface ReleaseVersionContext {
  // Branch deployed
  branch: string;
  // Major branch the Pull Request comes from: the branch itself, or the source of a promotion branch
  sourceBranch: string | null;
  // Null when no Pull Request is known: a direct push
  sourceKind: ReleaseSourceKind | null;
  // Commit deployed. Empty when the deployment is simulated
  headCommit: string;
  // Names of the tags reachable from the deployed commit (git tag --merged)
  tagsMergedInHead: string[];
}

export type ReleaseVersionReason =
  | 'not-versioned'
  | 'already-tagged'
  | 'final-release'
  | 'final-only'
  | 'final-patch'
  | 'first-continue'
  | 'first-open'
  | 'middle-promotion'
  | 'middle-hotfix-join'
  | 'middle-hotfix-patch';

export interface ReleaseVersionDecision {
  version: ReleaseVersion | null;
  tagName: string | null;
  role: VersionedBranchRole | null;
  reason: ReleaseVersionReason;
  // The tag the deployed commit already has, for already-tagged
  existingTag?: VersionTag;
}

export const VERSION_TAG_MESSAGE_MARKER = 'sfdx-hardis release version';
export const DEFAULT_INITIAL_RELEASE_VERSION = '1.0.0';

const RELEASE_VERSION_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/;

/** Config file form of a branch name: a / is written __ (.sfdx-hardis.release__uat.yml is the branch release/uat) */
export function toConfigBranchName(branchName: string | null | undefined): string {
  return (branchName || '').replace(/\//g, '__');
}

/** Roles of the versioned branches, from the mergeTargets of every major branch */
export function buildVersionedBranchGraph(
  majorOrgs: Array<{ branchName: string; mergeTargets?: string[]; releaseVersioning?: boolean }>
): VersionedBranchGraph {
  const targetsOf: Record<string, string[]> = {};
  for (const org of majorOrgs || []) {
    targetsOf[toConfigBranchName(org.branchName)] = (org.mergeTargets || []).map((target) => toConfigBranchName(target));
  }
  const versioned = (majorOrgs || [])
    .filter((org) => org.releaseVersioning === true)
    .map((org) => toConfigBranchName(org.branchName));
  const reachableUp: Record<string, string[]> = {};
  for (const branch of Object.keys(targetsOf)) {
    reachableUp[branch] = listReachableUp(branch, targetsOf);
  }
  const above: Record<string, string[]> = {};
  const below: Record<string, string[]> = {};
  for (const branch of versioned) {
    above[branch] = (reachableUp[branch] || []).filter((other) => versioned.includes(other));
  }
  for (const branch of versioned) {
    below[branch] = versioned.filter((other) => (above[other] || []).includes(branch));
  }
  const roles: Record<string, VersionedBranchRole> = {};
  for (const branch of versioned) {
    roles[branch] = above[branch].length === 0 ? 'final' : below[branch].length === 0 ? 'first' : 'middle';
  }
  return { versioned, roles, reachableUp, above, below };
}

/** Reads the sfdx-hardis message of a version tag, null for any other message */
export function parseVersionTagMessage(message: string | null | undefined): VersionTagMetadata | null {
  const lines = (message || '').split(/\r?\n/);
  if (!(lines[0] || '').trim().startsWith(VERSION_TAG_MESSAGE_MARKER)) {
    return null;
  }
  const values: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      values[line.substring(0, separator).trim()] = line.substring(separator + 1).trim();
    }
  }
  if (!values.branch) {
    return null;
  }
  const pullRequest = Number.parseInt(values.pullRequest || '', 10);
  return {
    branch: values.branch,
    org: values.org || null,
    deployedAt: values.deployedAt || '',
    pullRequest: Number.isFinite(pullRequest) ? pullRequest : null,
    jobUrl: values.jobUrl || null,
  };
}

/** v1.5.0, 1.5.0 or v1.5.0-rc.3. Null for anything else (v2.0, release-x, 1.5.0-beta.1) */
export function parseReleaseVersion(text: string | null | undefined): ReleaseVersion | null {
  const match = RELEASE_VERSION_REGEX.exec((text || '').trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: match[4] !== undefined ? Number(match[4]) : null,
  };
}

/**
 * The version a deployment creates, or why it creates none. Steps: a commit that already has a
 * version tag of this branch keeps it; then the base version comes from the role of the branch; the
 * minimum version raises it; the rc number is the next one of that base, shared by every branch.
 */
export function computeNextReleaseVersion(
  context: ReleaseVersionContext,
  tags: VersionTag[],
  graph: VersionedBranchGraph,
  settings: ReleaseVersionSettings
): ReleaseVersionDecision {
  const branch = toConfigBranchName(context.branch);
  const role = graph.roles[branch] || null;
  if (!role) {
    return { version: null, tagName: null, role: null, reason: 'not-versioned' };
  }
  if (context.headCommit) {
    const existingTag = tags.find((tag) => tag.commit === context.headCommit && tag.managed && toConfigBranchName(tag.branch) === branch);
    if (existingTag) {
      return { version: existingTag.version, tagName: existingTag.name, role, reason: 'already-tagged', existingTag };
    }
  }
  const choice =
    role === 'final'
      ? chooseFinalBase(context, tags, graph, branch, settings)
      : role === 'first'
        ? chooseFirstBase(tags, graph, branch, settings)
        : chooseMiddleBase(context, tags, graph, branch, settings);
  let base = choice.base;
  if (settings.minimumVersion && compareReleaseVersions(base, baseOf(settings.minimumVersion)) < 0) {
    base = baseOf(settings.minimumVersion);
  }
  const version: ReleaseVersion = role === 'final' ? base : { ...base, rc: nextRcNumber(tags, base) };
  return { version, tagName: formatReleaseVersion(version), role, reason: choice.reason };
}

/** v1.5.0 or v1.5.0-rc.3 */
export function formatReleaseVersion(version: ReleaseVersion, withPrefix = true): string {
  const text = `${version.major}.${version.minor}.${version.patch}${version.rc !== null ? `-rc.${version.rc}` : ''}`;
  return withPrefix ? `v${text}` : text;
}

/** The message sfdx-hardis writes in an annotated version tag */
export function formatVersionTagMessage(tagName: string, metadata: VersionTagMetadata): string {
  const lines = [`${VERSION_TAG_MESSAGE_MARKER} ${tagName}`, '', `branch: ${metadata.branch}`];
  if (metadata.org) {
    lines.push(`org: ${metadata.org}`);
  }
  lines.push(`deployedAt: ${metadata.deployedAt}`);
  if (metadata.pullRequest !== null) {
    lines.push(`pullRequest: ${metadata.pullRequest}`);
  }
  if (metadata.jobUrl) {
    lines.push(`jobUrl: ${metadata.jobUrl}`);
  }
  return lines.join('\n');
}

/**
 * The tag the release notes of a version start from. A plain version starts from the previous plain
 * version, never from one of its own release candidates. A release candidate tagged by sfdx-hardis
 * starts from the previous version tag of the same branch. Undefined when there is none.
 */
export function findPreviousVersionTag(tagName: string, tags: VersionTag[]): VersionTag | undefined {
  const current = tags.find((tag) => tag.name === tagName);
  const currentVersion = current?.version || parseReleaseVersion(tagName);
  if (!currentVersion) {
    return undefined;
  }
  let candidates: VersionTag[];
  if (currentVersion.rc === null) {
    candidates = tags.filter((tag) => tag.version.rc === null);
  } else if (current?.managed && current.branch) {
    candidates = tags.filter((tag) => tag.managed && toConfigBranchName(tag.branch) === toConfigBranchName(current.branch));
  } else {
    candidates = tags;
  }
  return candidates
    .filter((tag) => tag.name !== tagName && compareReleaseVersions(tag.version, currentVersion) < 0)
    .sort((a, b) => compareReleaseVersions(b.version, a.version))[0];
}

/** The version tag most recently deployed on a branch, among the tags created by sfdx-hardis */
export function findLatestVersionTagOfBranch(tags: VersionTag[], branch: string): VersionTag | undefined {
  const configBranch = toConfigBranchName(branch);
  return tags.filter((tag) => tag.managed && toConfigBranchName(tag.branch) === configBranch).sort(compareTagsNewestFirst)[0];
}

/** Newest deployment first; the version breaks ties between tags of the same second */
export function compareTagsNewestFirst(a: VersionTag, b: VersionTag): number {
  const dateA = Date.parse(a.deployedAt || a.date || '') || 0;
  const dateB = Date.parse(b.deployedAt || b.date || '') || 0;
  if (dateA !== dateB) {
    return dateB - dateA;
  }
  return compareReleaseVersions(b.version, a.version);
}

/** Semver order: a release candidate comes before the plain version of the same base */
export function compareReleaseVersions(a: ReleaseVersion, b: ReleaseVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) {
      return a[key] - b[key];
    }
  }
  if (a.rc === b.rc) {
    return 0;
  }
  if (a.rc === null) {
    return 1;
  }
  if (b.rc === null) {
    return -1;
  }
  return a.rc - b.rc;
}

// ---- Private ----

function listReachableUp(branch: string, targetsOf: Record<string, string[]>): string[] {
  const visited = new Set<string>();
  const queue = [...(targetsOf[branch] || [])];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (next === branch || visited.has(next)) {
      continue;
    }
    visited.add(next);
    queue.push(...(targetsOf[next] || []));
  }
  return [...visited];
}

/**
 * The highest versioned branch gets the plain version of the release it receives: the highest
 * release candidate reachable from the deployed commit that is not released yet. When two releases
 * are reachable (one overtook the other in the branch below), the newest one wins.
 */
function chooseFinalBase(
  context: ReleaseVersionContext,
  tags: VersionTag[],
  graph: VersionedBranchGraph,
  branch: string,
  settings: ReleaseVersionSettings
): { base: ReleaseVersion; reason: ReleaseVersionReason } {
  const production = highestPlainVersion(tags);
  const merged = tags.filter((tag) => tag.version.rc !== null && context.tagsMergedInHead.includes(tag.name));
  const candidates = merged
    .map((tag) => baseOf(tag.version))
    .filter((base) => !production || compareReleaseVersions(base, production) > 0)
    .sort((a, b) => compareReleaseVersions(b, a));
  if (candidates.length > 0) {
    return { base: candidates[0], reason: 'final-release' };
  }
  if ((graph.below[branch] || []).length === 0) {
    // The only versioned branch: every deployment is a release
    return { base: production ? nextMinor(production) : settings.initialVersion, reason: 'final-only' };
  }
  return { base: production ? nextPatch(production) : settings.initialVersion, reason: 'final-patch' };
}

/**
 * The lowest versioned branch keeps adding release candidates to its open release, until a tag of
 * that release is created on a higher branch (it moved up) or the release is in production: the
 * next deployment then opens the next minor version.
 */
function chooseFirstBase(
  tags: VersionTag[],
  graph: VersionedBranchGraph,
  branch: string,
  settings: ReleaseVersionSettings
): { base: ReleaseVersion; reason: ReleaseVersionReason } {
  const production = highestPlainVersion(tags);
  const last = findLatestVersionTagOfBranch(tags, branch);
  if (last) {
    const openBase = baseOf(last.version);
    const notReleased = !production || compareReleaseVersions(openBase, production) > 0;
    if (notReleased && !hasMovedUp(tags, graph, branch, openBase)) {
      return { base: openBase, reason: 'first-continue' };
    }
  }
  const highest = highestBase(tags);
  return { base: highest ? nextMinor(highest) : settings.initialVersion, reason: 'first-open' };
}

/**
 * A branch between two versioned ones receives a release from below (the branch the Pull Request
 * comes from, or the source of a promotion branch), or a hotfix. A hotfix joins the release waiting
 * there for production, or starts the next patch of production when nothing waits.
 */
function chooseMiddleBase(
  context: ReleaseVersionContext,
  tags: VersionTag[],
  graph: VersionedBranchGraph,
  branch: string,
  settings: ReleaseVersionSettings
): { base: ReleaseVersion; reason: ReleaseVersionReason } {
  const production = highestPlainVersion(tags);
  const isPromotion = (context.sourceKind === 'majorBranch' || context.sourceKind === 'promotionBranch') && !!context.sourceBranch;
  if (isPromotion) {
    const feedingTag = latestTagOfFeedingBranches(tags, graph, branch, toConfigBranchName(context.sourceBranch));
    if (feedingTag) {
      const feedingBase = baseOf(feedingTag.version);
      if (!production || compareReleaseVersions(feedingBase, production) > 0) {
        return { base: feedingBase, reason: 'middle-promotion' };
      }
    }
  }
  const last = findLatestVersionTagOfBranch(tags, branch);
  if (last && (!production || compareReleaseVersions(baseOf(last.version), production) > 0)) {
    return { base: baseOf(last.version), reason: 'middle-hotfix-join' };
  }
  const reference = production || highestBase(tags);
  return { base: reference ? nextPatch(reference) : settings.initialVersion, reason: 'middle-hotfix-patch' };
}

/** Versioned branches at or below the source of the Pull Request, that feed the deployed branch */
function latestTagOfFeedingBranches(tags: VersionTag[], graph: VersionedBranchGraph, branch: string, source: string): VersionTag | undefined {
  const feeding = (graph.below[branch] || []).filter(
    (candidate) => candidate === source || (graph.reachableUp[candidate] || []).includes(source)
  );
  return feeding
    .map((candidate) => findLatestVersionTagOfBranch(tags, candidate))
    .filter((tag): tag is VersionTag => !!tag)
    .sort(compareTagsNewestFirst)[0];
}

function hasMovedUp(tags: VersionTag[], graph: VersionedBranchGraph, branch: string, base: ReleaseVersion): boolean {
  const higher = graph.above[branch] || [];
  return tags.some(
    (tag) =>
      compareReleaseVersions(baseOf(tag.version), base) === 0 &&
      (tag.version.rc === null || (tag.managed && higher.includes(toConfigBranchName(tag.branch))))
  );
}

function nextRcNumber(tags: VersionTag[], base: ReleaseVersion): number {
  const rcNumbers = tags
    .filter((tag) => tag.version.rc !== null && compareReleaseVersions(baseOf(tag.version), base) === 0)
    .map((tag) => tag.version.rc as number);
  return rcNumbers.length > 0 ? Math.max(...rcNumbers) + 1 : 1;
}

function highestPlainVersion(tags: VersionTag[]): ReleaseVersion | null {
  return tags
    .filter((tag) => tag.version.rc === null)
    .map((tag) => tag.version)
    .sort((a, b) => compareReleaseVersions(b, a))[0] || null;
}

function highestBase(tags: VersionTag[]): ReleaseVersion | null {
  return tags.map((tag) => baseOf(tag.version)).sort((a, b) => compareReleaseVersions(b, a))[0] || null;
}

function baseOf(version: ReleaseVersion): ReleaseVersion {
  return { major: version.major, minor: version.minor, patch: version.patch, rc: null };
}

function nextMinor(version: ReleaseVersion): ReleaseVersion {
  return { major: version.major, minor: version.minor + 1, patch: 0, rc: null };
}

function nextPatch(version: ReleaseVersion): ReleaseVersion {
  return { major: version.major, minor: version.minor, patch: version.patch + 1, rc: null };
}

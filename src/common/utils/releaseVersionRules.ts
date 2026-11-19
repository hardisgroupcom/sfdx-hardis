/*
 * Pure rules of release versioning: which major branches handle versions and their role in the
 * chain, how a version tag is read and written, and which version a deployment creates. No I/O
 * here: the git and git provider calls are in releaseVersionUtils.ts.
 *
 * A versioned branch is one whose branch config declares releaseVersioning: true. Among them, the
 * highest of the chain (usually main) gets plain versions (v1.5.0), every other one gets release
 * candidates (v1.5.0-rc.3). The version only depends on the existing tags, the branch deployed and
 * where its Pull Request comes from.
 *
 * The name of a release candidate follows the tag format of its branch (releaseVersioningTagFormat,
 * v1.5.0-pi2-it4-uat-rc3). sfdx-hardis never reads a version back from such a name: it writes the
 * version, the rc number and the template variables in the tag message, and reads them from there.
 */

/** A semver version, with an optional release candidate number */
export interface ReleaseVersion {
  major: number;
  minor: number;
  patch: number;
  rc: number | null;
}

/** A version tag of the repository, with what its sfdx-hardis tag message says */
export interface VersionTag {
  name: string;
  version: ReleaseVersion;
  // Values of the custom variables of the tag format ({PI}, {IT}), from the sfdx-hardis tag message
  variables: Record<string, string>;
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
  // Null in a message written before the tag formats: the version then comes from the tag name
  version: ReleaseVersion | null;
  variables: Record<string, string>;
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
  // Tag format of the release candidates of each versioned branch (config form). Missing: the default format
  tagFormats?: Record<string, TagFormat>;
  // releaseVersioningMinimumVariables of each versioned branch, its own values over the project ones
  minimumVariables?: Record<string, Record<string, string>>;
}

/** A tag format, cut into literal text and placeholders ({MAJ}, {RC}, {PI}...) */
export interface TagFormat {
  text: string;
  parts: Array<{ literal: string } | { placeholder: string }>;
  // Custom variables, in template order
  variables: string[];
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
  // Tag names the git provider said exist already, although they are not version tags (made by hand)
  takenTagNames?: string[];
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
  | 'middle-hotfix-patch'
  | 'missing-variables';

export interface ReleaseVersionDecision {
  version: ReleaseVersion | null;
  tagName: string | null;
  role: VersionedBranchRole | null;
  reason: ReleaseVersionReason;
  // Values of the custom variables written in the tag
  variables: Record<string, string>;
  // The tag the deployed commit already has, for already-tagged
  existingTag?: VersionTag;
  // Custom variables of the tag format without any value, for missing-variables
  missingVariables?: string[];
}

export const VERSION_TAG_MESSAGE_MARKER = 'sfdx-hardis release version';
export const DEFAULT_INITIAL_RELEASE_VERSION = '1.0.0';
export const DEFAULT_TAG_FORMAT = 'v{MAJ}.{MIN}.{PATCH}-rc.{RC}';

const RELEASE_VERSION_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/;
const REQUIRED_PLACEHOLDERS = ['MAJ', 'MIN', 'PATCH', 'RC'];
const BUILT_IN_PLACEHOLDERS = [...REQUIRED_PLACEHOLDERS, 'BRANCH'];
const PLACEHOLDER_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;
// Characters valid in a git tag, a JIRA fix version and a ticket label
const TAG_TEXT_REGEX = /^[A-Za-z0-9._-]+$/;
// A variable value: no dot at either end, no two dots in a row
const TAG_VARIABLE_VALUE_REGEX = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

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
    version: readMessageVersion(values.version, values.rc),
    variables: readMessageVariables(values.variables),
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
 * Reads a tag format (releaseVersioningTagFormat). Null when it is invalid: {MAJ}, {MIN}, {PATCH}
 * and {RC} once each, {BRANCH} and custom variables at most once, two placeholders never side by
 * side, only letters, digits, '.', '_' and '-' around them, and a valid git tag once filled in.
 */
export function parseTagFormat(text: string | null | undefined): TagFormat | null {
  const source = (text || '').trim();
  const parts: TagFormat['parts'] = [];
  let index = 0;
  for (const match of source.matchAll(/\{([^{}]*)\}/g)) {
    const start = match.index as number;
    if (start > index) {
      parts.push({ literal: source.substring(index, start) });
    }
    parts.push({ placeholder: match[1] });
    index = start + match[0].length;
  }
  if (index < source.length) {
    parts.push({ literal: source.substring(index) });
  }
  const placeholders = parts.filter((part): part is { placeholder: string } => 'placeholder' in part).map((part) => part.placeholder);
  const valid =
    placeholders.every((name) => PLACEHOLDER_NAME_REGEX.test(name)) &&
    parts.every((part) => !('literal' in part) || TAG_TEXT_REGEX.test(part.literal)) &&
    new Set(placeholders).size === placeholders.length &&
    REQUIRED_PLACEHOLDERS.every((name) => placeholders.includes(name)) &&
    parts.every((part, position) => position === 0 || 'literal' in part || 'literal' in parts[position - 1]);
  if (!valid) {
    return null;
  }
  const format: TagFormat = { text: source, parts, variables: placeholders.filter((name) => !BUILT_IN_PLACEHOLDERS.includes(name)) };
  const sample = format.parts.map((part) => ('literal' in part ? part.literal : '0')).join('');
  return isValidTagName(sample) ? format : null;
}

/** A value of releaseVersioningMinimumVariables: letters, digits, '.', '_' and '-', no dot at either end */
export function isValidTagVariableValue(value: string): boolean {
  return TAG_VARIABLE_VALUE_REGEX.test(value);
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
    return { version: null, tagName: null, role: null, reason: 'not-versioned', variables: {} };
  }
  if (context.headCommit) {
    const existingTag = tags.find((tag) => tag.commit === context.headCommit && tag.managed && toConfigBranchName(tag.branch) === branch);
    if (existingTag) {
      return { version: existingTag.version, tagName: existingTag.name, role, reason: 'already-tagged', variables: existingTag.variables, existingTag };
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
  if (role === 'final') {
    return { version: base, tagName: formatReleaseVersion(base), role, reason: choice.reason, variables: {} };
  }
  const format = settings.tagFormats?.[branch] || (parseTagFormat(DEFAULT_TAG_FORMAT) as TagFormat);
  const resolved = resolveTagVariables(format.variables, tags, settings.minimumVariables?.[branch] || {});
  if (resolved.missing.length > 0) {
    return { version: null, tagName: null, role, reason: 'missing-variables', variables: {}, missingVariables: resolved.missing };
  }
  const render = (rc: number) => formatTagName(format, { ...base, rc }, context.branch, resolved.values);
  const rc = nextRcNumber(tags, base, render, context.takenTagNames || []);
  return { version: { ...base, rc }, tagName: render(rc), role, reason: choice.reason, variables: resolved.values };
}

/** The name of a release candidate in a tag format: {BRANCH} is the git branch name, '/' written '-' */
export function formatTagName(format: TagFormat, version: ReleaseVersion, branch: string, variables: Record<string, string>): string {
  const values: Record<string, string> = {
    ...variables,
    MAJ: String(version.major),
    MIN: String(version.minor),
    PATCH: String(version.patch),
    RC: version.rc !== null ? String(version.rc) : '',
    BRANCH: toGitBranchName(branch).replace(/[^A-Za-z0-9._-]/g, '-'),
  };
  return format.parts.map((part) => ('literal' in part ? part.literal : values[part.placeholder] ?? '')).join('');
}

/** v1.5.0 or v1.5.0-rc.3 */
export function formatReleaseVersion(version: ReleaseVersion, withPrefix = true): string {
  const text = `${version.major}.${version.minor}.${version.patch}${version.rc !== null ? `-rc.${version.rc}` : ''}`;
  return withPrefix ? `v${text}` : text;
}

/** The message sfdx-hardis writes in an annotated version tag */
export function formatVersionTagMessage(tagName: string, metadata: VersionTagMetadata): string {
  const lines = [`${VERSION_TAG_MESSAGE_MARKER} ${tagName}`, '', `branch: ${metadata.branch}`];
  if (metadata.version) {
    lines.push(`version: ${formatReleaseVersion({ ...metadata.version, rc: null }, false)}`);
    if (metadata.version.rc !== null) {
      lines.push(`rc: ${metadata.version.rc}`);
    }
  }
  const variables = Object.entries(metadata.variables || {});
  if (variables.length > 0) {
    lines.push(`variables: ${variables.map(([name, value]) => `${name}=${value}`).join(' ')}`);
  }
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
 * starts from the version tag deployed on the same branch just before it: with tag formats, rc
 * numbers restart for each text (pi3-it1-rc1 comes after pi2-it4-rc3). Undefined when there is none.
 */
export function findPreviousVersionTag(tagName: string, tags: VersionTag[]): VersionTag | undefined {
  const current = tags.find((tag) => tag.name === tagName);
  const currentVersion = current?.version || parseReleaseVersion(tagName);
  if (!currentVersion) {
    return undefined;
  }
  if (currentVersion.rc !== null && current?.managed && current.branch) {
    const currentTime = tagTime(current);
    const currentBranch = toConfigBranchName(current.branch);
    return tags
      .filter((tag) => tag.managed && tag.name !== tagName && toConfigBranchName(tag.branch) === currentBranch && tagTime(tag) < currentTime)
      .sort(compareTagsNewestFirst)[0];
  }
  const candidates = currentVersion.rc === null ? tags.filter((tag) => tag.version.rc === null) : tags;
  return candidates
    .filter((tag) => tag.name !== tagName && compareReleaseVersions(tag.version, currentVersion) < 0)
    .sort((a, b) => compareReleaseVersions(b.version, a.version))[0];
}

/** The version tag most recently deployed on a branch, among the tags created by sfdx-hardis */
export function findLatestVersionTagOfBranch(tags: VersionTag[], branch: string): VersionTag | undefined {
  const configBranch = toConfigBranchName(branch);
  return tags.filter((tag) => tag.managed && toConfigBranchName(tag.branch) === configBranch).sort(compareTagsNewestFirst)[0];
}

/** Newest deployment first; the version, then the name, break ties between tags of the same second */
export function compareTagsNewestFirst(a: VersionTag, b: VersionTag): number {
  const dateA = tagTime(a);
  const dateB = tagTime(b);
  if (dateA !== dateB) {
    return dateB - dateA;
  }
  return compareReleaseVersions(b.version, a.version) || b.name.localeCompare(a.name);
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

// version: 1.5.0 and rc: 3 of an sfdx-hardis tag message
function readMessageVersion(versionText: string | undefined, rcText: string | undefined): ReleaseVersion | null {
  const version = parseReleaseVersion(versionText);
  if (!version || version.rc !== null) {
    return null;
  }
  const rc = Number.parseInt(rcText || '', 10);
  return { ...version, rc: Number.isFinite(rc) ? rc : null };
}

// variables: PI=2 IT=4 of an sfdx-hardis tag message. Values hold no space nor '='
function readMessageVariables(text: string | undefined): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const pair of (text || '').split(/\s+/)) {
    const separator = pair.indexOf('=');
    if (separator > 0) {
      variables[pair.substring(0, separator)] = pair.substring(separator + 1);
    }
  }
  return variables;
}

// A git tag name: no leading '-' or '.', no '..', no trailing '.' nor '.lock'
function isValidTagName(name: string): boolean {
  return TAG_TEXT_REGEX.test(name) && !/^[-.]/.test(name) && !name.includes('..') && !name.endsWith('.') && !name.endsWith('.lock');
}

// Config file form back to the git name: release__uat is the branch release/uat
function toGitBranchName(branch: string): string {
  return branch.replace(/__/g, '/');
}

function tagTime(tag: VersionTag): number {
  return Date.parse(tag.deployedAt || tag.date || '') || 0;
}

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
  // A promotion branch cherry-picks the User Stories: the tags of its source are not reachable from
  // the deployed commit, so the release comes from the version last deployed on that source
  const promotionSource = context.sourceKind === 'promotionBranch' ? readPromotionSource(context, graph, branch) : null;
  if (promotionSource) {
    const sourceTag = graph.roles[promotionSource]
      ? findLatestVersionTagOfBranch(tags, promotionSource)
      : latestTagOfFeedingBranches(tags, graph, branch, promotionSource);
    if (sourceTag && (!production || compareReleaseVersions(baseOf(sourceTag.version), production) > 0)) {
      return { base: baseOf(sourceTag.version), reason: 'final-release' };
    }
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
  const promotionSource = readPromotionSource(context, graph, branch);
  if (promotionSource) {
    const feedingTag = latestTagOfFeedingBranches(tags, graph, branch, promotionSource);
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

/**
 * The major branch a promotion into this branch comes from: the source of the Pull Request, or of
 * its promotion branch, when it merges upwards into this branch. Null for anything else, including
 * a higher branch merged back into this one (main into preprod), which is a hotfix.
 */
function readPromotionSource(context: ReleaseVersionContext, graph: VersionedBranchGraph, branch: string): string | null {
  if ((context.sourceKind !== 'majorBranch' && context.sourceKind !== 'promotionBranch') || !context.sourceBranch) {
    return null;
  }
  const source = toConfigBranchName(context.sourceBranch);
  return (graph.reachableUp[source] || []).includes(branch) ? source : null;
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
  // A plain version of that base is a release already in production: the caller checks it first
  return tags.some(
    (tag) => compareReleaseVersions(baseOf(tag.version), base) === 0 && tag.managed && higher.includes(toConfigBranchName(tag.branch))
  );
}

/**
 * The custom variables of a tag carry the values of the previous tags, until the configured minimum
 * goes above them. The values of a tag or of the config are compared together, in template order,
 * like a semver: PI 3 / IT 1 is above PI 2 / IT 5. Only a set with a value for every variable counts.
 */
function resolveTagVariables(
  names: string[],
  tags: VersionTag[],
  minimum: Record<string, string>
): { values: Record<string, string>; missing: string[] } {
  if (names.length === 0) {
    return { values: {}, missing: [] };
  }
  const hasValue = (set: Record<string, string>, name: string) => set[name] !== undefined && set[name] !== '';
  const complete = [minimum, ...tags.filter((tag) => tag.managed).map((tag) => tag.variables)].filter((set) =>
    names.every((name) => hasValue(set, name))
  );
  if (complete.length === 0) {
    return { values: {}, missing: names.filter((name) => !hasValue(minimum, name)) };
  }
  const highest = complete.sort((a, b) => compareVariableSets(b, a, names))[0];
  return { values: Object.fromEntries(names.map((name) => [name, highest[name]])), missing: [] };
}

function compareVariableSets(a: Record<string, string>, b: Record<string, string>, names: string[]): number {
  for (const name of names) {
    const bothNumbers = /^\d+$/.test(a[name]) && /^\d+$/.test(b[name]);
    const difference = bothNumbers ? Number(a[name]) - Number(b[name]) : a[name].localeCompare(b[name], undefined, { numeric: true });
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * One release candidate counter per tag text: the tags of the same version whose name is the same
 * text around {RC}. A tag counts when its own rc number, rendered in the format, gives back its
 * name: no tag name is ever parsed. With the default format, every semver release candidate of the
 * version counts, created by hand or not. A name taken by a tag made by hand is skipped.
 */
function nextRcNumber(tags: VersionTag[], base: ReleaseVersion, render: (rc: number) => string, takenTagNames: string[]): number {
  const rcNumbers = tags
    .filter((tag) => tag.version.rc !== null && compareReleaseVersions(baseOf(tag.version), base) === 0 && tag.name === render(tag.version.rc))
    .map((tag) => tag.version.rc as number);
  let rc = rcNumbers.length > 0 ? Math.max(...rcNumbers) + 1 : 1;
  const taken = new Set([...takenTagNames, ...tags.map((tag) => tag.name)]);
  while (taken.has(render(rc))) {
    rc++;
  }
  return rc;
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

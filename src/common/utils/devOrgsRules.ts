import { DashboardComment, DashboardFormat } from '../gitProvider/gitProviderRoot.js';
import {
  buildDashboardCommentBody,
  DashboardBlock,
  DashboardCell,
  decodeDashboardData,
  encodeDashboardData,
  formatDashboardDate,
  formatDashboardDay,
  renderDashboardBlocks,
} from './dashboardDataUtils.js';

// The development orgs registry: which developer sandboxes and scratch orgs the team builds its
// User Stories in, the major branch each of them targets, and how many Pull Requests were merged
// into that branch since the org last received a backpromote. Pure rules only: the git provider
// calls are in devOrgsRegistry.ts.

// Title the dashboard is found by on the git provider
export const DEV_ORGS_DASHBOARD_TITLE = 'Development Orgs Dashboard';
// The comments of the dashboard hold their data under this name
export const DEV_ORGS_DATA_NAME = 'devorg';
export const DEV_ORGS_DEFAULT_STALE_DAYS = 30;
// The merged Pull Requests of a branch are never listed further back than this
export const DEV_ORGS_MAX_LOOKBACK_DAYS = 180;
export const DEV_ORGS_MAX_FEATURE_BRANCHES = 20;
export const DEV_ORGS_MAX_BRANCH_MERGES = 300;
// A registration that only says "still used" is written at most once a day
export const DEV_ORGS_ACTIVITY_REFRESH_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DevOrgType = 'sandbox' | 'scratch' | 'developer';

export interface DevOrgPerson {
  name: string;
  email: string;
}

export interface DevOrgFeatureBranch {
  name: string;
  lastSeen: string;
}

export interface DevOrgLastBackpromote {
  // When the backpromote started: a Pull Request merged while it ran still counts as missing
  date: string;
  parentBranch: string;
  // The newest Pull Request of the parent branch the backpromote brought
  pullRequest: number | null;
}

// One comment per development org. Every field is readable by anyone who can read the repository.
export interface DevOrgData {
  v: 1;
  kind: 'org';
  orgId: string;
  // A removal is written as a comment too: the comments of others cannot always be deleted
  removed?: boolean;
  orgType: DevOrgType;
  // The sandbox name, or the alias of a scratch org
  name: string;
  sandboxName: string;
  alias: string | null;
  instanceUrl: string;
  expirationDate: string | null;
  targetBranch: string;
  owner: DevOrgPerson | null;
  users: DevOrgPerson[];
  featureBranches: DevOrgFeatureBranch[];
  registeredAt: string;
  lastActivityAt: string;
  lastBackpromote: DevOrgLastBackpromote | null;
  updatedAt: string;
  updatedBy: DevOrgPerson | null;
}

export interface DevOrgCarriedPullRequest {
  number: number;
  title: string;
  url: string;
}

export interface DevOrgBranchMerge {
  number: number;
  title: string;
  url: string;
  mergedAt: string;
  sourceBranch: string;
  // A merge that only moves other Pull Requests (a major branch, a promotion branch)
  vehicle: boolean;
  // What a vehicle carries, when it is known
  carried: DevOrgCarriedPullRequest[] | null;
}

// One comment per target branch: the Pull Requests merged into it since `since`
export interface DevOrgBranchData {
  v: 1;
  kind: 'branch';
  branch: string;
  since: string;
  // True when `since` was cut to the lookback limit: older orgs miss more than what is listed
  capped: boolean;
  computedAt: string;
  jobUrl: string | null;
  merges: DevOrgBranchMerge[];
}

export type DevOrgCommentData = DevOrgData | DevOrgBranchData;

export interface DevOrgComment<T extends DevOrgCommentData = DevOrgCommentData> {
  id: number;
  createdDate: string;
  data: T;
}

export interface DevOrgsState {
  // One per org, removed, expired and replaced orgs left out
  orgs: DevOrgComment<DevOrgData>[];
  branches: Map<string, DevOrgComment<DevOrgBranchData>>;
  // Comments a writer should delete, oldest first. A removal comment comes after the ones it hides,
  // and is only deleted when they all are.
  obsolete: DevOrgComment[];
}

export interface DevOrgBehind {
  count: number;
  oldestMergedAt: string | null;
  oldestDays: number | null;
  computedAt: string;
  // Some missing Pull Requests are older than the lookback limit, and are not counted
  cutOff: boolean;
  pullRequests: DevOrgBranchMerge[];
}

export interface DevOrgSummary {
  orgId: string;
  orgType: DevOrgType;
  name: string;
  alias: string | null;
  instanceUrl: string;
  expirationDate: string | null;
  targetBranch: string;
  owner: DevOrgPerson | null;
  users: DevOrgPerson[];
  featureBranches: DevOrgFeatureBranch[];
  registeredAt: string;
  lastActivityAt: string;
  lastBackpromote: DevOrgLastBackpromote | null;
  isMine: boolean;
  stale: boolean;
  startDate: string;
  behind: DevOrgBehind | null;
}

// Everything a human or the VS Code panel reads about the registry
export interface DevOrgsSummary {
  enabled: boolean;
  dashboardUrl: string | null;
  currentUser: DevOrgPerson | null;
  staleDays: number;
  orgs: DevOrgSummary[];
  branches: Array<{ name: string; since: string; computedAt: string; jobUrl: string | null }>;
  warnings: string[];
}

// What a command knows about the org it registers
export interface DevOrgIdentity {
  orgId: string;
  orgType: DevOrgType;
  sandboxName: string;
  alias: string | null;
  instanceUrl: string;
  expirationDate: string | null;
}

export interface DevOrgRegistration {
  org: DevOrgIdentity;
  // The target branch the command works with. It only becomes the registered one for a new
  // entry, or with setTargetBranch.
  targetBranch?: string | null;
  setTargetBranch?: boolean;
  featureBranch?: string | null;
  // The person running the command: added to the users, and owner of a new entry
  currentUser?: DevOrgPerson | null;
  addCurrentUser?: boolean;
  owner?: DevOrgPerson | null;
  users?: DevOrgPerson[] | null;
  addUsers?: DevOrgPerson[];
  removeUsers?: string[];
  lastBackpromote?: DevOrgLastBackpromote | null;
  touchActivity?: boolean;
}

export interface DevOrgRegistrationResult {
  data: DevOrgData;
  // False when nothing worth a write changed
  changed: boolean;
  isNew: boolean;
  // The registered target branch, when the command worked with another one
  otherTargetBranch: string | null;
}

// ---- Comments ----

export function buildDevOrgCommentBody(data: DevOrgCommentData, format: DashboardFormat): string {
  return buildDashboardCommentBody(describeDevOrgComment(data), encodeDashboardData(DEV_ORGS_DATA_NAME, data), format);
}

// Null for a comment that is not one of sfdx-hardis
export function parseDevOrgComment(comment: DashboardComment): DevOrgComment | null {
  const data = decodeDashboardData(DEV_ORGS_DATA_NAME, comment.body);
  if (data?.v !== 1) {
    return null;
  }
  if (data.kind === 'org' && typeof data.orgId === 'string' && data.orgId !== '') {
    return { id: comment.id, createdDate: comment.createdDate, data: normalizeOrgData(data) };
  }
  if (data.kind === 'branch' && typeof data.branch === 'string' && data.branch !== '') {
    return { id: comment.id, createdDate: comment.createdDate, data: { ...data, merges: Array.isArray(data.merges) ? data.merges : [] } };
  }
  return null;
}

/**
 * The registry from the comments of the dashboard. The newest comment of an org is its truth (a
 * comment can stay when its writer was not allowed to delete it), a newer org id under the name of
 * a sandbox is its refresh and replaces it, and an expired scratch org is gone.
 */
export function analyzeDevOrgComments(comments: DevOrgComment[], now: Date = new Date()): DevOrgsState {
  const sorted = [...comments].sort((a, b) => a.id - b.id);
  const obsolete: DevOrgComment[] = [];
  const groups = new Map<string, DevOrgComment<DevOrgData>[]>();
  const branches = new Map<string, DevOrgComment<DevOrgBranchData>>();
  for (const comment of sorted) {
    if (comment.data.kind === 'org') {
      const group = groups.get(comment.data.orgId) || [];
      group.push(comment as DevOrgComment<DevOrgData>);
      groups.set(comment.data.orgId, group);
    } else {
      const previous = branches.get(comment.data.branch);
      if (previous) {
        obsolete.push(previous);
      }
      branches.set(comment.data.branch, comment as DevOrgComment<DevOrgBranchData>);
    }
  }
  const live: DevOrgComment<DevOrgData>[] = [];
  for (const group of groups.values()) {
    const newest = group[group.length - 1];
    obsolete.push(...group.slice(0, -1));
    if (newest.data.removed || isDevOrgExpired(newest.data, now)) {
      obsolete.push(newest);
    } else {
      live.push(newest);
    }
  }
  // A refreshed sandbox gets a new org id under the same name: the newest registration wins
  const orgs = live.filter((candidate) => {
    if (candidate.data.orgType !== 'sandbox') {
      return true;
    }
    const replacedBy = live.find(
      (other) =>
        other !== candidate &&
        other.data.orgType === 'sandbox' &&
        other.data.sandboxName.toLowerCase() === candidate.data.sandboxName.toLowerCase() &&
        (Date.parse(other.data.registeredAt) > Date.parse(candidate.data.registeredAt) ||
          (Date.parse(other.data.registeredAt) === Date.parse(candidate.data.registeredAt) && other.id > candidate.id))
    );
    if (replacedBy) {
      obsolete.push(...(groups.get(candidate.data.orgId) || []).filter((comment) => !obsolete.includes(comment)));
      return false;
    }
    return true;
  });
  return { orgs, branches, obsolete: obsolete.sort((a, b) => a.id - b.id) };
}

/** The org registered under this org id */
export function findDevOrg(state: DevOrgsState, orgId: string): DevOrgComment<DevOrgData> | null {
  return state.orgs.find((candidate) => isSameDevOrgId(candidate.data.orgId, orgId)) || null;
}

/**
 * Two org ids of the same org: equal, or one is the 15-character form of the other (Setup shows
 * 15 characters, sfdx-hardis stores the 18 of Organization.Id). The 15 first characters are case
 * sensitive, the 3 last are a checksum.
 */
export function isSameDevOrgId(first: string | null | undefined, second: string | null | undefined): boolean {
  if (!first || !second) {
    return false;
  }
  if (first === second) {
    return true;
  }
  return (first.length === 15 || second.length === 15) && first.length >= 15 && second.length >= 15 && first.slice(0, 15) === second.slice(0, 15);
}

/** A registered sandbox that has the name of this org under another org id: the org is its refresh */
export function findRefreshedSandbox(state: DevOrgsState, org: Pick<DevOrgIdentity, 'orgId' | 'orgType' | 'sandboxName'>): DevOrgComment<DevOrgData> | null {
  if (org.orgType !== 'sandbox') {
    return null;
  }
  return (
    state.orgs.find(
      (candidate) =>
        candidate.data.orgType === 'sandbox' &&
        candidate.data.orgId !== org.orgId &&
        candidate.data.sandboxName.toLowerCase() === org.sandboxName.toLowerCase()
    ) || null
  );
}

/**
 * The entry after a registration. A refreshed sandbox is a new sandbox: pass no `existing`.
 * Throws nothing: a new entry without a target branch is reported with `data.targetBranch` empty.
 */
export function applyDevOrgRegistration(existing: DevOrgData | null, registration: DevOrgRegistration, now: Date = new Date()): DevOrgRegistrationResult {
  const nowIso = now.toISOString();
  const currentUser = registration.currentUser || null;
  const base: DevOrgData = existing
    ? { ...existing, users: [...existing.users], featureBranches: [...existing.featureBranches] }
    : {
      v: 1,
      kind: 'org',
      orgId: registration.org.orgId,
      orgType: registration.org.orgType,
      name: devOrgDisplayName(registration.org),
      sandboxName: registration.org.sandboxName,
      alias: registration.org.alias,
      instanceUrl: registration.org.instanceUrl,
      expirationDate: registration.org.expirationDate,
      targetBranch: registration.targetBranch || '',
      owner: registration.owner || currentUser,
      users: [],
      featureBranches: [],
      registeredAt: nowIso,
      lastActivityAt: nowIso,
      lastBackpromote: null,
      updatedAt: nowIso,
      updatedBy: currentUser,
    };
  const next: DevOrgData = { ...base };
  // What the org says about itself is always the latest
  next.instanceUrl = registration.org.instanceUrl || next.instanceUrl;
  next.alias = registration.org.alias || next.alias;
  next.expirationDate = registration.org.expirationDate || next.expirationDate;
  next.name = devOrgDisplayName({ orgType: next.orgType, alias: next.alias, sandboxName: next.sandboxName });
  let otherTargetBranch: string | null = null;
  if (registration.targetBranch) {
    if (!existing || registration.setTargetBranch || !next.targetBranch) {
      next.targetBranch = registration.targetBranch;
    } else if (registration.targetBranch !== next.targetBranch) {
      otherTargetBranch = next.targetBranch;
    }
  }
  if (registration.owner !== undefined && existing) {
    next.owner = registration.owner;
  }
  if (registration.users) {
    next.users = dedupePersons(registration.users);
  }
  const added = [...(registration.addUsers || [])];
  if (registration.addCurrentUser && currentUser) {
    added.push(currentUser);
  }
  next.users = dedupePersons([...next.users, ...added]);
  if (registration.removeUsers && registration.removeUsers.length > 0) {
    const removed = new Set(registration.removeUsers.map((email) => email.toLowerCase()));
    next.users = next.users.filter((user) => !removed.has(user.email.toLowerCase()));
  }
  // The owner is not listed twice
  if (next.owner) {
    const ownerEmail = next.owner.email.toLowerCase();
    next.users = next.users.filter((user) => user.email.toLowerCase() !== ownerEmail);
  }
  if (registration.featureBranch) {
    next.featureBranches = [
      { name: registration.featureBranch, lastSeen: nowIso },
      ...next.featureBranches.filter((branch) => branch.name !== registration.featureBranch),
    ].slice(0, DEV_ORGS_MAX_FEATURE_BRANCHES);
  }
  if (registration.lastBackpromote) {
    next.lastBackpromote = registration.lastBackpromote;
  }
  if (registration.touchActivity !== false) {
    next.lastActivityAt = nowIso;
  }
  const changed = !existing || hasMeaningfulChange(existing, next);
  if (changed) {
    next.updatedAt = nowIso;
    next.updatedBy = currentUser || next.updatedBy;
  } else {
    // Nothing is written: the entry stays as the dashboard holds it
    return { data: existing!, changed: false, isNew: false, otherTargetBranch };
  }
  return { data: next, changed: true, isNew: !existing, otherTargetBranch };
}

/** The removal comment of an org */
export function buildDevOrgRemoval(existing: DevOrgData, currentUser: DevOrgPerson | null, now: Date = new Date()): DevOrgData {
  return { ...existing, removed: true, updatedAt: now.toISOString(), updatedBy: currentUser };
}

// ---- Behind ----

/** From when the Pull Requests merged into the target branch are missing in the org */
export function devOrgStartDate(org: DevOrgData): string {
  const backpromote = org.lastBackpromote;
  if (backpromote && backpromote.parentBranch === org.targetBranch && Date.parse(backpromote.date) > Date.parse(org.registeredAt)) {
    return backpromote.date;
  }
  return org.registeredAt;
}

/** The first merge date to list for a branch: the oldest start of its orgs, within the lookback limit */
export function branchWindowStart(orgs: DevOrgData[], now: Date = new Date()): { since: string; capped: boolean } {
  const limit = now.getTime() - DEV_ORGS_MAX_LOOKBACK_DAYS * DAY_MS;
  const starts = orgs.map((org) => Date.parse(devOrgStartDate(org))).filter((time) => !isNaN(time));
  const oldest = starts.length > 0 ? Math.min(...starts) : now.getTime();
  return oldest < limit ? { since: new Date(limit).toISOString(), capped: true } : { since: new Date(oldest).toISOString(), capped: false };
}

/** Null when the merges of the target branch are not known from the start date of the org */
export function computeDevOrgBehind(org: DevOrgData, branch: DevOrgBranchData | null | undefined, now: Date = new Date()): DevOrgBehind | null {
  if (!branch) {
    return null;
  }
  const start = Date.parse(devOrgStartDate(org));
  const since = Date.parse(branch.since);
  const cutOff = start < since;
  if (cutOff && !branch.capped) {
    return null;
  }
  const pullRequests = branch.merges
    .filter((merge) => Date.parse(merge.mergedAt) > start)
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
  const oldest = pullRequests.length > 0 ? pullRequests[pullRequests.length - 1].mergedAt : null;
  return {
    count: pullRequests.length,
    oldestMergedAt: oldest,
    oldestDays: oldest ? Math.floor((now.getTime() - Date.parse(oldest)) / DAY_MS) : null,
    computedAt: branch.computedAt,
    cutOff,
    pullRequests,
  };
}

/** The merges of a branch to store, newest first, keeping what was already known of a vehicle */
export function buildBranchMerges(
  merged: DevOrgBranchMerge[],
  previous: DevOrgBranchData | null | undefined,
  since: string
): DevOrgBranchMerge[] {
  const known = new Map((previous?.merges || []).map((merge) => [merge.number, merge]));
  return merged
    .filter((merge) => Date.parse(merge.mergedAt) > Date.parse(since))
    .map((merge) => (merge.vehicle && merge.carried === null && known.get(merge.number)?.carried ? { ...merge, carried: known.get(merge.number)!.carried } : merge))
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))
    .slice(0, DEV_ORGS_MAX_BRANCH_MERGES);
}

// ---- Summary ----

export function buildDevOrgsSummary(
  state: DevOrgsState,
  options: { enabled: boolean; dashboardUrl: string | null; currentUser: DevOrgPerson | null; staleDays: number; warnings?: string[] },
  now: Date = new Date()
): DevOrgsSummary {
  const orgs = state.orgs
    .map((comment) => buildOrgSummary(comment.data, state.branches.get(comment.data.targetBranch)?.data, options, now))
    .sort((a, b) => a.targetBranch.localeCompare(b.targetBranch) || a.name.localeCompare(b.name));
  return {
    enabled: options.enabled,
    dashboardUrl: options.dashboardUrl,
    currentUser: options.currentUser,
    staleDays: options.staleDays,
    orgs,
    branches: [...state.branches.values()]
      .map((comment) => ({ name: comment.data.branch, since: comment.data.since, computedAt: comment.data.computedAt, jobUrl: comment.data.jobUrl }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    warnings: options.warnings || [],
  };
}

export function isDevOrgMine(org: Pick<DevOrgData, 'owner' | 'users'>, user: DevOrgPerson | null): boolean {
  if (!user?.email) {
    return false;
  }
  const email = user.email.toLowerCase();
  return [org.owner, ...org.users].some((person) => person?.email?.toLowerCase() === email);
}

export function isDevOrgStale(org: Pick<DevOrgData, 'lastActivityAt'>, staleDays: number, now: Date = new Date()): boolean {
  const time = Date.parse(org.lastActivityAt);
  return !isNaN(time) && now.getTime() - time > staleDays * DAY_MS;
}

export function isDevOrgExpired(org: Pick<DevOrgData, 'orgType' | 'expirationDate'>, now: Date = new Date()): boolean {
  if (org.orgType !== 'scratch' || !org.expirationDate) {
    return false;
  }
  const time = Date.parse(org.expirationDate);
  // The expiration date is a day: the scratch org lives until its end
  return !isNaN(time) && now.getTime() > time + DAY_MS;
}

/** "Jane Doe <jane@example.com>", or a bare email, whose name is what comes before the @ */
export function parseDevOrgPerson(value: string): DevOrgPerson | null {
  const text = (value || '').trim();
  const match = text.match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (match) {
    return { name: match[1].trim() || nameOfEmail(match[2]), email: match[2] };
  }
  if (/^[^\s@]+@[^\s@]+$/.test(text)) {
    return { name: nameOfEmail(text), email: text };
  }
  return null;
}

function nameOfEmail(email: string): string {
  return email.split('@')[0] || email;
}

export function formatDevOrgPerson(person: DevOrgPerson | null | undefined): string {
  if (!person) {
    return '';
  }
  return person.name && person.name !== person.email ? `${person.name} <${person.email}>` : person.email;
}

export function devOrgDisplayName(org: Pick<DevOrgIdentity, 'orgType' | 'alias' | 'sandboxName'>): string {
  return org.orgType === 'scratch' && org.alias ? org.alias : org.sandboxName;
}

// ---- Dashboard body ----

export function buildDevOrgsDashboardBody(summary: DevOrgsSummary, format: DashboardFormat): string {
  const blocks: DashboardBlock[] = [];
  blocks.push({
    text:
      `Development orgs registry managed by sfdx-hardis: the developer sandboxes and scratch orgs of the project, the branch each of them targets, and the Pull Requests merged into that branch since their last backpromote. ` +
      `Do not edit this text or the comments below: sfdx-hardis rewrites this text at every update. Use the DevOps Pipeline of VS Code, or sf hardis:project:dev-org:register. Times are UTC.`,
  });
  if (summary.orgs.length === 0) {
    blocks.push({ text: 'No development org is registered.' });
  }
  const targetBranches = [...new Set(summary.orgs.map((org) => org.targetBranch))].sort();
  for (const targetBranch of targetBranches) {
    blocks.push({ heading: `Target branch ${targetBranch}` });
    blocks.push({
      table: {
        headers: ['Org', 'Type', 'Owner', 'Users', 'Merged since last backpromote', 'Oldest missing', 'Last backpromote', 'Last activity', 'Status'],
        rows: summary.orgs
          .filter((org) => org.targetBranch === targetBranch)
          .map((org) => [
            org.instanceUrl ? { label: org.name, url: org.instanceUrl } : org.name,
            org.orgType,
            org.owner?.name || '',
            org.users.map((user) => user.name).join(', '),
            behindLabel(org.behind),
            org.behind?.oldestMergedAt ? `${org.behind.oldestDays} days` : '',
            org.lastBackpromote ? formatDashboardDay(org.lastBackpromote.date) : 'Never',
            formatDashboardDay(org.lastActivityAt),
            org.stale ? `Stale (no activity for ${summary.staleDays} days)` : 'Active',
          ]),
      },
    });
  }
  if (summary.branches.length > 0) {
    blocks.push({ heading: 'Merged Pull Requests lists' });
    blocks.push({
      table: {
        headers: ['Branch', 'Listed since', 'Computed', 'Job'],
        rows: summary.branches.map((branch) => [branch.name, formatDashboardDay(branch.since), formatDashboardDate(branch.computedAt), jobLink(branch.jobUrl)]),
      },
    });
  }
  return renderDashboardBlocks(blocks, format);
}

// ---- Private ----

// First line of a comment, for the human who opens the dashboard
function describeDevOrgComment(data: DevOrgCommentData): string {
  if (data.kind === 'branch') {
    return `Pull Requests merged into ${data.branch} since ${formatDashboardDay(data.since)}: ${data.merges.length} (computed on ${formatDashboardDate(data.computedAt)})`;
  }
  if (data.removed) {
    return `Development org ${data.name} removed on ${formatDashboardDate(data.updatedAt)}`;
  }
  return `Development org ${data.name} (${data.orgType}), target branch ${data.targetBranch}, owner ${data.owner?.name || 'unknown'}`;
}

function normalizeOrgData(data: any): DevOrgData {
  return {
    ...data,
    users: Array.isArray(data.users) ? data.users.filter(isPerson) : [],
    owner: isPerson(data.owner) ? data.owner : null,
    featureBranches: Array.isArray(data.featureBranches) ? data.featureBranches : [],
    lastBackpromote: data.lastBackpromote || null,
    expirationDate: data.expirationDate || null,
    alias: data.alias || null,
    sandboxName: String(data.sandboxName || data.name || ''),
    name: String(data.name || data.sandboxName || data.orgId),
    targetBranch: String(data.targetBranch || ''),
  };
}

function isPerson(value: any): value is DevOrgPerson {
  return value && typeof value.email === 'string' && value.email !== '';
}

function dedupePersons(persons: DevOrgPerson[]): DevOrgPerson[] {
  const byEmail = new Map<string, DevOrgPerson>();
  for (const person of persons.filter(isPerson)) {
    byEmail.set(person.email.toLowerCase(), person);
  }
  return [...byEmail.values()];
}

// Only the date of the last activity changed, less than a day after the one written: not worth a write
function hasMeaningfulChange(previous: DevOrgData, next: DevOrgData): boolean {
  const strip = (data: DevOrgData) => JSON.stringify({ ...data, lastActivityAt: '', updatedAt: '', updatedBy: null, featureBranches: data.featureBranches.map((branch) => branch.name) });
  if (strip(previous) !== strip(next)) {
    return true;
  }
  return Date.parse(next.lastActivityAt) - Date.parse(previous.lastActivityAt) > DEV_ORGS_ACTIVITY_REFRESH_MS;
}

function buildOrgSummary(
  org: DevOrgData,
  branch: DevOrgBranchData | undefined,
  options: { currentUser: DevOrgPerson | null; staleDays: number },
  now: Date
): DevOrgSummary {
  return {
    orgId: org.orgId,
    orgType: org.orgType,
    name: org.name,
    alias: org.alias,
    instanceUrl: org.instanceUrl,
    expirationDate: org.expirationDate,
    targetBranch: org.targetBranch,
    owner: org.owner,
    users: org.users,
    featureBranches: org.featureBranches,
    registeredAt: org.registeredAt,
    lastActivityAt: org.lastActivityAt,
    lastBackpromote: org.lastBackpromote,
    isMine: isDevOrgMine(org, options.currentUser),
    stale: isDevOrgStale(org, options.staleDays, now),
    startDate: devOrgStartDate(org),
    behind: computeDevOrgBehind(org, branch, now),
  };
}

function behindLabel(behind: DevOrgBehind | null): string {
  if (!behind) {
    return 'Not computed yet';
  }
  const vehicles = behind.pullRequests.filter((merge) => merge.vehicle);
  const carried = vehicles.reduce((total, merge) => total + (merge.carried?.length || 0), 0);
  let label = `${behind.count}${behind.cutOff ? '+' : ''}`;
  if (vehicles.length > 0) {
    label += ` (${vehicles.length} carrying ${carried > 0 ? carried : 'several'} Pull Requests)`;
  }
  return label;
}

function jobLink(url: string | null | undefined): DashboardCell {
  return url ? { label: 'job', url } : '';
}

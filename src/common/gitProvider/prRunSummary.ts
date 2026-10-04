/*
Machine-readable summary of a validation or deployment run, carried by the Pull Request comment
that reports it.

The validation and deployment comments are markdown written for a reviewer. A UI that wants to list
the runs of a Pull Request (the VS Code Pull Request view) needs the same facts as data: which kind
of run, its outcome, the branch it targeted, the job that ran it. They travel in a hidden marker of
the comment itself, so reading the comments is enough and nothing else has to be stored.

A comment posted before the marker existed is still read: its kind comes from its message key and
its outcome from its banner. It has no counts, and is flagged as legacy.

The comment MegaLinter posts on the Pull Request is read the same way, as a third kind of run: it
is not written by sfdx-hardis, so it never carries a run summary, only its outcome and its text.

This module holds only pure helpers, with no git provider import, like prCommentNav.ts.
*/

import { getPrCommentKind, PR_NAV_END, PR_NAV_START } from "./prCommentNav.js";

export type PrRunKind = 'validation' | 'deployment';

// What a Pull Request comment can report: a run of sfdx-hardis, or the analysis of MegaLinter
export type PrWorkflowKind = PrRunKind | 'megalinter';

// Present in every HTML comment marker, the ones of sfdx-hardis and the one of MegaLinter: used
// to list the comments of a Pull Request once for both
export const PR_COMMENT_HIDDEN_MARKER = '<!-- ';

// pending: the placeholder deployment comment created before the merge, with no result yet
export type PrRunStatus = 'valid' | 'invalid' | 'pending';

export interface PrRunSummary {
  v: number;
  kind: PrRunKind;
  status: PrRunStatus;
  targetBranch?: string;
  jobUrl?: string;
  date?: string;
  quickDeploy?: boolean;
  testLevel?: string;
  errorCount?: number;
  failedTestsCount?: number;
  // First line of the code coverage section, as plain text
  coverageText?: string;
}

export interface PrWorkflowRun {
  kind: PrWorkflowKind;
  status: PrRunStatus;
  targetBranch: string;
  jobUrl: string;
  commentUrl: string;
  date: string;
  quickDeploy: boolean;
  testLevel: string;
  errorCount: number | null;
  failedTestsCount: number | null;
  coverageText: string;
  // The comment as a reviewer reads it, without the hidden markers and the navigation line
  body: string;
  // True when the comment was posted before the run summary marker existed
  legacy: boolean;
}

const RUN_SUMMARY_VERSION = 1;
const RUN_SUMMARY_REGEX = /<!-- sfdx-hardis run-summary ([A-Za-z0-9+/=]+) -->/;
const BANNER_REGEX = /pr-banner-(validation|deployment)-(success|failure)/;
const HIDDEN_MARKER_REGEX = /[ \t]*<!-- sfdx-hardis [^>]*-->[ \t]*\n?/g;
// The comment reporters of MegaLinter sign their comment with <!-- megalinter: <reporter> ... -->
const MEGALINTER_MARKER = '<!-- megalinter:';
// Its title when the marker is missing: "## ✅ [MegaLinter](https://megalinter.io/...) analysis: Success"
const MEGALINTER_TITLE_REGEX = /^#+ .*MegaLinter.*analysis: *([^\n]*)$/im;
const ANY_HIDDEN_MARKER_REGEX = /[ \t]*<!--[\s\S]*?-->[ \t]*\n?/g;
const MAX_TEXT_LENGTH = 200;

/**
 * Hidden marker to append to a validation or deployment comment. base64 keeps the JSON free of the
 * characters that would end the HTML comment or break a markdown table.
 */
export function encodeRunSummaryMarker(summary: Omit<PrRunSummary, 'v'>): string {
  const payload: PrRunSummary = { v: RUN_SUMMARY_VERSION, ...summary };
  return `<!-- sfdx-hardis run-summary ${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')} -->`;
}

/**
 * The summary carried by a comment body, or null when there is none or when it cannot be trusted.
 * Anyone allowed to comment can write such a marker: every field is checked against what it may
 * hold, and anything else is dropped rather than passed on.
 */
export function decodeRunSummaryMarker(body: string): PrRunSummary | null {
  const match = (body || '').match(RUN_SUMMARY_REGEX);
  if (!match) {
    return null;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  if (parsed.kind !== 'validation' && parsed.kind !== 'deployment') {
    return null;
  }
  if (parsed.status !== 'valid' && parsed.status !== 'invalid' && parsed.status !== 'pending') {
    return null;
  }
  return {
    v: Number.isInteger(parsed.v) ? parsed.v : RUN_SUMMARY_VERSION,
    kind: parsed.kind,
    status: parsed.status,
    targetBranch: cleanText(parsed.targetBranch),
    jobUrl: cleanWebUrl(parsed.jobUrl),
    date: cleanDate(parsed.date),
    quickDeploy: parsed.quickDeploy === true,
    testLevel: cleanText(parsed.testLevel),
    errorCount: cleanCount(parsed.errorCount),
    failedTestsCount: cleanCount(parsed.failedTestsCount),
    coverageText: cleanText(parsed.coverageText),
  };
}

/**
 * First line of a markdown section as plain text, for a summary that a UI shows on one line.
 */
export function markdownFirstLineAsText(markdown: string | undefined): string {
  const firstLine = (markdown || '').split('\n').map((line) => line.trim()).find((line) => line !== '') || '';
  return firstLine
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*|__|`/g, '')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

/**
 * The run a sfdx-hardis comment reports, or null when the comment is not a validation or a
 * deployment comment (Deployment Actions, Flow diffs, Backpromotes).
 */
export function parseWorkflowRunFromComment(comment: { body: string; url?: string; updatedAt?: string }): PrWorkflowRun | null {
  const body = comment?.body || '';
  const kind = getPrCommentKind(body);
  if (kind !== 'validation' && kind !== 'deployment') {
    return kind === null ? parseMegaLinterComment(comment) : null;
  }
  const summary = decodeRunSummaryMarker(body);
  // The kind of the message key wins: it is what sfdx-hardis itself matches a comment on
  const usableSummary = summary && summary.kind === kind ? summary : null;
  const legacyStatus = usableSummary ? usableSummary.status : readLegacyStatus(body);
  return {
    kind,
    status: legacyStatus,
    targetBranch: usableSummary?.targetBranch || '',
    jobUrl: usableSummary?.jobUrl || '',
    commentUrl: cleanWebUrl(comment.url) || '',
    date: usableSummary?.date || cleanDate(comment.updatedAt) || '',
    quickDeploy: usableSummary?.quickDeploy === true,
    testLevel: usableSummary?.testLevel || '',
    errorCount: usableSummary?.errorCount ?? null,
    failedTestsCount: usableSummary?.failedTestsCount ?? null,
    coverageText: usableSummary?.coverageText || '',
    body: stripHiddenParts(body),
    legacy: usableSummary === null,
  };
}

/**
 * The runs of a Pull Request from its sfdx-hardis comments, validations first, oldest first inside
 * each kind.
 */
export function parseWorkflowRunsFromComments(comments: Array<{ body: string; url?: string; updatedAt?: string }>): PrWorkflowRun[] {
  const runs = (comments || [])
    .map((comment) => parseWorkflowRunFromComment(comment))
    .filter((run): run is PrWorkflowRun => run !== null);
  const kindOrder: Record<PrWorkflowKind, number> = { validation: 0, deployment: 1, megalinter: 2 };
  return runs.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.date.localeCompare(b.date));
}

/**
 * The analysis MegaLinter reported in its own Pull Request comment, or null when the comment is
 * not one of MegaLinter. The outcome comes from its title ("analysis: Success", "Success with
 * warnings", "Error"): warnings do not fail the analysis.
 */
function parseMegaLinterComment(comment: { body: string; url?: string; updatedAt?: string }): PrWorkflowRun | null {
  const body = comment?.body || '';
  const title = body.match(MEGALINTER_TITLE_REGEX);
  if (!body.includes(MEGALINTER_MARKER) && !title) {
    return null;
  }
  // The outcome is a link in recent versions: "analysis: [Success with warnings](https://...)"
  const outcome = (title?.[1] || '').replace(/^[\s[]+/, '').toLowerCase();
  let status: PrRunStatus = 'pending';
  if (outcome.startsWith('success')) {
    status = 'valid';
  } else if (outcome.startsWith('error')) {
    status = 'invalid';
  } else {
    status = readLegacyStatus(body);
  }
  return {
    kind: 'megalinter',
    status,
    targetBranch: '',
    jobUrl: '',
    commentUrl: cleanWebUrl(comment.url) || '',
    date: cleanDate(comment.updatedAt) || '',
    quickDeploy: false,
    testLevel: '',
    errorCount: null,
    failedTestsCount: null,
    coverageText: '',
    body: body.replace(ANY_HIDDEN_MARKER_REGEX, '').trim(),
    legacy: false,
  };
}

/**
 * Outcome of a comment that carries no run summary: from its banner, else from the mark of its
 * title (banners can be switched off, and older comments have none). A failure mark wins: a
 * failed run still prints a success mark next to a coverage that is fine. Without any mark, the
 * comment is the placeholder waiting for the merge.
 */
function readLegacyStatus(body: string): PrRunStatus {
  const banner = body.match(BANNER_REGEX);
  if (banner) {
    return banner[2] === 'success' ? 'valid' : 'invalid';
  }
  if (body.includes('❌')) {
    return 'invalid';
  }
  if (body.includes('✅')) {
    return 'valid';
  }
  return 'pending';
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
  return text === '' ? undefined : text;
}

// http next to https: a self-hosted git provider or CI server is not always served over https
function cleanWebUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function cleanDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function cleanCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function stripHiddenParts(body: string): string {
  let text = body;
  const navStart = text.indexOf(PR_NAV_START);
  const navEnd = text.indexOf(PR_NAV_END);
  if (navStart !== -1 && navEnd > navStart) {
    text = text.slice(0, navStart) + text.slice(navEnd + PR_NAV_END.length);
  }
  return text.replace(HIDDEN_MARKER_REGEX, '').trim();
}

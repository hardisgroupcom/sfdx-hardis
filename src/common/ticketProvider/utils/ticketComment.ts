/**
 * What every ticketing connector shares to post a comment: the options and the result of a post,
 * the marker that lets a rerun find the comment it posted before, and the markdown of the
 * deployment comment, so the four connectors say the same thing in their own format.
 */

import { SfError } from '@salesforce/core';
import { CONSTANTS } from '../../../config/index.js';
import { getCurrentGitBranch } from '../../utils/index.js';
import { GitProvider, CommonPullRequestInfo } from '../../gitProvider/index.js';
import { t } from '../../utils/i18n.js';
import type { TicketAssignee, TicketCommentVisibility, TicketStepResult } from './ticketQualify.js';

export interface PostCommentOptions {
  /**
   * Key of a comment that a later run replaces instead of adding a new one. Only one comment per
   * ticket and per marker: the most recent one found is updated.
   */
  marker?: string;
  /** ServiceNow journal field written to (`work_notes`, `comments`...) */
  serviceNowField?: string;
  /** Real mention of this assignee, inserted right after the first block (JIRA, Azure Boards) */
  mention?: TicketAssignee | null;
  /** JIRA only: comment restricted to a project role or a group */
  visibility?: TicketCommentVisibility | null;
  /** The markdown went through toStrictMarkdown: Azure Boards adds the spacing its comment view drops */
  strictMarkdown?: boolean;
}

export interface PostCommentResult {
  ticketId: string;
  provider: string;
  /** skipped: --skip-if-marked found the ticket marked. refused: outside --allowed-projects */
  action: 'created' | 'updated' | 'skipped' | 'refused' | 'failed';
  commentId?: string;
  url?: string;
  error?: string;
  /** Stable name of the error (TicketAlreadyMarked, TicketOutOfScope, TicketNotFound...), when it has one */
  errorName?: string;
  /** Steps run after the comment by ticket post-comment; absent when the provider posted only */
  label?: TicketStepResult;
  transition?: TicketStepResult;
  points?: TicketStepResult;
}

const MARKER_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const MARKER_PREFIX = 'sfdx-hardis:';

/** Refuse a marker that could not be matched exactly once written in a comment. */
export function assertValidMarker(marker: string | undefined): void {
  if (marker !== undefined && !MARKER_RE.test(marker)) {
    throw new SfError(t('ticketCommentMarkerInvalid', { marker: JSON.stringify(marker) }));
  }
}

/** The text written in a comment to find it again: `sfdx-hardis:<marker>`. */
export function markerTag(marker: string): string {
  return `${MARKER_PREFIX}${marker}`;
}

/**
 * True when a comment body holds the marker, whatever its format (HTML, plain text, or a JSON
 * serialized Atlassian document). The tag must not run on into another marker character, so
 * `test-cases` never matches a comment marked `test-cases:xray`.
 */
export function hasMarker(body: unknown, marker: string): boolean {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  const tag = markerTag(marker);
  let index = text.indexOf(tag);
  while (index !== -1) {
    const next = text.charAt(index + tag.length);
    if (!/[A-Za-z0-9_.:-]/.test(next)) {
      return true;
    }
    index = text.indexOf(tag, index + 1);
  }
  return false;
}

/**
 * Hidden marker for the trackers that store HTML (Azure Boards, Aha!): an empty span carrying the
 * tag as its title. Not an HTML comment, which Azure Boards strips from a comment when it saves it.
 */
export function htmlMarker(marker: string | undefined): string {
  return marker ? `<span title="${markerTag(marker)}"></span>` : '';
}

/**
 * Visible marker for the trackers that have no hidden text (Jira, ServiceNow). Written as inline
 * code, which no format escapes, so the tag stays exactly as `hasMarker` looks for it.
 */
export function markdownMarkerFooter(marker: string | undefined): string {
  return marker ? `\n\n\`${markerTag(marker)}\`` : '';
}

/**
 * Escape a value written inside the deployment markdown: it comes from a branch name or a Pull
 * Request title, and must not become markup in any output format.
 */
export function escapeMarkdownText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\[\]*_`])/g, '\\$1');
}

/** A markdown link, or the bare escaped label when the URL is not http(s). */
function _link(label: string, url: string | undefined | null): string {
  const safeLabel = escapeMarkdownText(label);
  return url && /^https?:\/\//i.test(url) ? `[${safeLabel}](${url})` : safeLabel;
}

/**
 * Markdown of the comment posted on a deployed ticket, shared by every connector, which turns it
 * into its own format (Jira document or wiki markup, HTML, plain text).
 */
export async function buildDeploymentCommentMarkdown(org: string, pullRequestInfo: CommonPullRequestInfo | null): Promise<string> {
  const orgLabel = String(org || '').replace('https://', '').replace('.my.salesforce.com', '');
  const branchName = (await getCurrentGitBranch()) || '';
  const branchUrl = (await GitProvider.getCurrentBranchUrl()) || '';
  let text = `Deployed by ${_link('sfdx-hardis', `${CONSTANTS.DOC_URL_ROOT}/`)}`;
  if (orgLabel) {
    text += ` in **${_link(orgLabel, org)}**`;
  }
  if (branchName) {
    text += ` from branch **${_link(branchName, branchUrl)}**`;
  }
  if (pullRequestInfo?.webUrl) {
    const author = pullRequestInfo.authorName ? `, by ${escapeMarkdownText(pullRequestInfo.authorName)}` : '';
    text += `\n\nRelated PR: ${_link(pullRequestInfo.title || pullRequestInfo.webUrl, pullRequestInfo.webUrl)}${author}`;
  }
  return text;
}

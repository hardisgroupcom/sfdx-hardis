/*
Navigation between the sfdx-hardis comments of a Pull Request.

A Pull Request can carry three sfdx-hardis comments (validation, deployment, deployment actions),
posted by different jobs and buried under the other comments. Each of them, and the Pull Request
description, displays the same navigation line linking to the others.

This module holds only pure helpers and the process cache, with no git provider import, so both the
providers and the deployment actions state can use it without a circular import. The API calls
themselves are in GitProvider.refreshPullRequestNavigation().
*/

import { getEnvVar } from "../../config/index.js";

export type PrCommentKind = 'validation' | 'deployment' | 'actions';

export const PR_NAV_START = '<!-- sfdx-hardis nav-start -->';
export const PR_NAV_END = '<!-- sfdx-hardis nav-end -->';

// Present in every comment posted by sfdx-hardis, whatever its kind: used to list them all at once
export const SFDX_HARDIS_COMMENT_MARKER = '<!-- sfdx-hardis ';

// Must match DEPLOYMENT_ACTIONS_MARKER in deploymentActionsStateUtils.ts
export const DEPLOYMENT_ACTIONS_MARKER = '<!-- sfdx-hardis deployment-actions-state -->';

const MESSAGE_KEY_REGEX = /<!-- sfdx-hardis message-key (\S+) -->/;

/**
 * Which of the three sfdx-hardis comments a body is, read from its markers.
 * Returns null for the other sfdx-hardis comments (Flow diffs), which stay out of the navigation.
 */
export function getPrCommentKind(body: string): PrCommentKind | null {
  if (body.includes(DEPLOYMENT_ACTIONS_MARKER)) {
    return 'actions';
  }
  // Provider suffixes follow the message key: deployment-check-<job>-<pr>, deployment-<job>-<pr>
  const messageKey = body.match(MESSAGE_KEY_REGEX)?.[1] || '';
  if (messageKey.startsWith('deployment-check-')) {
    return 'validation';
  }
  if (messageKey.startsWith('deployment-')) {
    return 'deployment';
  }
  return null;
}

// Same order as the deployment lifecycle: validate, deploy, then run the actions
const NAV_ENTRIES: { kind: PrCommentKind; label: string }[] = [
  { kind: 'validation', label: '🔍 Validation' },
  { kind: 'deployment', label: '🚀 Deployment' },
  { kind: 'actions', label: '🛠️ Actions' },
];

export type PrCommentNavLinks = Partial<Record<PrCommentKind, string>>;

declare global {
  // eslint-disable-next-line no-var
  var pullRequestNavLinks: PrCommentNavLinks | undefined;
}

export function isPrCommentNavEnabled(): boolean {
  return (getEnvVar('SFDX_HARDIS_PR_COMMENT_NAV') || '') !== 'false';
}

// Editing the Pull Request description touches content owned by the user, so it has its own switch to turn it off
export function isPrDescriptionNavEnabled(): boolean {
  return isPrCommentNavEnabled() && (getEnvVar('SFDX_HARDIS_PR_DESCRIPTION_NAV') || '') !== 'false';
}

export function setPrCommentNavLinks(links: PrCommentNavLinks): void {
  globalThis.pullRequestNavLinks = links;
}

export function getPrCommentNavLinks(): PrCommentNavLinks {
  return globalThis.pullRequestNavLinks || {};
}

/**
 * The navigation line itself: the current comment as plain bold text, the other ones as links.
 * Returns an empty string when there is nothing to navigate to, so a lonely comment displays no
 * navigation at all.
 */
export function renderPrCommentNav(links: PrCommentNavLinks, currentKind: PrCommentKind | null): string {
  const parts = NAV_ENTRIES
    .filter((entry) => links[entry.kind] || entry.kind === currentKind)
    .map((entry) => (entry.kind === currentKind ? `**${entry.label}**` : `[${entry.label}](${links[entry.kind]})`));
  if (parts.length < 2) {
    return '';
  }
  return parts.join(' | ');
}

/**
 * Navigation block to embed in a comment being posted, markers included.
 * The links known at this point are used right away; GitProvider.refreshPullRequestNavigation()
 * completes them once the comment has its own URL.
 */
export function buildPrCommentNavBlock(currentKind: PrCommentKind): string {
  if (!isPrCommentNavEnabled()) {
    return '';
  }
  return wrapPrCommentNav(renderPrCommentNav(getPrCommentNavLinks(), currentKind)) + '\n\n';
}

export function wrapPrCommentNav(navLine: string): string {
  return navLine ? `${PR_NAV_START}\n${navLine}\n${PR_NAV_END}` : `${PR_NAV_START}${PR_NAV_END}`;
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NAV_BLOCK_REGEX = new RegExp(`${escapeForRegex(PR_NAV_START)}[\\s\\S]*?${escapeForRegex(PR_NAV_END)}`);

const NAV_BLOCK_CONTENT_REGEX = new RegExp(`${escapeForRegex(PR_NAV_START)}\\s*([\\s\\S]*?)\\s*${escapeForRegex(PR_NAV_END)}`);

/**
 * Navigation line already present in a comment body, or null when the body carries no
 * navigation block or an empty one.
 */
export function extractPrCommentNavLine(body: string): string | null {
  const match = (body || '').match(NAV_BLOCK_CONTENT_REGEX);
  const navLine = (match?.[1] || '').trim();
  return navLine === '' ? null : navLine;
}

/**
 * Kind of the comment a PullRequestMessageRequest will produce, from its base message key
 * (before the provider appends its job name suffix). Returns null for the other comments
 * (Flow diffs), which are only matched by their full message key.
 */
export function getPrCommentKindFromMessageKey(messageKey: string): PrCommentKind | null {
  if (messageKey === 'deployment-check') {
    return 'validation';
  }
  if (messageKey === 'deployment') {
    return 'deployment';
  }
  return null;
}

/**
 * Replace the navigation block of a comment body. A body without the markers is returned untouched,
 * so comments that are not part of the navigation (Flow diffs, user comments) are never modified.
 */
export function replacePrCommentNavBlock(body: string, navLine: string): string {
  if (!NAV_BLOCK_REGEX.test(body)) {
    return body;
  }
  return body.replace(NAV_BLOCK_REGEX, wrapPrCommentNav(navLine));
}

/**
 * Put the navigation at the very beginning of a Pull Request description, replacing the block
 * already there if any, and removing it when there is nothing left to link to.
 */
export function upsertNavInDescription(description: string, navLine: string): string {
  const currentDescription = description || '';
  const block = navLine ? `${PR_NAV_START}\n${navLine}\n${PR_NAV_END}` : '';
  if (NAV_BLOCK_REGEX.test(currentDescription)) {
    if (!block) {
      return currentDescription.replace(NAV_BLOCK_REGEX, '').replace(/^\s*\n+/, '');
    }
    return currentDescription.replace(NAV_BLOCK_REGEX, block);
  }
  if (!block) {
    return currentDescription;
  }
  return currentDescription.trim() === '' ? block : `${block}\n\n${currentDescription}`;
}

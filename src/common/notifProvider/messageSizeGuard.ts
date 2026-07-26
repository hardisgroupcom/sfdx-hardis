import type { NotifMessage } from "./types.js";
import { tMaybe } from "../utils/i18n.js";

/**
 * Generic guard against messages that a messaging platform would reject outright.
 *
 * Each provider owns its own limits (see the `SizeGuardLimits` constant next to each provider
 * class) because the numbers are platform facts; this module only implements the trimming.
 *
 * Attachment content is cut whole markdown lines at a time (table rows, list items) from the LAST
 * attachment backwards, so the first ones - which carry the most actionable content - survive.
 * Each trimmed attachment is marked with how many rows are shown, pointing at the Pull Request
 * when the notification has one.
 */

export interface SizeGuardLimits {
  // Total budget shared by every attachment text.
  maxAttachmentsChars: number;
  // Cap for a single rendered block / widget / section.
  maxBlockChars: number;
  // Cap for the number of blocks in one message.
  maxBlocks: number;
}

interface NoticeContext {
  pullRequestUrl?: string;
  // Follows NotifMessage.translateMessages: false keeps the notice English so it matches the rest
  // of a notification that opted out of translation (deployment notifications by default).
  translate: boolean;
}

function getTruncationNotice(shown: number, total: number, context: NoticeContext): string {
  return context.pullRequestUrl
    ? tMaybe(context.translate, 'notifTruncatedRowsSeePullRequest', { shown, total })
    : tMaybe(context.translate, 'notifTruncatedRows', { shown, total });
}

/**
 * Clamp a single text blob to a maximum character count, cutting on a line boundary when one is
 * close enough to the limit so markdown is not sliced mid-token.
 */
export function clampBlockText(text: string, maxChars: number, translate = true): string {
  if (!text || text.length <= maxChars) {
    return text;
  }
  const context: NoticeContext = { translate };
  const suffix = `\n${getTruncationNotice(0, 0, context)}`;
  const budget = Math.max(0, maxChars - suffix.length);
  let clamped = text.substring(0, budget);
  const lastNewline = clamped.lastIndexOf('\n');
  if (lastNewline > budget * 0.5) {
    clamped = clamped.substring(0, lastNewline);
  }
  const shownLines = clamped.split('\n').length;
  const totalLines = text.split('\n').length;
  return `${clamped}\n${getTruncationNotice(shownLines, totalLines, context)}`;
}

/**
 * Trim one attachment's text down to `budget` characters by dropping trailing lines.
 * Always keeps at least the first line (the attachment title) plus the truncation notice.
 */
function truncateAttachmentText(text: string, budget: number, context: NoticeContext): string {
  const lines = text.split('\n');
  const totalRows = lines.length;
  let kept = lines.length;
  let candidate = text;
  while (kept > 1) {
    const notice = getTruncationNotice(kept, totalRows, context);
    candidate = `${lines.slice(0, kept).join('\n')}\n${notice}`;
    if (candidate.length <= budget) {
      return candidate;
    }
    kept--;
  }
  return `${lines[0]}\n${getTruncationNotice(1, totalRows, context)}`;
}

/**
 * Return a copy of the notification whose attachments fit within the platform budget.
 * The input message is never mutated. Messages already under budget come back untouched.
 */
export function applyMessageSizeGuard(notifMessage: NotifMessage, limits: SizeGuardLimits): NotifMessage {
  const attachments = notifMessage.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return notifMessage;
  }

  const getLength = (att: any): number => (typeof att?.text === 'string' ? att.text.length : 0);
  let totalChars = attachments.reduce((sum: number, att: any) => sum + getLength(att), 0);
  if (totalChars <= limits.maxAttachmentsChars) {
    return notifMessage;
  }

  const noticeContext: NoticeContext = {
    pullRequestUrl: notifMessage.pullRequestUrl,
    translate: notifMessage.translateMessages !== false,
  };
  // Walk from the last attachment backwards, shrinking each one until the whole set fits.
  const newAttachments = [...attachments];
  for (let i = newAttachments.length - 1; i >= 0 && totalChars > limits.maxAttachmentsChars; i--) {
    const att = newAttachments[i];
    if (typeof att?.text !== 'string' || att.text.length === 0) {
      continue;
    }
    const originalLength = att.text.length;
    const overflow = totalChars - limits.maxAttachmentsChars;
    const budget = Math.max(0, originalLength - overflow);
    const truncatedText = truncateAttachmentText(att.text, budget, noticeContext);
    newAttachments[i] = { ...att, text: truncatedText };
    totalChars += truncatedText.length - originalLength;
  }

  return { ...notifMessage, attachments: newAttachments };
}

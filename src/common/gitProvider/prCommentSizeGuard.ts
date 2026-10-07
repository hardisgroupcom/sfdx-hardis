/**
 * Keeps an sfdx-hardis Pull Request comment under the size its git provider accepts.
 *
 * A comment is built as a list of sections. When the whole body is over the budget, the guard cuts
 * in an order that keeps what a reader needs first: long outputs lose their oldest lines, long
 * lists are shortened, then whole optional sections are dropped, biggest first. Sections flagged
 * `keep` (verdict, check table, errors, manual actions) are never touched. A notice line tells the
 * reader what was left out.
 */

// Room kept for the parts the provider adds around the message: navigation, banner, footer,
// message-key, deployment-id and run-summary markers
export const PR_COMMENT_FRAME_RESERVE = 4000;

// Number of lines kept at the end of a code block that is shortened
export const SHORTENED_CODE_BLOCK_LINES = 40;

// Number of entries kept in a list that is shortened
export const SHORTENED_LIST_ENTRIES = 50;

export type PrCommentSection = {
  // Stable identifier, used in tests and logs
  id: string;
  markdown: string;
  // Never shortened nor dropped
  keep?: boolean;
  // Shorter version of the section (lists cut to SHORTENED_LIST_ENTRIES entries), used before dropping it
  shortMarkdown?: string;
  // How the section is named in the "left out" notice
  dropLabel?: string;
};

export type FitPrCommentResult = {
  markdown: string;
  shortened: boolean;
  leftOut: string[];
};

/**
 * Join the sections, shortening them until the body fits the budget.
 * The budget is the number of characters available for the message part of the comment.
 */
export function fitPrCommentSections(sections: PrCommentSection[], budget: number, limitLabel: string): FitPrCommentResult {
  const current = sections.filter((s) => (s.markdown || '').trim() !== '').map((s) => ({ ...s }));
  const leftOut: string[] = [];
  const noticeRoom = 400;
  let isShortened = false;
  const fits = () => joinSections(current).length + (leftOut.length > 0 || isShortened ? noticeRoom : 0) <= budget;
  if (joinSections(current).length <= budget) {
    return { markdown: joinSections(current), shortened: false, leftOut };
  }
  // 1. Long code blocks keep their last lines
  for (const section of current) {
    if (section.keep) continue;
    const shortened = truncateCodeBlocks(section.markdown, SHORTENED_CODE_BLOCK_LINES);
    if (shortened !== section.markdown) {
      section.markdown = shortened;
      isShortened = true;
    }
  }
  // 2. Long lists keep their first entries
  if (!fits()) {
    for (const section of current) {
      if (section.keep || !section.shortMarkdown) continue;
      section.markdown = section.shortMarkdown;
      isShortened = true;
      if (fits()) break;
    }
  }
  // 3. Optional sections are dropped, biggest first
  if (!fits()) {
    const droppable = current.filter((s) => !s.keep).sort((a, b) => b.markdown.length - a.markdown.length);
    for (const section of droppable) {
      const index = current.indexOf(section);
      current.splice(index, 1);
      leftOut.push(section.dropLabel || section.id);
      if (fits()) break;
    }
  }
  let markdown = joinSections(current);
  if (leftOut.length > 0 || isShortened) {
    const what = leftOut.length > 0 ? `${leftOut.join(', ')} left out` : 'long outputs and lists shortened';
    markdown += `\n\n✂️ _Shortened to fit the ${limitLabel} character limit: ${what}. Full details in the job log._`;
  }
  // 4. Last resort: cut the end of the body, the provider frame (markers) is added after it
  if (markdown.length > budget) {
    markdown = cutMarkdown(markdown, budget);
  }
  return { markdown, shortened: true, leftOut };
}

/**
 * Keep the last `maxLines` lines of every fenced code block of a markdown text
 */
export function truncateCodeBlocks(markdown: string, maxLines: number): string {
  return markdown.replace(/(```[^\n]*\n)([\s\S]*?)(\n```)/g, (whole, open: string, content: string, close: string) => {
    const lines = content.split('\n');
    if (lines.length <= maxLines) {
      return whole;
    }
    const kept = lines.slice(-maxLines);
    return `${open}… ${lines.length - maxLines} lines left out\n${kept.join('\n')}${close}`;
  });
}

/**
 * Keep the first `maxEntries` entries of a markdown list, with a line counting the others
 */
export function truncateList(entries: string[], maxEntries: number): string[] {
  if (entries.length <= maxEntries) {
    return entries;
  }
  return [...entries.slice(0, maxEntries), `- _… and ${entries.length - maxEntries} more_`];
}

/**
 * Cut a whole comment body that is still over the hard limit of its provider. The hidden markers at
 * its end (message key, deployment id, run summary) are what sfdx-hardis reads back, so the cut is
 * made in the text before them.
 */
export function enforceCommentLengthLimit(body: string, limit: number): { body: string; cut: boolean } {
  if (body.length <= limit) {
    return { body, cut: false };
  }
  const markerStart = findTrailingMarkersStart(body);
  const tail = body.substring(markerStart);
  const notice = `\n\n✂️ _Cut to fit the comment size limit. Full details in the job log._\n\n`;
  const room = Math.max(0, limit - tail.length - notice.length);
  return { body: cutMarkdown(body.substring(0, markerStart), room) + notice + tail, cut: true };
}

function joinSections(sections: PrCommentSection[]): string {
  return sections.map((s) => s.markdown.trim()).filter((m) => m !== '').join('\n\n');
}

// Cut a markdown text at a line boundary, closing an open code fence and open <details> blocks so
// the rest of the comment still renders
function cutMarkdown(markdown: string, maxLength: number): string {
  let cut = markdown.substring(0, Math.max(0, maxLength - 100));
  const lastNewLine = cut.lastIndexOf('\n');
  if (lastNewLine > 0) {
    cut = cut.substring(0, lastNewLine);
  }
  if (((cut.match(/```/g) || []).length % 2) === 1) {
    cut += '\n```';
  }
  const openDetails = (cut.match(/<details/g) || []).length - (cut.match(/<\/details>/g) || []).length;
  for (let i = 0; i < openDetails; i++) {
    cut += '\n</details>';
  }
  return cut + '\n\n_…_';
}

// Start of the block of hidden sfdx-hardis markers and footer at the end of a comment body
function findTrailingMarkersStart(body: string): number {
  const candidates = ['_Powered by [sfdx-hardis]', '<!-- sfdx-hardis message-key', '<!-- sfdx-hardis run-summary'];
  const positions = candidates.map((c) => body.lastIndexOf(c)).filter((p) => p >= 0);
  return positions.length > 0 ? Math.min(...positions) : body.length;
}

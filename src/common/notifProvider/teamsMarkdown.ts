// Private Use Area placeholders, identical strategy to slackMarkdown.ts.
const CODE_PH_OPEN = '\u{E002}CODE';
const CODE_PH_CLOSE = '\u{E003}';
const INLINE_PH_OPEN = '\u{E004}INLINE';
const INLINE_PH_CLOSE = '\u{E005}';

const ATX_HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm;
const HORIZONTAL_RULE_RE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm;
const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const PIPE_TABLE_RE =
  /^[ \t]*\|[^\n]*\|[ \t]*\n[ \t]*\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*(?:\n[ \t]*\|[^\n]*\|[ \t]*)*/gm;
const BLANK_LINE_COLLAPSE_RE = /\n{3,}/g;
const TRAILING_WS_RE = /[ \t]+$/gm;

const INLINE_PH_RESTORE_RE = new RegExp(`${INLINE_PH_OPEN}(\\d+)${INLINE_PH_CLOSE}`, 'g');
const CODE_PH_RESTORE_RE = new RegExp(`${CODE_PH_OPEN}(\\d+)${CODE_PH_CLOSE}`, 'g');

/**
 * Convert CommonMark / GitHub-flavored Markdown to the GFM subset that Microsoft
 * Teams Adaptive Card `TextBlock` renders correctly.
 *
 * Teams TextBlock supports `**bold**`, `*italic*`, `~~strike~~`, `[label](url)`,
 * inline code, and bullet / ordered lists - but not ATX headings, markdown tables,
 * horizontal rules, or fenced code blocks. Headings collapse to bold lines, tables
 * are wrapped in triple-backtick fences (so columns at least line up visually in
 * monospace-aware clients), and horizontal rules are removed.
 */
export function convertMarkdownToTeamsMrkdwn(input: string): string {
  if (!input) {
    return input;
  }

  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];
  let text = input;

  text = text.replace(FENCED_CODE_RE, (match) => {
    codeBlocks.push(match);
    return `${CODE_PH_OPEN}${codeBlocks.length - 1}${CODE_PH_CLOSE}`;
  });

  text = text.replace(INLINE_CODE_RE, (match) => {
    inlineCodes.push(match);
    return `${INLINE_PH_OPEN}${inlineCodes.length - 1}${INLINE_PH_CLOSE}`;
  });

  text = text.replace(PIPE_TABLE_RE, (match) => {
    const wrapped = '```\n' + match.trim() + '\n```';
    codeBlocks.push(wrapped);
    return `${CODE_PH_OPEN}${codeBlocks.length - 1}${CODE_PH_CLOSE}`;
  });

  text = text.replace(HORIZONTAL_RULE_RE, '');

  text = text.replace(ATX_HEADING_RE, '**$1**');

  text = text.replace(BLANK_LINE_COLLAPSE_RE, '\n\n');

  text = text.replace(INLINE_PH_RESTORE_RE, (_, i) => inlineCodes[Number(i)] ?? '');
  text = text.replace(CODE_PH_RESTORE_RE, (_, i) => codeBlocks[Number(i)] ?? '');

  return text.replace(TRAILING_WS_RE, '').trimEnd();
}

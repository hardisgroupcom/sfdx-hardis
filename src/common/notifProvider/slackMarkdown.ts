const BOLD_SENTINEL_OPEN = '';
const BOLD_SENTINEL_CLOSE = '';
const CODE_PH_OPEN = 'CODE';
const CODE_PH_CLOSE = '';
const INLINE_PH_OPEN = 'INLINE';
const INLINE_PH_CLOSE = '';

const ATX_HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm;
const BOLD_ASTERISK_RE = /\*\*([^\n*]+?)\*\*/g;
const BOLD_UNDERSCORE_RE = /__([^\n_]+?)__/g;
const ITALIC_ASTERISK_RE = /(?<![*\w])\*([^*\n]+?)\*(?![*\w])/g;
const ITALIC_UNDERSCORE_RE = /(?<![_\w])_([^_\n]+?)_(?![_\w])/g;
const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const STRIKETHROUGH_RE = /~~([^~\n]+?)~~/g;
const HORIZONTAL_RULE_RE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm;
const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const PIPE_TABLE_RE =
  /^[ \t]*\|[^\n]*\|[ \t]*\n[ \t]*\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*(?:\n[ \t]*\|[^\n]*\|[ \t]*)*/gm;
const BLANK_LINE_COLLAPSE_RE = /\n{3,}/g;
const TRAILING_WS_RE = /[ \t]+$/gm;

const BOLD_SENTINEL_RESTORE_RE = new RegExp(`${BOLD_SENTINEL_OPEN}([^\\n]+?)${BOLD_SENTINEL_CLOSE}`, 'g');
const INLINE_PH_RESTORE_RE = new RegExp(`${INLINE_PH_OPEN}(\\d+)${INLINE_PH_CLOSE}`, 'g');
const CODE_PH_RESTORE_RE = new RegExp(`${CODE_PH_OPEN}(\\d+)${CODE_PH_CLOSE}`, 'g');

/**
 * Convert CommonMark / GitHub-flavored Markdown to Slack's `mrkdwn` dialect.
 *
 * Slack's mrkdwn differs from standard Markdown: no `#` headings, single-asterisk
 * bold (`*bold*`), underscore italic (`_italic_`), no tables, no horizontal rules,
 * and links written as `<url|label>`.
 *
 * The converter performs targeted regex passes rather than full Markdown parsing,
 * which is sufficient for the constructs emitted by AI prompts and existing call
 * sites. Code blocks (fenced and inline) are extracted up-front so their contents
 * are never altered. Markdown tables are wrapped in code fences so columns stay
 * aligned in Slack's monospace renderer.
 */
export function convertMarkdownToSlackMrkdwn(input: string): string {
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

  // Headings convert to a bold sentinel (not directly to *Foo*) so the italic pass
  // below does not mistake the surrounding asterisks for italic delimiters.
  text = text.replace(ATX_HEADING_RE, `${BOLD_SENTINEL_OPEN}$1${BOLD_SENTINEL_CLOSE}`);

  // Italic runs before bold so that a `*italic*` nested inside `**bold**` is converted
  // first. Otherwise the inner asterisks prevent the bold regex from matching the outer pair.
  // `**foo**` cannot be matched as italic because the italic regex forbids `*` adjacent to `*`.
  text = text.replace(ITALIC_ASTERISK_RE, '_$1_');
  text = text.replace(ITALIC_UNDERSCORE_RE, '_$1_');

  text = text.replace(BOLD_ASTERISK_RE, `${BOLD_SENTINEL_OPEN}$1${BOLD_SENTINEL_CLOSE}`);
  text = text.replace(BOLD_UNDERSCORE_RE, `${BOLD_SENTINEL_OPEN}$1${BOLD_SENTINEL_CLOSE}`);

  text = text.replace(BOLD_SENTINEL_RESTORE_RE, '*$1*');

  text = text.replace(LINK_RE, '<$2|$1>');

  text = text.replace(STRIKETHROUGH_RE, '~$1~');

  text = text.replace(BLANK_LINE_COLLAPSE_RE, '\n\n');

  text = text.replace(INLINE_PH_RESTORE_RE, (_, i) => inlineCodes[Number(i)] ?? '');
  text = text.replace(CODE_PH_RESTORE_RE, (_, i) => codeBlocks[Number(i)] ?? '');

  return text.replace(TRAILING_WS_RE, '').trimEnd();
}

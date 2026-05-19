import {
  createPlaceholderState,
  finalizeMarkdown,
  preprocessMarkdown,
} from "./markdownConverterCommon.js";

// Private Use Area sentinels chosen so they cannot appear in real text or markdown.
const BOLD_SENTINEL_OPEN = '\u{E000}';
const BOLD_SENTINEL_CLOSE = '\u{E001}';

const ATX_HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm;
const BOLD_ASTERISK_RE = /\*\*([^\n*]+?)\*\*/g;
const BOLD_UNDERSCORE_RE = /__([^\n_]+?)__/g;
const ITALIC_ASTERISK_RE = /(?<![*\w])\*([^*\n]+?)\*(?![*\w])/g;
const ITALIC_UNDERSCORE_RE = /(?<![_\w])_([^_\n]+?)_(?![_\w])/g;
const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const STRIKETHROUGH_RE = /~~([^~\n]+?)~~/g;

const BOLD_SENTINEL_RESTORE_RE = new RegExp(`${BOLD_SENTINEL_OPEN}([^\\n]+?)${BOLD_SENTINEL_CLOSE}`, 'g');

/**
 * Convert CommonMark / GitHub-flavored Markdown to Slack's `mrkdwn` dialect.
 *
 * Slack's mrkdwn differs from standard Markdown: no `#` headings, single-asterisk
 * bold (`*bold*`), underscore italic (`_italic_`), no tables, no horizontal rules,
 * and links written as `<url|label>`.
 */
export function convertMarkdownToSlackMrkdwn(input: string): string {
  if (!input) {
    return input;
  }

  const state = createPlaceholderState();
  let text = preprocessMarkdown(input, state);

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

  return finalizeMarkdown(text, state);
}

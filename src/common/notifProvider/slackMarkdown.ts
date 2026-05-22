import type { Block, RawTextElement, SectionBlock, TableBlock } from "@slack/web-api";
import {
  createPlaceholderState,
  finalizeMarkdown,
  preprocessMarkdown,
} from "./markdownConverterCommon.js";

// Private Use Area sentinels chosen so they cannot appear in real text or markdown.
const BOLD_SENTINEL_OPEN = '\u{E000}';
const BOLD_SENTINEL_CLOSE = '\u{E001}';
const FENCE_PH_OPEN = '\u{E020}FENCE';
const FENCE_PH_CLOSE = '\u{E021}';

const FENCED_CODE_RE = /```[\s\S]*?```/g;
const PIPE_TABLE_RE =
  /^[ \t]*\|[^\n]*\|[ \t]*\n[ \t]*\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*(?:\n[ \t]*\|[^\n]*\|[ \t]*)*/gm;
const FENCE_PH_RESTORE_RE = new RegExp(`${FENCE_PH_OPEN}(\\d+)${FENCE_PH_CLOSE}`, 'g');

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

/**
 * Convert CommonMark / GitHub-flavored Markdown into a sequence of Slack Block Kit
 * blocks. Pipe tables become native `table` blocks (so columns render aligned in
 * Slack's UI); everything else flows through `convertMarkdownToSlackMrkdwn` and is
 * emitted as `section` blocks with mrkdwn text.
 *
 * Tables that already live inside a fenced code block are left as code -- they were
 * explicitly fenced by the author and should keep that formatting.
 */
export function convertMarkdownToSlackBlocks(input: string): Block[] {
  if (!input) {
    return [];
  }

  // Mask fenced code blocks so the pipe-table regex below cannot reach into them.
  const codeBlocks: string[] = [];
  const masked = input.replace(FENCED_CODE_RE, (match) => {
    codeBlocks.push(match);
    return `${FENCE_PH_OPEN}${codeBlocks.length - 1}${FENCE_PH_CLOSE}`;
  });

  const restoreFences = (s: string): string =>
    s.replace(FENCE_PH_RESTORE_RE, (_, i) => codeBlocks[Number(i)] ?? '');

  const blocks: Block[] = [];
  const pushTextSection = (segment: string): void => {
    const restored = restoreFences(segment);
    const converted = convertMarkdownToSlackMrkdwn(restored).trim();
    if (converted.length === 0) {
      return;
    }
    const sectionBlock: SectionBlock = {
      type: 'section',
      text: { type: 'mrkdwn', text: converted },
    };
    blocks.push(sectionBlock);
  };

  let lastIndex = 0;
  // Reset the regex's `lastIndex` since it is declared at module scope with the `g` flag.
  PIPE_TABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PIPE_TABLE_RE.exec(masked)) !== null) {
    if (match.index > lastIndex) {
      pushTextSection(masked.substring(lastIndex, match.index));
    }
    blocks.push(buildTableBlock(match[0]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < masked.length) {
    pushTextSection(masked.substring(lastIndex));
  }

  return blocks;
}

function buildTableBlock(tableMd: string): TableBlock {
  const lines = tableMd
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const parseRow = (line: string): RawTextElement[] => {
    let t = line;
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|')) t = t.slice(0, -1);
    return t.split('|').map((cell) => ({ type: 'raw_text', text: cell.trim() }));
  };

  // The first line is the header, the second is the `|---|---|` separator (skipped).
  const headerRow = parseRow(lines[0]);
  const dataRows = lines.slice(2).map(parseRow);
  return { type: 'table', rows: [headerRow, ...dataRows] };
}

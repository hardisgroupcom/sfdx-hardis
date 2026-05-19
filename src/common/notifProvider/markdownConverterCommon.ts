// Shared primitives for the markdown -> channel-dialect converters
// (slackMarkdown.ts, teamsMarkdown.ts). The Private Use Area sentinels are chosen
// so they cannot appear in real text or markdown.
const CODE_PH_OPEN = '\u{E002}CODE';
const CODE_PH_CLOSE = '\u{E003}';
const INLINE_PH_OPEN = '\u{E004}INLINE';
const INLINE_PH_CLOSE = '\u{E005}';

const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const PIPE_TABLE_RE =
  /^[ \t]*\|[^\n]*\|[ \t]*\n[ \t]*\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*(?:\n[ \t]*\|[^\n]*\|[ \t]*)*/gm;
const HORIZONTAL_RULE_RE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm;
const BLANK_LINE_COLLAPSE_RE = /\n{3,}/g;
const TRAILING_WS_RE = /[ \t]+$/gm;

const INLINE_PH_RESTORE_RE = new RegExp(`${INLINE_PH_OPEN}(\\d+)${INLINE_PH_CLOSE}`, 'g');
const CODE_PH_RESTORE_RE = new RegExp(`${CODE_PH_OPEN}(\\d+)${CODE_PH_CLOSE}`, 'g');

export interface PlaceholderState {
  codeBlocks: string[];
  inlineCodes: string[];
}

export function createPlaceholderState(): PlaceholderState {
  return { codeBlocks: [], inlineCodes: [] };
}

/**
 * Run the channel-agnostic pre-processing: extract fenced code blocks and inline
 * code (so they survive inline-formatting passes verbatim), wrap pipe tables in a
 * triple-backtick fence (so columns stay aligned in monospace renderers), and
 * strip horizontal rules (Slack and Teams render them as literal text).
 */
export function preprocessMarkdown(input: string, state: PlaceholderState): string {
  let text = input;

  text = text.replace(FENCED_CODE_RE, (match) => {
    state.codeBlocks.push(match);
    return `${CODE_PH_OPEN}${state.codeBlocks.length - 1}${CODE_PH_CLOSE}`;
  });

  text = text.replace(INLINE_CODE_RE, (match) => {
    state.inlineCodes.push(match);
    return `${INLINE_PH_OPEN}${state.inlineCodes.length - 1}${INLINE_PH_CLOSE}`;
  });

  text = text.replace(PIPE_TABLE_RE, (match) => {
    const wrapped = '```\n' + match.trim() + '\n```';
    state.codeBlocks.push(wrapped);
    return `${CODE_PH_OPEN}${state.codeBlocks.length - 1}${CODE_PH_CLOSE}`;
  });

  text = text.replace(HORIZONTAL_RULE_RE, '');

  return text;
}

/**
 * Collapse three-or-more consecutive newlines to a blank-line pair, restore the
 * protected inline-code and fenced-code-block placeholders, strip trailing
 * whitespace, and trim trailing newlines.
 */
export function finalizeMarkdown(input: string, state: PlaceholderState): string {
  let text = input;
  text = text.replace(BLANK_LINE_COLLAPSE_RE, '\n\n');
  text = text.replace(INLINE_PH_RESTORE_RE, (_, i) => state.inlineCodes[Number(i)] ?? '');
  text = text.replace(CODE_PH_RESTORE_RE, (_, i) => state.codeBlocks[Number(i)] ?? '');
  return text.replace(TRAILING_WS_RE, '').trimEnd();
}

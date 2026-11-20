import {
  createPlaceholderState,
  finalizeMarkdown,
  preprocessMarkdown,
} from "./markdownConverterCommon.js";

const ATX_HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm;

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

  const state = createPlaceholderState();
  let text = preprocessMarkdown(input, state);

  text = text.replace(ATX_HEADING_RE, '**$1**');

  return finalizeMarkdown(text, state);
}

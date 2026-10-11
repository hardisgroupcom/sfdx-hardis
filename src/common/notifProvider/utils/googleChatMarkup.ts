import {
  createPlaceholderState,
  finalizeMarkdown,
  preprocessMarkdown,
} from "./markdownConverterCommon.js";

const ATX_HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm;
const STRIKETHROUGH_RE = /~~([^~\n]+?)~~/g;

/**
 * Convert CommonMark / GitHub-flavored Markdown to the Markdown subset accepted by
 * Google Chat Card v2 `textParagraph` widgets when `textSyntax: "MARKDOWN"` is set.
 *
 * Card v2 MARKDOWN supports `**bold**`, `*italic*`, `~strike~` (single tilde),
 * `` `code` ``, fenced code blocks, `[label](url)` links, and bulleted/ordered lists.
 * It does not support ATX headings or pipe tables. Headings collapse to bold lines,
 * pipe tables are wrapped in a triple-backtick fence (so columns stay aligned in
 * the monospace block), horizontal rules are stripped, and `~~strike~~` is
 * normalized to the single-tilde form Chat expects.
 */
export function convertMarkdownToGoogleChatMarkup(input: string): string {
  if (!input) {
    return input;
  }

  const state = createPlaceholderState();
  let text = preprocessMarkdown(input, state);

  text = text.replace(ATX_HEADING_RE, '**$1**');

  text = text.replace(STRIKETHROUGH_RE, '~$1~');

  return finalizeMarkdown(text, state);
}

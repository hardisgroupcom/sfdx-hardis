import { removeMarkdown } from "../utils/notifUtils.js";

/**
 * Convert CommonMark / GitHub-flavored Markdown to plain text.
 *
 * Used by `ApiProvider` for log payload title and body, and available for any
 * other path that needs a human-readable string with no formatting markers.
 * Headings, bold/italic markers, link syntax, list bullets, fenced code blocks,
 * tables, and horizontal rules are stripped; link labels are kept while URLs
 * are dropped.
 */
export function convertMarkdownToPlainText(input: string): string {
  if (!input) {
    return input;
  }
  return removeMarkdown(input, {
    listUnicodeChar: false,
    stripListLeaders: true,
    gfm: true,
    useImgAltText: true,
    preserveLinks: false,
  });
}

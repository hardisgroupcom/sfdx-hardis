import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";

/**
 * Convert CommonMark / GitHub-flavored Markdown to sanitized HTML.
 *
 * Used by `EmailProvider` for the email body and by `AzureBoardsProvider` for
 * Work Item comments (Azure Boards accepts HTML in the `text` field). Output
 * is passed through DOMPurify so any HTML in the source is stripped of
 * script tags, event handlers, and other XSS vectors before being sent
 * outbound.
 */
export async function convertMarkdownToHtml(input: string): Promise<string> {
  if (!input) {
    return input;
  }
  const html = await marked.parse(input, { gfm: true, breaks: false });
  return DOMPurify.sanitize(html);
}

import sanitizeHtml from "sanitize-html";
import { marked } from "marked";

/**
 * Convert CommonMark / GitHub-flavored Markdown to sanitized HTML.
 *
 * Used by `EmailProvider` for the email body and by `AzureBoardsProvider` for
 * Work Item comments (Azure Boards accepts HTML in the `text` field). Output
 * is passed through sanitize-html so any HTML in the source is stripped of
 * script tags, event handlers, and other XSS vectors before being sent
 * outbound.
 */
export async function convertMarkdownToHtml(input: string): Promise<string> {
  if (!input) {
    return input;
  }
  const html = await marked.parse(input, { gfm: true, breaks: false });
  return sanitizeHtml(html, {
    // Defaults plus the tags emitted by marked with GFM (images, task lists, details)
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "del", "input", "details", "summary", "h1", "h2"]),
    allowedAttributes: {
      a: ["href", "title", "name", "target"],
      img: ["src", "alt", "title", "width", "height"],
      // input is only allowed for GFM task-list checkboxes
      input: [{ name: "type", values: ["checkbox"] }, "checked", "disabled"],
      td: ["align"],
      th: ["align"],
    },
    allowedSchemes: ["http", "https", "mailto"],
  });
}

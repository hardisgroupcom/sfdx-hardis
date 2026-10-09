#!/usr/bin/env node
/*
 * Bitbucket Cloud comments as sfdx-hardis reads them. The CLI hides its markers there in links with
 * no text, `[](#hardis:<encoded>)` (src/common/gitProvider/utilsBitbucketMarkup.ts), because
 * Bitbucket displays an HTML comment as text. A script that reads the raw content of a comment gets
 * those links: this gives the HTML comments back, as fromBitbucketMarkup does.
 *
 *   ... | node bb-shown.cjs                 stdin: text, stdout: the same with its markers shown
 *   ... | node bb-shown.cjs all             stdin: a page of comments (JSON), stdout: every comment
 *   ... | node bb-shown.cjs ids <needle>    stdin: a page of comments, stdout: ids of those holding <needle>
 *   ... | node bb-shown.cjs raw             stdin: one comment (JSON), stdout: its text
 */
const shown = (text) => String(text || '').replace(/\[\]\(#hardis:([^)\s]*)\)/g, (_match, encoded) => `<!-- ${decodeURIComponent(encoded)} -->`);
const [mode, needle] = process.argv.slice(2);
let input = '';
process.stdin
  .setEncoding('utf8')
  .on('data', (chunk) => (input += chunk))
  .on('end', () => {
    if (!mode) {
      process.stdout.write(shown(input));
      return;
    }
    let data;
    try {
      data = JSON.parse(input);
    } catch {
      process.exit(0);
    }
    const comments = (data.values || []).filter((comment) => !comment.deleted);
    const text = (comment) => shown((comment.content || {}).raw);
    if (mode === 'all') process.stdout.write(comments.map(text).join('\n'));
    else if (mode === 'ids') process.stdout.write(comments.filter((comment) => text(comment).includes(needle)).map((comment) => comment.id).join(' '));
    else if (mode === 'raw') process.stdout.write(text(data));
  });

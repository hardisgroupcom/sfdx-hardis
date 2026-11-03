import { expect } from 'chai';
import { markdownToJiraWiki } from '../../../../src/common/ticketProvider/utils/markdownToTicketFormats.js';

describe('markdownToJiraWiki code', () => {
  it('escapes a {code} or {noformat} inside a code block, so the block cannot end early', () => {
    expect(markdownToJiraWiki('```js\nconst a = "{code}";\n```')).to.equal('{code:js}\nconst a = "\\{code}";\n{code}');
    expect(markdownToJiraWiki('```\n{noformat}\n```')).to.equal('{noformat}\n\\{noformat}\n{noformat}');
  });

  it('escapes the braces of inline code, so the monospace span cannot close early', () => {
    expect(markdownToJiraWiki('`a}}b`')).to.equal('{{a\\}\\}b}}');
    expect(markdownToJiraWiki('`plain`')).to.equal('{{plain}}');
  });
});

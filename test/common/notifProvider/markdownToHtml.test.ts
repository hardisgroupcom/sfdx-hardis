/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { convertMarkdownToHtml } from '../../../src/common/notifProvider/markdownToHtml.js';

describe('convertMarkdownToHtml()', () => {
  it('returns empty string for empty input', async () => {
    expect(await convertMarkdownToHtml('')).to.equal('');
  });

  it('renders bold as <strong>', async () => {
    expect(await convertMarkdownToHtml('**hello**')).to.include('<strong>hello</strong>');
  });

  it('renders italic as <em>', async () => {
    expect(await convertMarkdownToHtml('*italic*')).to.include('<em>italic</em>');
  });

  it('renders a markdown link as <a>', async () => {
    const out = await convertMarkdownToHtml('[label](https://example.com)');
    expect(out).to.include('<a href="https://example.com">label</a>');
  });

  it('renders a heading as <h2>', async () => {
    const out = await convertMarkdownToHtml('## Foo');
    expect(out).to.match(/<h2[^>]*>Foo<\/h2>/);
  });

  it('renders a GFM table as <table>', async () => {
    const input = '| A | B |\n|---|---|\n| 1 | 2 |';
    const out = await convertMarkdownToHtml(input);
    expect(out).to.include('<table>');
    expect(out).to.include('<thead>');
    expect(out).to.include('<tbody>');
  });

  it('strips a <script> tag from the source', async () => {
    const out = await convertMarkdownToHtml('Hello <script>alert(1)</script> world');
    expect(out).to.not.include('<script>');
    expect(out).to.not.include('alert(1)');
  });

  it('strips an onclick attribute from an embedded <a>', async () => {
    const out = await convertMarkdownToHtml('<a href="x" onclick="bad()">x</a>');
    expect(out).to.not.include('onclick');
  });

  it('renders strikethrough as <del>', async () => {
    expect(await convertMarkdownToHtml('~~gone~~')).to.include('<del>gone</del>');
  });

  it('renders a fenced code block as <pre><code>', async () => {
    const out = await convertMarkdownToHtml('```\nfoo bar\n```');
    expect(out).to.include('<pre>');
    expect(out).to.include('<code>');
    expect(out).to.include('foo bar');
  });

  it('renders an unordered list as <ul>', async () => {
    const out = await convertMarkdownToHtml('- one\n- two');
    expect(out).to.include('<ul>');
    expect(out).to.include('<li>one</li>');
    expect(out).to.include('<li>two</li>');
  });

  // Sanitization contract: this HTML is sent outbound (email bodies, Azure Boards
  // comments) and may embed org-controlled text, so XSS vectors must be neutralized
  // whatever sanitizer implementation is used.
  it('strips an onerror handler from an embedded <img>', async () => {
    const out = await convertMarkdownToHtml('<img src="x" onerror="alert(1)">');
    expect(out).to.not.include('onerror');
    expect(out).to.not.include('alert(1)');
  });

  it('neutralizes a javascript: link', async () => {
    const out = await convertMarkdownToHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).to.not.include('javascript:');
  });

  it('strips an <iframe> tag', async () => {
    const out = await convertMarkdownToHtml('before <iframe src="https://evil.example"></iframe> after');
    expect(out).to.not.include('<iframe');
    expect(out).to.include('before');
    expect(out).to.include('after');
  });

  it('strips an onmouseover attribute from an embedded <div>', async () => {
    const out = await convertMarkdownToHtml('<div onmouseover="bad()">content</div>');
    expect(out).to.not.include('onmouseover');
    expect(out).to.include('content');
  });

  it('keeps an https image', async () => {
    const out = await convertMarkdownToHtml('![logo](https://example.com/logo.png)');
    expect(out).to.include('<img');
    expect(out).to.include('src="https://example.com/logo.png"');
  });

  it('keeps http and mailto links', async () => {
    const out = await convertMarkdownToHtml('[site](http://example.com) and [mail](mailto:support@example.com)');
    expect(out).to.include('href="http://example.com"');
    expect(out).to.include('href="mailto:support@example.com"');
  });
});

/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { convertMarkdownToGoogleChatMarkup } from '../../../src/common/notifProvider/googleChatMarkup.js';

describe('convertMarkdownToGoogleChatMarkup()', () => {
  it('returns empty string for empty input', () => {
    expect(convertMarkdownToGoogleChatMarkup('')).to.equal('');
  });

  it('collapses ATX h1 heading to double-asterisk bold', () => {
    expect(convertMarkdownToGoogleChatMarkup('# Foo')).to.equal('**Foo**');
  });

  it('collapses ATX h2 heading to double-asterisk bold', () => {
    expect(convertMarkdownToGoogleChatMarkup('## Foo Bar')).to.equal('**Foo Bar**');
  });

  it('keeps double-asterisk bold unchanged (Card v2 MARKDOWN supports it natively)', () => {
    expect(convertMarkdownToGoogleChatMarkup('**hello**')).to.equal('**hello**');
  });

  it('keeps asterisk italic unchanged', () => {
    expect(convertMarkdownToGoogleChatMarkup('an *italic* word')).to.equal('an *italic* word');
  });

  it('keeps markdown links unchanged', () => {
    expect(convertMarkdownToGoogleChatMarkup('[label](https://x.com)')).to.equal('[label](https://x.com)');
  });

  it('normalizes double-tilde strikethrough to single-tilde', () => {
    expect(convertMarkdownToGoogleChatMarkup('~~struck~~')).to.equal('~struck~');
  });

  it('removes a --- horizontal rule and collapses surrounding blank lines', () => {
    expect(convertMarkdownToGoogleChatMarkup('foo\n\n---\n\nbar')).to.equal('foo\n\nbar');
  });

  it('preserves fenced code block contents verbatim', () => {
    const input = '```\n## not heading\n**still bold**\n```';
    expect(convertMarkdownToGoogleChatMarkup(input)).to.equal(input);
  });

  it('preserves inline code contents verbatim', () => {
    expect(convertMarkdownToGoogleChatMarkup('use `## not heading` here')).to.equal('use `## not heading` here');
  });

  it('preserves unicode emoji', () => {
    const input = '⚠️ Bar';
    expect(convertMarkdownToGoogleChatMarkup(input)).to.equal(input);
  });

  it('wraps a pipe table in a triple-backtick code fence', () => {
    const input = '| A | B |\n|---|---|\n| 1 | 2 |';
    const out = convertMarkdownToGoogleChatMarkup(input);
    expect(out.startsWith('```\n')).to.be.true;
    expect(out.endsWith('\n```')).to.be.true;
    expect(out).to.include('| A | B |');
  });

  it('preserves bullet lists', () => {
    const input = '- one\n- two';
    expect(convertMarkdownToGoogleChatMarkup(input)).to.equal(input);
  });
});

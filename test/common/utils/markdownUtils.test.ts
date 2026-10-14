/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { buildHtmlFromMarkdown, formatMarkdownForMkDocs } from '../../../src/common/utils/markdownUtils.js';

describe('buildHtmlFromMarkdown()', () => {
  it('renders markdown into a standalone HTML document', () => {
    const html = buildHtmlFromMarkdown('# Title\n\nSome **bold** text');
    expect(html).to.include('<!DOCTYPE html>');
    expect(html).to.include('<meta charset="utf-8">');
    expect(html).to.match(/<h1[^>]*>Title<\/h1>/);
    expect(html).to.include('<strong>bold</strong>');
  });

  it('embeds the base stylesheet and the document title', () => {
    const html = buildHtmlFromMarkdown('content', { title: 'my-doc' });
    expect(html).to.include('<title>my-doc</title>');
    expect(html).to.include('font-family: system-ui');
    expect(html).to.include('page-break-after: always');
  });

  it('appends extra CSS after the base styles', () => {
    const extraCss = 'h1 { color: rgb(1, 2, 3); }';
    const html = buildHtmlFromMarkdown('content', { extraCss });
    expect(html).to.include(extraCss);
    expect(html.indexOf('font-family: system-ui')).to.be.lessThan(html.indexOf(extraCss));
  });

  it('renders GFM tables', () => {
    const html = buildHtmlFromMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).to.include('<table>');
    expect(html).to.include('<td>1</td>');
  });

  it('keeps relative image paths untouched for file:// resolution', () => {
    const html = buildHtmlFromMarkdown('![schema](./images/schema.png)');
    expect(html).to.include('src="./images/schema.png"');
  });
});

describe('formatMarkdownForMkDocs()', () => {
  it('adds a blank line before a list following text', () => {
    expect(formatMarkdownForMkDocs('Some line\n- item 1\n- item 2')).to.equal('Some line\n\n- item 1\n\n- item 2');
  });
});

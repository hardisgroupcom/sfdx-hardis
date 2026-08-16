/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { convertMarkdownToPlainText } from '../../../src/common/notifProvider/markdownToPlainText.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../fixtures/slack-markdown');

describe('convertMarkdownToPlainText()', () => {
  it('returns empty string for empty input', () => {
    expect(convertMarkdownToPlainText('')).to.equal('');
  });

  it('strips ATX heading markers', () => {
    expect(convertMarkdownToPlainText('## Foo Bar').trim()).to.equal('Foo Bar');
  });

  it('strips bold markers', () => {
    expect(convertMarkdownToPlainText('**hello**')).to.equal('hello');
  });

  it('strips italic markers', () => {
    expect(convertMarkdownToPlainText('*italic*')).to.equal('italic');
  });

  it('keeps link label but drops the URL', () => {
    expect(convertMarkdownToPlainText('[click here](https://example.com)')).to.equal('click here');
  });

  it('strips bullet list markers', () => {
    expect(convertMarkdownToPlainText('- one\n- two').split('\n').map((l) => l.trim()).join(',')).to.equal(
      'one,two',
    );
  });

  it('preserves unicode emoji', () => {
    const input = '⚠️ Bar';
    expect(convertMarkdownToPlainText(input)).to.equal(input);
  });

  it('preserves Slack-style emoji shortcodes', () => {
    expect(convertMarkdownToPlainText(':warning: Foo').trim()).to.equal(':warning: Foo');
  });

  describe('golden fixture: AI monitoring summary', () => {
    const input = fs.readFileSync(path.join(fixturesDir, 'ai-monitoring-summary.md'), 'utf8');
    const out = convertMarkdownToPlainText(input);

    it('contains no `##` heading markers', () => {
      expect(out).to.not.match(/##/);
    });

    it('contains no `**` bold markers', () => {
      expect(out).to.not.match(/\*\*[^*\n]+\*\*/);
    });

    it('contains no `[label](url)` link markers', () => {
      expect(out).to.not.match(/\[[^\]]+\]\([^)\s]+\)/);
    });

    it('preserves the leading Slack emoji shortcode', () => {
      expect(out).to.include(':information_source:');
    });

    it('keeps the Quick Wins section title text', () => {
      expect(out).to.include('Quick Wins');
    });

    it('keeps key data tokens from the body', () => {
      expect(out).to.include('Flow errors');
      expect(out).to.include('129');
    });
  });
});

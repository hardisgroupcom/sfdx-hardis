/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { convertMarkdownToTeamsMrkdwn } from '../../../src/common/notifProvider/teamsMarkdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../fixtures/slack-markdown');

describe('convertMarkdownToTeamsMrkdwn()', () => {
  it('returns empty string for empty input', () => {
    expect(convertMarkdownToTeamsMrkdwn('')).to.equal('');
  });

  it('converts ATX h1 heading to bold', () => {
    expect(convertMarkdownToTeamsMrkdwn('# Foo')).to.equal('**Foo**');
  });

  it('converts ATX h2 heading to bold', () => {
    expect(convertMarkdownToTeamsMrkdwn('## Foo Bar')).to.equal('**Foo Bar**');
  });

  it('keeps double-asterisk bold unchanged', () => {
    expect(convertMarkdownToTeamsMrkdwn('**hello**')).to.equal('**hello**');
  });

  it('keeps asterisk italic unchanged', () => {
    expect(convertMarkdownToTeamsMrkdwn('an *italic* word')).to.equal('an *italic* word');
  });

  it('keeps markdown links unchanged', () => {
    expect(convertMarkdownToTeamsMrkdwn('[label](https://x.com)')).to.equal('[label](https://x.com)');
  });

  it('keeps strikethrough unchanged', () => {
    expect(convertMarkdownToTeamsMrkdwn('~~struck~~')).to.equal('~~struck~~');
  });

  it('removes a --- horizontal rule and collapses surrounding blank lines', () => {
    expect(convertMarkdownToTeamsMrkdwn('foo\n\n---\n\nbar')).to.equal('foo\n\nbar');
  });

  it('removes a *** horizontal rule', () => {
    expect(convertMarkdownToTeamsMrkdwn('foo\n\n***\n\nbar')).to.equal('foo\n\nbar');
  });

  it('preserves Slack-style emoji shortcodes', () => {
    expect(convertMarkdownToTeamsMrkdwn(':warning: Foo')).to.equal(':warning: Foo');
  });

  it('preserves unicode emoji', () => {
    const input = '⚠️ Bar';
    expect(convertMarkdownToTeamsMrkdwn(input)).to.equal(input);
  });

  it('preserves fenced code block contents verbatim', () => {
    const input = '```\n## not heading\n**still bold**\n```';
    expect(convertMarkdownToTeamsMrkdwn(input)).to.equal(input);
  });

  it('preserves inline code contents verbatim', () => {
    expect(convertMarkdownToTeamsMrkdwn('use `## not heading` here')).to.equal('use `## not heading` here');
  });

  it('wraps a pipe table in a triple-backtick code fence', () => {
    const input = '| A | B |\n|---|---|\n| 1 | 2 |';
    const out = convertMarkdownToTeamsMrkdwn(input);
    expect(out.startsWith('```\n')).to.be.true;
    expect(out.endsWith('\n```')).to.be.true;
    expect(out).to.include('| A | B |');
  });

  describe('golden fixture: AI monitoring summary', () => {
    const input = fs.readFileSync(path.join(fixturesDir, 'ai-monitoring-summary.md'), 'utf8');
    const out = convertMarkdownToTeamsMrkdwn(input);

    it('contains no `##` ATX heading markers', () => {
      expect(out).to.not.match(/^##/m);
    });

    it('contains no standalone `---` horizontal rule', () => {
      expect(out).to.not.match(/^---\s*$/m);
    });

    it('wraps the Metrics Snapshot table in a code fence', () => {
      expect(out).to.match(/```[\s\S]*\| Metric \| Value \| Threshold \|[\s\S]*```/);
    });

    it('preserves Quick Wins heading text as bold', () => {
      expect(out).to.include('**Quick Wins**');
    });

    it('preserves the leading Slack emoji shortcode', () => {
      expect(out).to.include(':information_source:');
    });

    it('keeps existing GFM bold markers from the input', () => {
      expect(out).to.include('**ERROR**');
    });
  });
});

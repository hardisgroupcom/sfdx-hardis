/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  convertMarkdownToSlackBlocks,
  convertMarkdownToSlackMrkdwn,
} from '../../../src/common/notifProvider/slackMarkdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../fixtures/slack-markdown');

describe('convertMarkdownToSlackMrkdwn()', () => {
  it('returns empty string for empty input', () => {
    expect(convertMarkdownToSlackMrkdwn('')).to.equal('');
  });

  it('converts ATX h1 heading to bold', () => {
    expect(convertMarkdownToSlackMrkdwn('# Foo')).to.equal('*Foo*');
  });

  it('converts ATX h2 heading to bold', () => {
    expect(convertMarkdownToSlackMrkdwn('## Foo Bar')).to.equal('*Foo Bar*');
  });

  it('converts ATX h6 heading to bold', () => {
    expect(convertMarkdownToSlackMrkdwn('###### Six')).to.equal('*Six*');
  });

  it('strips trailing # in closed ATX headings', () => {
    expect(convertMarkdownToSlackMrkdwn('## Foo ##')).to.equal('*Foo*');
  });

  it('converts double-asterisk bold to single-asterisk Slack bold', () => {
    expect(convertMarkdownToSlackMrkdwn('**hello**')).to.equal('*hello*');
  });

  it('converts double-underscore bold to single-asterisk Slack bold', () => {
    expect(convertMarkdownToSlackMrkdwn('__hello__')).to.equal('*hello*');
  });

  it('converts asterisk italic to underscore italic', () => {
    expect(convertMarkdownToSlackMrkdwn('an *italic* word')).to.equal('an _italic_ word');
  });

  it('keeps underscore italic as underscore italic', () => {
    expect(convertMarkdownToSlackMrkdwn('an _italic_ word')).to.equal('an _italic_ word');
  });

  it('does not corrupt snake_case identifiers', () => {
    expect(convertMarkdownToSlackMrkdwn('snake_case_var')).to.equal('snake_case_var');
  });

  it('converts markdown links to Slack link syntax', () => {
    expect(convertMarkdownToSlackMrkdwn('[label](https://x.com)')).to.equal('<https://x.com|label>');
  });

  it('converts strikethrough to single tilde', () => {
    expect(convertMarkdownToSlackMrkdwn('~~struck~~')).to.equal('~struck~');
  });

  it('removes a --- horizontal rule and collapses surrounding blank lines', () => {
    expect(convertMarkdownToSlackMrkdwn('foo\n\n---\n\nbar')).to.equal('foo\n\nbar');
  });

  it('removes a *** horizontal rule', () => {
    expect(convertMarkdownToSlackMrkdwn('foo\n\n***\n\nbar')).to.equal('foo\n\nbar');
  });

  it('removes a ___ horizontal rule', () => {
    expect(convertMarkdownToSlackMrkdwn('foo\n\n___\n\nbar')).to.equal('foo\n\nbar');
  });

  it('preserves Slack-style emoji shortcodes', () => {
    expect(convertMarkdownToSlackMrkdwn(':warning: Foo bar')).to.equal(':warning: Foo bar');
  });

  it('preserves unicode emoji', () => {
    // Warning sign + VS16 (the same prefix used by UtilsNotifs.prefixWithSeverityEmoji)
    const input = '⚠️ Bar';
    expect(convertMarkdownToSlackMrkdwn(input)).to.equal(input);
  });

  it('preserves {{varName}} placeholders untouched', () => {
    expect(convertMarkdownToSlackMrkdwn('Hello {{name}}')).to.equal('Hello {{name}}');
  });

  it('preserves fenced code block contents verbatim', () => {
    const input = '```\n**not bold**\n## not heading\n```';
    expect(convertMarkdownToSlackMrkdwn(input)).to.equal(input);
  });

  it('preserves inline code contents verbatim', () => {
    expect(convertMarkdownToSlackMrkdwn('use `**foo**` here')).to.equal('use `**foo**` here');
  });

  it('converts a bullet list item with bold prefix', () => {
    expect(convertMarkdownToSlackMrkdwn('- **Item**: description')).to.equal('- *Item*: description');
  });

  it('converts nested bold containing italic', () => {
    expect(convertMarkdownToSlackMrkdwn('**bold with *italic* inside**')).to.equal(
      '*bold with _italic_ inside*',
    );
  });

  it('wraps a pipe table in a triple-backtick code fence', () => {
    const input = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
    const out = convertMarkdownToSlackMrkdwn(input);
    expect(out.startsWith('```\n')).to.be.true;
    expect(out.endsWith('\n```')).to.be.true;
    expect(out).to.include('| A | B |');
    expect(out).to.include('| 1 | 2 |');
  });

  it('does not double-wrap a pipe table that lives inside an existing code fence', () => {
    const input = '```\n| A | B |\n|---|---|\n| 1 | 2 |\n```';
    expect(convertMarkdownToSlackMrkdwn(input)).to.equal(input);
  });

  it('leaves a Slack-style link `<url|label>` unchanged (regression for pre-formatted text)', () => {
    expect(convertMarkdownToSlackMrkdwn('See <https://x|here>')).to.equal('See <https://x|here>');
  });

  it('converts a pre-formatted Slack bold `*text*` to italic (documented quirk)', () => {
    expect(convertMarkdownToSlackMrkdwn('*already slack*')).to.equal('_already slack_');
  });

  describe('golden fixture: AI monitoring summary', () => {
    const input = fs.readFileSync(path.join(fixturesDir, 'ai-monitoring-summary.md'), 'utf8');
    const out = convertMarkdownToSlackMrkdwn(input);

    it('contains no `##` ATX heading markers', () => {
      expect(out).to.not.match(/^##/m);
    });

    it('contains no `**bold**` markers outside code blocks', () => {
      const withoutFences = out.replace(/```[\s\S]*?```/g, '');
      expect(withoutFences).to.not.match(/\*\*[^*\n]+\*\*/);
    });

    it('contains no standalone `---` horizontal rule', () => {
      expect(out).to.not.match(/^---\s*$/m);
    });

    it('contains no `[label](url)` markdown links', () => {
      expect(out).to.not.match(/\[[^\]]+\]\([^)\s]+\)/);
    });

    it('wraps the Metrics Snapshot table in a code fence', () => {
      expect(out).to.match(/```[\s\S]*\| Metric \| Value \| Threshold \|[\s\S]*```/);
    });

    it('preserves the leading Slack emoji shortcode', () => {
      expect(out).to.include(':information_source:');
    });

    it('keeps the Quick Wins section heading text', () => {
      expect(out).to.include('Quick Wins');
    });
  });
});

describe('convertMarkdownToSlackBlocks()', () => {
  it('returns an empty array for empty input', () => {
    expect(convertMarkdownToSlackBlocks('')).to.deep.equal([]);
  });

  it('wraps a single paragraph in one mrkdwn section block', () => {
    const blocks = convertMarkdownToSlackBlocks('hello world');
    expect(blocks).to.have.length(1);
    expect(blocks[0]).to.deep.equal({
      type: 'section',
      text: { type: 'mrkdwn', text: 'hello world' },
    });
  });

  it('emits a native table block for a pipe table', () => {
    const input = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
    const blocks = convertMarkdownToSlackBlocks(input);
    expect(blocks).to.have.length(1);
    expect(blocks[0].type).to.equal('table');
    const table = blocks[0] as any;
    expect(table.rows).to.have.length(3);
    expect(table.rows[0]).to.deep.equal([
      { type: 'raw_text', text: 'A' },
      { type: 'raw_text', text: 'B' },
    ]);
    expect(table.rows[1]).to.deep.equal([
      { type: 'raw_text', text: '1' },
      { type: 'raw_text', text: '2' },
    ]);
    expect(table.rows[2]).to.deep.equal([
      { type: 'raw_text', text: '3' },
      { type: 'raw_text', text: '4' },
    ]);
  });

  it('splits text before and after a table into separate blocks', () => {
    const input = 'before\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nafter';
    const blocks = convertMarkdownToSlackBlocks(input);
    expect(blocks).to.have.length(3);
    expect(blocks[0].type).to.equal('section');
    expect(blocks[1].type).to.equal('table');
    expect(blocks[2].type).to.equal('section');
    expect((blocks[0] as any).text.text).to.equal('before');
    expect((blocks[2] as any).text.text).to.equal('after');
  });

  it('does not extract a table that lives inside a fenced code block', () => {
    const input = '```\n| A | B |\n|---|---|\n| 1 | 2 |\n```';
    const blocks = convertMarkdownToSlackBlocks(input);
    expect(blocks).to.have.length(1);
    expect(blocks[0].type).to.equal('section');
    expect((blocks[0] as any).text.text).to.include('| A | B |');
  });

  it('converts the AI monitoring summary fixture into mixed section + table blocks', () => {
    const input = fs.readFileSync(path.join(fixturesDir, 'ai-monitoring-summary.md'), 'utf8');
    const blocks = convertMarkdownToSlackBlocks(input);
    const sectionCount = blocks.filter((b) => b.type === 'section').length;
    const tableCount = blocks.filter((b) => b.type === 'table').length;
    expect(sectionCount).to.be.greaterThan(0);
    expect(tableCount).to.equal(1);
    const table = blocks.find((b) => b.type === 'table') as any;
    expect(table.rows[0].map((c: any) => c.text)).to.deep.equal(['Metric', 'Value', 'Threshold']);
  });
});

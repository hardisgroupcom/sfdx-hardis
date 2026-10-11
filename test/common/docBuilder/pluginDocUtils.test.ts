import { strict as assert } from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  GENERATED_PLUGIN_DOC_HEADER,
  buildCommandDocMarkdown,
  buildFlagTableRow,
  buildIndexAndCommandsMarkdown,
  buildRemovedCommandPage,
  formatMarkdownTables,
  getCommandTitle,
  listGeneratedCommandPages,
  sanitizeTableCell,
  selectCommands,
} from '../../../src/common/docBuilder/pluginDocUtils.js';

const COMMAND_IDS = [
  'hardis:org:monitor:backup',
  'hardis:project:action:create',
  'hardis:project:action:run',
  'hardis:project:deploy:sources:dx',
  'hardis:work:save',
];

describe('plugin doc: command selection', () => {
  it('selects an exact id', () => {
    assert.deepEqual(selectCommands(COMMAND_IDS, ['hardis:work:save']), { selected: ['hardis:work:save'], unmatched: [] });
  });

  it('expands a wildcard, also across colons', () => {
    assert.deepEqual(selectCommands(COMMAND_IDS, ['hardis:project:action:*']).selected, [
      'hardis:project:action:create',
      'hardis:project:action:run',
    ]);
    assert.deepEqual(selectCommands(COMMAND_IDS, ['hardis:*:deploy:*']).selected, ['hardis:project:deploy:sources:dx']);
  });

  it('reads comma lists, a repeated flag and ids typed with spaces', () => {
    const selection = selectCommands(COMMAND_IDS, ['hardis:work:save, hardis:project:action:run', 'hardis org monitor backup']);
    assert.deepEqual(selection.selected, ['hardis:org:monitor:backup', 'hardis:project:action:run', 'hardis:work:save']);
    assert.deepEqual(selection.unmatched, []);
  });

  it('reports the patterns matching no command, and does not read a dot as a wildcard', () => {
    const selection = selectCommands(COMMAND_IDS, ['hardis:work:sav', 'hardis.work.save', 'hardis:work:save']);
    assert.deepEqual(selection.unmatched, ['hardis:work:sav', 'hardis.work.save']);
    assert.deepEqual(selection.selected, ['hardis:work:save']);
  });
});

describe('plugin doc: table formatting', () => {
  it('pads a table like markdown-table-formatter', () => {
    const compact = [
      '|Name|Type|Description|Default|Required|Options|',
      '|:---|:--:|:----------|:-----:|:------:|:-----:|',
      '|agent|boolean|Run in non-interactive mode for agents and automation||||',
      '|debug<br/>-d|boolean|Activate debug mode (more logs)||||',
    ].join('\n');
    // Taken from a page MegaLinter formatted
    const padded = [
      '| Name         |  Type   | Description                                           | Default | Required | Options |',
      '|:-------------|:-------:|:------------------------------------------------------|:-------:|:--------:|:-------:|',
      '| agent        | boolean | Run in non-interactive mode for agents and automation |         |          |         |',
      '| debug<br/>-d | boolean | Activate debug mode (more logs)                       |         |          |         |',
    ].join('\n');
    assert.equal(formatMarkdownTables(compact), padded);
    assert.equal(formatMarkdownTables(padded), padded);
  });

  it('handles right aligned and unaligned columns', () => {
    const table = ['|A|B|', '|--:|---|', '|long value|x|'].join('\n');
    assert.equal(formatMarkdownTables(table), ['|          A | B |', '|-----------:|---|', '| long value | x |'].join('\n'));
  });

  it('leaves alone a table in a code block and a table with an uneven row', () => {
    const inCodeBlock = ['```', '|a|b|', '|:-|:-|', '|1|2|', '```'].join('\n');
    assert.equal(formatMarkdownTables(inCodeBlock), inCodeBlock);
    const uneven = ['|a|b|', '|:-|:-|', '|1|2|3|'].join('\n');
    assert.equal(formatMarkdownTables(uneven), uneven);
  });

  it('keeps an escaped pipe inside its cell', () => {
    const table = ['|a|b|', '|:-|:-|', '|x\\|y|2|'].join('\n');
    assert.equal(formatMarkdownTables(table), ['| a    | b |', '|:-----|:--|', '| x\\|y | 2 |'].join('\n'));
  });
});

describe('plugin doc: flag rows', () => {
  it('escapes pipes and puts a multi-line description on one line', () => {
    assert.equal(sanitizeTableCell('first\nsecond [|opt]'), 'first<br/>second [\\|opt]');
    assert.equal(sanitizeTableCell('already \\| escaped'), 'already \\| escaped');
  });

  it('leaves out a default computed on the machine building the doc', () => {
    const row = buildFlagTableRow({
      name: 'target-org',
      char: 'o',
      type: 'option',
      summary: 'Org to use',
      default: 'someone@example.com',
      noCacheDefault: true,
      required: true,
    });
    assert.equal(row, '|target-org<br/>-o|option|Org to use||true||');
  });

  it('shows a static default, the options once, and nothing for a missing description', () => {
    const row = buildFlagTableRow({ name: 'level', type: 'option', default: 'low', options: ['low', 'LOW', 'high'] });
    assert.equal(row, '|level|option||low||low<br/>high|');
  });
});

describe('plugin doc: pages', () => {
  const command = {
    id: 'hardis:work:save',
    title: 'Save User Story',
    description: '\n## Command Behavior\n\nSaves the work.',
    flags: { debug: { name: 'debug', char: 'd', type: 'boolean', description: 'Debug' } },
    examples: ['$ sf hardis:work:save'],
  };

  it('builds a command page with its header, title and padded parameters', () => {
    const markdown = buildCommandDocMarkdown(command);
    assert.ok(markdown.startsWith(GENERATED_PLUGIN_DOC_HEADER + '\n# hardis:work:save\n'));
    assert.ok(markdown.includes('| debug<br/>-d | boolean | Debug       |         |          |         |'));
    assert.ok(markdown.includes('```shell\n$ sf hardis:work:save\n```'));
  });

  it('takes the title of a command from its title, its summary, then its description', () => {
    assert.equal(getCommandTitle(command), 'Save User Story');
    assert.equal(getCommandTitle({ summary: 'A summary', description: 'Text' }), 'A summary');
    assert.equal(getCommandTitle({ description: '\n## Command Behavior\n\n**Does something.**' }), '**Does something.**');
    assert.equal(getCommandTitle({}), '');
  });

  it('lists the commands with their titles in index.md and commands.md', () => {
    const readme = '# My plugin\n\nIntro\n\n## Commands\n\nold list';
    const { indexMarkdown, commandsMarkdown } = buildIndexAndCommandsMarkdown([command], { name: 'my-plugin' }, readme);
    assert.ok(indexMarkdown.includes('Intro'));
    assert.ok(!indexMarkdown.includes('old list'));
    assert.ok(commandsMarkdown.includes('| [**hardis:work:save**](hardis/work/save.md) | Save User Story |'));
    assert.ok(indexMarkdown.includes('| [**hardis:work:save**](hardis/work/save.md) | Save User Story |'));
  });

  it('builds a removed command page out of the search, linking the list of commands', () => {
    const page = buildRemovedCommandPage('hardis:org:old:thing');
    assert.ok(page.startsWith('---\ntitle: "hardis:org:old:thing"\n'));
    assert.ok(page.includes('search:\n  exclude: true'));
    assert.ok(page.includes('](../../../commands.md)'));
    assert.ok(!page.startsWith(GENERATED_PLUGIN_DOC_HEADER));
  });
});

describe('plugin doc: generated pages on disk', () => {
  let docsRoot: string;

  beforeEach(() => {
    docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-doc-'));
    fs.mkdirSync(path.join(docsRoot, 'hardis', 'work'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(docsRoot, { recursive: true, force: true });
  });

  it('lists the generated command pages only', () => {
    fs.writeFileSync(path.join(docsRoot, 'hardis', 'work', 'save.md'), `${GENERATED_PLUGIN_DOC_HEADER}\n# hardis:work:save\n`);
    // Same header, but not a command page
    fs.writeFileSync(path.join(docsRoot, 'index.md'), `${GENERATED_PLUGIN_DOC_HEADER}\n# my-plugin\n`);
    fs.writeFileSync(path.join(docsRoot, 'hardis', 'work', 'guide.md'), '# hardis:work:guide\n\nWritten by hand\n');
    fs.writeFileSync(path.join(docsRoot, 'hardis', 'work', 'old.md'), buildRemovedCommandPage('hardis:work:old'));
    assert.deepEqual(listGeneratedCommandPages(docsRoot), [
      { commandId: 'hardis:work:save', file: path.join(docsRoot, 'hardis', 'work', 'save.md') },
    ]);
  });

  it('returns nothing when there is no docs folder yet', () => {
    assert.deepEqual(listGeneratedCommandPages(path.join(docsRoot, 'missing')), []);
  });
});

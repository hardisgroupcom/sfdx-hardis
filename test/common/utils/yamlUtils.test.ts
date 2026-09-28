import { expect } from 'chai';
import * as yaml from 'js-yaml';
import { dumpRepositoryYaml } from '../../../src/common/utils/yamlUtils.js';

// Every expected text below is what Prettier leaves unchanged (the same cases as in vscode-sfdx-hardis)
describe('dumpRepositoryYaml()', () => {
  function expectDump(doc: unknown, expected: string) {
    const dumped = dumpRepositoryYaml(doc);
    expect(dumped).to.equal(expected);
    expect(yaml.load(dumped)).to.deep.equal(yaml.load(expected));
  }

  it('quotes with double quotes', () => {
    expectDump(
      { command: '', colon: 'a: b', hash: 'x #y', yes: 'yes', num: '123' },
      'command: ""\ncolon: "a: b"\nhash: "x #y"\n"yes": "yes"\nnum: "123"\n'
    );
  });

  it('uses single quotes for a string holding a double quote', () => {
    expectDump(
      { command: 'sf data query --query "SELECT Id FROM Account" --target-org x # count', quote: '"', both: `'a' "c"` },
      "command: 'sf data query --query \"SELECT Id FROM Account\" --target-org x # count'\n" +
        "quote: '\"'\n" +
        "both: '''a'' \"c\"'\n"
    );
  });

  it('keeps double quotes when the string needs another escape', () => {
    expectDump({ tab: 'a\t"b"' }, 'tab: "a\\t\\"b\\""\n');
  });

  it('leaves plain strings with quotes and apostrophes alone', () => {
    expectDump({ label: `it's "x"`, list: [`x "y"`, "it's"] }, 'label: it\'s "x"\nlist:\n  - x "y"\n  - it\'s\n');
  });

  it('keeps long strings on one line', () => {
    const long = 'word '.repeat(40) + 'end: x';
    expectDump({ long }, `long: "${long}"\n`);
  });

  it('drops trailing spaces in multi-line strings, and leaves block content as is', () => {
    expectDump({ script: 'a "q"  \n\nb \n' }, 'script: |\n  a "q"\n\n  b\n');
  });
});

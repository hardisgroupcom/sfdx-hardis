// The YAML helpers write and read exactly what js-yaml wrote and read before the switch to `yaml`:
// yamlUtils.golden.json was recorded with js-yaml 4.3.2 (dumpRepositoryYaml as it was then,
// yaml.dump with lineWidth -1, yaml.load). A difference here changes the files sfdx-hardis writes
// in the repositories of its users, and the vscode-sfdx-hardis copy of dumpRepositoryYaml still
// writes the js-yaml way: both must keep producing the same bytes.
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dumpRepositoryYaml, dumpYaml, parseYaml } from '../../../src/common/utils/yamlUtils.js';

const golden = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'yamlUtils.golden.json'), 'utf8')
);

// JSON has no dates: the recorded inputs hold one under the "date" key
function revive(input: unknown): unknown {
  return JSON.parse(JSON.stringify(input), (key, value) => (key === 'date' ? new Date(value) : value));
}

function withMarkedDates(value: unknown): string {
  return JSON.stringify(value, function (this: any, key: string, item: unknown) {
    return this[key] instanceof Date ? '__DATE__' + item : item;
  });
}

describe('YAML helpers compared with js-yaml', () => {
  golden.dumpRepositoryYaml.forEach((recorded: { input: unknown; output: string }, index: number) => {
    it(`dumpRepositoryYaml writes what js-yaml wrote (case ${index + 1})`, () => {
      expect(dumpRepositoryYaml(revive(recorded.input))).to.equal(recorded.output);
    });
  });

  golden.dumpLineWidthMinus1.forEach((recorded: { input: unknown; output: string }, index: number) => {
    it(`dumpYaml writes what js-yaml wrote with lineWidth -1 (case ${index + 1})`, () => {
      expect(dumpYaml(revive(recorded.input))).to.equal(recorded.output);
    });
  });

  golden.parse.forEach((recorded: { text: string; error?: boolean; value?: unknown; hasDate?: string }) => {
    it(`parseYaml reads ${JSON.stringify(recorded.text).slice(0, 50)} like js-yaml`, () => {
      if (recorded.error) {
        expect(() => parseYaml(recorded.text)).to.throw();
        return;
      }
      const parsed = parseYaml(recorded.text);
      expect(JSON.parse(JSON.stringify(parsed ?? null))).to.deep.equal(recorded.value);
      expect(withMarkedDates(parsed)).to.equal(recorded.hasDate);
    });
  });

  it('quotes the strings a YAML 1.1 reader would take for a boolean, like mkdocs does', () => {
    expect(dumpYaml({ a: 'yes', b: 'on', c: 'off', d: 'no', e: '12:30' })).to.equal("a: 'yes'\nb: 'on'\nc: 'off'\nd: 'no'\ne: '12:30'\n");
  });

  // The expected texts below are what js-yaml 4.3.2 wrote
  it('quotes a string starting with an indicator, a base 60 number or a binary integer', () => {
    expect(dumpYaml({ a: '--json', b: ':x', c: '=x', d: '2:100', e: '0b101', f: '0b_' })).to.equal(
      "a: '--json'\nb: ':x'\nc: '=x'\nd: '2:100'\ne: '0b101'\nf: 0b_\n"
    );
    expect(dumpRepositoryYaml({ a: '--json', d: '1:99' })).to.equal('a: "--json"\nd: "1:99"\n');
  });

  it('escapes a no-break space, a line separator and a next line like js-yaml', () => {
    expect(dumpYaml({ a: 'a\u00a0b', b: 'a\u2028b', c: 'a\u0085b', d: '\ufeffx' })).to.equal(
      'a: "a\\_b"\nb: "a\\Lb"\nc: "a\\Nb"\nd: "\\uFEFFx"\n'
    );
    expect(dumpRepositoryYaml({ b: 'a\u2028b' })).to.equal('b: "a\\Lb"\n');
  });

  it('keeps a long double-quoted string on one line', () => {
    const value = 'first line of a long text\twith a tab\nsecond line of the same long text';
    expect(dumpYaml({ a: value })).to.equal(`a: "first line of a long text\\twith a tab\\nsecond line of the same long text"\n`);
  });

  // Except " \n": js-yaml wrote a block with an indentation indicator, the yaml library a block that
  // loses the space, so it is double-quoted
  it('keeps the spaces of a line made of spaces only in a block of text', () => {
    const value = 'line1\n   \nline2';
    const dumped = dumpYaml({ a: value, b: [value], c: '\n', d: ' \n' });
    expect(dumped).to.equal('a: |-\n  line1\n     \n  line2\nb:\n  - |-\n    line1\n       \n    line2\nc: |+\n\nd: " \\n"\n');
    expect(parseYaml(dumped)).to.deep.equal({ a: value, b: [value], c: '\n', d: ' \n' });
  });
});

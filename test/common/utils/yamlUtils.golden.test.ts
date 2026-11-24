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
});

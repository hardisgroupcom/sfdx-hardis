/* eslint-disable @typescript-eslint/no-unused-expressions */
// Characterization tests for stringifyCsv: expected strings were captured from the
// historical csv-stringify implementation. Report files (CSV / Excel-tab) are consumed
// by users and downstream tooling, so the output format must stay stable.
import { expect } from 'chai';
import { stringifyCsv } from '../../../src/common/utils/csvUtils.js';

const rows = [
  { name: 'Simple', label: 'Basic value', active: true, count: 3 },
  { name: 'With;semicolon', label: 'Has "quotes" inside', active: false, count: 0 },
  { name: 'With\nnewline', label: 'Accents & spécial', active: true, count: null },
  { name: 'MissingLabel', active: false },
];

describe('stringifyCsv()', () => {
  it('renders objects columns with custom headers, semicolon delimiter', () => {
    const out = stringifyCsv(rows, {
      delimiter: ';',
      columns: [
        { key: 'name', header: 'Name' },
        { key: 'label', header: 'Label' },
        { key: 'active', header: 'Active' },
        { key: 'count', header: 'Count' },
      ],
    });
    expect(out).to.equal(
      'Name;Label;Active;Count\n' +
      'Simple;Basic value;1;3\n' +
      '"With;semicolon";"Has ""quotes"" inside";;0\n' +
      '"With\nnewline";Accents & spécial;1;\n' +
      'MissingLabel;;;\n'
    );
  });

  it('renders string columns with tab delimiter', () => {
    const out = stringifyCsv(rows, { delimiter: '\t', columns: ['name', 'label'] });
    expect(out).to.equal(
      'name\tlabel\n' +
      'Simple\tBasic value\n' +
      'With;semicolon\t"Has ""quotes"" inside"\n' +
      '"With\nnewline"\tAccents & spécial\n' +
      'MissingLabel\t\n'
    );
  });

  it('renders only the header row when rows are empty', () => {
    expect(stringifyCsv([], { delimiter: ';', columns: ['a', 'b'] })).to.equal('a;b\n');
  });

  it('derives columns from the first row when none are provided', () => {
    expect(stringifyCsv([{ b: '2', a: '1' }], { delimiter: ';' })).to.equal('b;a\n2;1\n');
  });
});

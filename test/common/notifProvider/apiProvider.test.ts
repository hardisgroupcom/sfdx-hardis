import { expect } from 'chai';
// Load the provider registry first: importing apiProvider alone hits a circular import
import '../../../src/common/notifProvider/index.js';
import { fitLokiLogData } from '../../../src/common/notifProvider/apiProvider.js';

const bytes = (value: string) => new TextEncoder().encode(value).length;

// One Apex error row with a long stack trace, like the rows that made Loki refuse whole entries
const errorRow = (index: number) => ({ Operation: `Class${index}`, StackTrace: 'x'.repeat(1000) });

describe('fitLokiLogData', () => {
  it('leaves an entry under the limit untouched', () => {
    const data = { _title: 'ok', _logBodyText: 'text', _logElements: [errorRow(1)] };
    const result = fitLokiLogData(data, 200000, 500);
    expect(result.json).to.equal(JSON.stringify(data));
    expect(result.finalBytes).to.equal(result.initialBytes);
    expect(result.logElementsKept).to.equal(1);
  });

  it('keeps shrinking the rows when 500 rows are still too big', () => {
    const data = { _title: 'Apex errors', _logBodyText: 'short', _logElements: Array.from({ length: 2862 }, (_, i) => errorRow(i)) };
    const result = fitLokiLogData(data, 200000, 500);
    expect(result.finalBytes).to.be.at.most(200000);
    const fitted = JSON.parse(result.json);
    expect(fitted._logElementsTruncated).to.equal(true);
    expect(fitted._logElementsTotal).to.equal(2862);
    expect(fitted._logElements.length).to.equal(result.logElementsKept);
    expect(result.logElementsKept).to.be.greaterThan(0).and.lessThan(500);
  });

  it('cuts the text before dropping rows', () => {
    const data = { _title: 't', _logBodyText: 'y'.repeat(150000), _logElements: Array.from({ length: 100 }, (_, i) => errorRow(i)) };
    const result = fitLokiLogData(data, 200000, 500);
    const fitted = JSON.parse(result.json);
    expect(result.logElementsKept).to.equal(100);
    expect(fitted._logElementsTruncated).to.equal(undefined);
    expect(fitted._logBodyText).to.include('(truncated)');
    expect(bytes(result.json)).to.be.at.most(200000);
  });

  it('never modifies the data it receives', () => {
    const rows = Array.from({ length: 800 }, (_, i) => errorRow(i));
    const data = { _logBodyText: 'z'.repeat(1000), _logElements: rows };
    fitLokiLogData(data, 50000, 500);
    expect(data._logElements).to.equal(rows);
    expect(data._logElements.length).to.equal(800);
    expect(data._logBodyText.length).to.equal(1000);
  });
});

import { expect } from 'chai';
import { sortArray } from '../../../src/common/utils/sortArray.js';

describe('sortArray', () => {
  it('sorts by a single string key ascending by default', () => {
    const rows = [{ name: 'b' }, { name: 'c' }, { name: 'a' }];
    const result = sortArray(rows, { by: 'name' });
    expect(result.map((r) => r.name)).to.deep.equal(['a', 'b', 'c']);
    // sorts in place and returns the same array
    expect(result).to.equal(rows);
  });

  it('sorts descending when order is desc', () => {
    const rows = [{ total: 2 }, { total: 10 }, { total: 5 }];
    sortArray(rows, { by: 'total', order: 'desc' });
    expect(rows.map((r) => r.total)).to.deep.equal([10, 5, 2]);
  });

  it('compares numbers numerically, not as strings', () => {
    const rows = [{ n: 10 }, { n: 9 }, { n: 100 }];
    sortArray(rows, { by: ['n'], order: ['asc'] });
    expect(rows.map((r) => r.n)).to.deep.equal([9, 10, 100]);
  });

  it('sorts by several keys with one order per key', () => {
    const rows = [
      { level: 1, name: 'b' },
      { level: 2, name: 'a' },
      { level: 1, name: 'a' },
      { level: 2, name: 'c' },
    ];
    sortArray(rows, { by: ['level', 'name'], order: ['desc', 'asc'] });
    expect(rows).to.deep.equal([
      { level: 2, name: 'a' },
      { level: 2, name: 'c' },
      { level: 1, name: 'a' },
      { level: 1, name: 'b' },
    ]);
  });

  it('applies a single order string to every key', () => {
    const rows = [
      { a: 1, b: 1 },
      { a: 2, b: 2 },
      { a: 2, b: 1 },
    ];
    sortArray(rows, { by: ['a', 'b'], order: 'desc' });
    expect(rows).to.deep.equal([
      { a: 2, b: 2 },
      { a: 2, b: 1 },
      { a: 1, b: 1 },
    ]);
  });

  it('keeps null and undefined values last in both orders', () => {
    const rowsAsc: any[] = [{ v: null }, { v: 'b' }, {}, { v: 'a' }];
    sortArray(rowsAsc, { by: 'v', order: 'asc' });
    expect(rowsAsc.map((r) => r.v)).to.deep.equal(['a', 'b', null, undefined]);
    const rowsDesc: any[] = [{ v: null }, { v: 'b' }, {}, { v: 'a' }];
    sortArray(rowsDesc, { by: 'v', order: 'desc' });
    expect(rowsDesc.map((r) => r.v)).to.deep.equal(['b', 'a', null, undefined]);
  });

  it('is stable for equal keys', () => {
    const rows = [
      { k: 1, id: 'first' },
      { k: 0, id: 'x' },
      { k: 1, id: 'second' },
      { k: 1, id: 'third' },
    ];
    sortArray(rows, { by: 'k' });
    expect(rows.map((r) => r.id)).to.deep.equal(['x', 'first', 'second', 'third']);
  });

  it('sorts date strings lexicographically like sort-array did', () => {
    const rows = [{ d: '2024-05-01T10:00:00Z' }, { d: '2025-01-01T00:00:00Z' }, { d: '2023-12-31T23:59:59Z' }];
    sortArray(rows, { by: ['d'], order: ['desc'] });
    expect(rows.map((r) => r.d.slice(0, 4))).to.deep.equal(['2025', '2024', '2023']);
  });

  it('ranks values by a custom order, unknown values last', () => {
    const rows = [
      { severity: 'info', name: 'b' },
      { severity: 'unknown', name: 'z' },
      { severity: 'critical', name: 'c' },
      { severity: 'info', name: 'a' },
      { severity: 'warning', name: 'd' },
    ];
    sortArray(rows, {
      by: ['severity', 'name'],
      order: ['severity', 'asc'],
      customOrders: { severity: ['critical', 'error', 'warning', 'info'] },
    });
    expect(rows.map((r) => `${r.severity}:${r.name}`)).to.deep.equal([
      'critical:c',
      'warning:d',
      'info:a',
      'info:b',
      'unknown:z',
    ]);
  });

  it('returns the array untouched without by option', () => {
    const rows = [{ a: 2 }, { a: 1 }];
    expect(sortArray(rows, {})).to.deep.equal([{ a: 2 }, { a: 1 }]);
    expect(sortArray(rows)).to.deep.equal([{ a: 2 }, { a: 1 }]);
  });
});

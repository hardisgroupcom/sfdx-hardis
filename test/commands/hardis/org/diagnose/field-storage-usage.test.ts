import { expect } from 'chai';
import { estimateStorageBytes } from '../../../../../src/commands/hardis/org/diagnose/field-storage-usage.js';

describe('field storage usage helpers', () => {
  it('estimates text storage using average length', () => {
    const bytes = estimateStorageBytes('string', 10, 5);
    expect(bytes).to.equal(100);
  });

  it('estimates numeric storage with default byte size', () => {
    const bytes = estimateStorageBytes('double', 3, 0);
    expect(bytes).to.equal(24);
  });

  it('estimates reference storage using Id length heuristic', () => {
    const bytes = estimateStorageBytes('reference', 2, 0);
    expect(bytes).to.equal(72);
  });
});

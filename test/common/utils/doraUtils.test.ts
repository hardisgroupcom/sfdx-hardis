import { expect } from 'chai';
import { buildWeekLabels, groupByWeek, weekKey } from '../../../src/common/utils/doraUtils.js';

describe('doraUtils weeks', () => {
  it('numbers weeks the ISO way, Monday first', () => {
    expect(weekKey(new Date(2026, 8, 14))).to.equal('2026-W38'); // Monday
    expect(weekKey(new Date(2026, 8, 20))).to.equal('2026-W38'); // Sunday
    expect(weekKey(new Date(2026, 8, 13))).to.equal('2026-W37');
    expect(weekKey(new Date(2027, 0, 1))).to.equal('2026-W53'); // a Friday, still in the last week of 2026
    expect(weekKey(new Date(2025, 11, 29))).to.equal('2026-W01');
  });

  it('always labels the current week, whatever day the period starts on', () => {
    for (let day = 14; day <= 20; day++) {
      const now = new Date(2026, 8, day, 12);
      const labels = buildWeekLabels(90, now);
      expect(labels[labels.length - 1]).to.equal('2026-W38');
      expect(new Set(labels).size).to.equal(labels.length);
    }
  });

  it('counts every deployment of the current week under a label', () => {
    const now = new Date(2026, 8, 19, 20);
    const records: any[] = ['2026-09-16T08:00:00.000+0000', '2026-09-17T08:00:00.000+0000', '2026-09-19T08:00:00.000+0000'].map(
      (date) => ({ CompletedDate: date, CreatedDate: date })
    );
    const byWeek = groupByWeek(records);
    const labels = buildWeekLabels(90, now);
    const counted = labels.reduce((sum, label) => sum + (byWeek.get(label) || 0), 0);
    expect(counted).to.equal(3);
  });
});

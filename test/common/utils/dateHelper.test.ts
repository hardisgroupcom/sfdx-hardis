/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { DateHelper, dateHelper, formatElapsedMs } from '../../../src/common/utils/dateHelper.js';

// Fixed reference date: 2024-03-05T14:07:09.042Z
const REF_DATE = new Date('2024-03-05T14:07:09.042Z');

describe('DateHelper', () => {

  describe('constructor', () => {
    it('creates a valid date from a Date object', () => {
      const dh = new DateHelper(REF_DATE);
      expect(dh.isInvalid()).to.be.false;
    });

    it('creates a valid date from an ISO string', () => {
      const dh = new DateHelper('2024-03-05T14:07:09.042Z');
      expect(dh.isInvalid()).to.be.false;
    });

    it('creates a current date when called with no argument', () => {
      const before = Date.now();
      const dh = new DateHelper();
      const after = Date.now();
      const ts = dh.toDate().getTime();
      expect(ts).to.be.at.least(before);
      expect(ts).to.be.at.most(after);
    });

    it('marks invalid dates as invalid', () => {
      const dh = new DateHelper('not-a-date');
      expect(dh.isInvalid()).to.be.true;
    });

    it('handles null input as current date', () => {
      const before = Date.now();
      const dh = new DateHelper(null);
      const after = Date.now();
      const ts = dh.toDate().getTime();
      expect(ts).to.be.at.least(before);
      expect(ts).to.be.at.most(after);
    });
  });

  describe('dateHelper() shorthand', () => {
    it('is equivalent to new DateHelper()', () => {
      const dh = dateHelper('2024-03-05');
      expect(dh).to.be.instanceOf(DateHelper);
      expect(dh.isInvalid()).to.be.false;
    });
  });

  describe('format()', () => {
    // Use a fixed local date to avoid timezone-dependent results
    const LOCAL_DATE = new Date(2024, 2, 5, 14, 7, 9, 42); // 2024-03-05 14:07:09.042 local

    it('returns ISO 8601 string when called without argument', () => {
      const dh = new DateHelper(REF_DATE);
      const result = dh.format();
      expect(result).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('returns "Invalid date" for invalid input', () => {
      expect(new DateHelper('bad').format('YYYY-MM-DD')).to.equal('Invalid date');
    });

    it('formats YYYY correctly', () => {
      expect(new DateHelper(LOCAL_DATE).format('YYYY')).to.equal('2024');
    });

    it('formats MM correctly', () => {
      expect(new DateHelper(LOCAL_DATE).format('MM')).to.equal('03');
    });

    it('formats DD correctly', () => {
      expect(new DateHelper(LOCAL_DATE).format('DD')).to.equal('05');
    });

    it('formats YYYY-MM-DD correctly', () => {
      expect(new DateHelper(LOCAL_DATE).format('YYYY-MM-DD')).to.equal('2024-03-05');
    });

    it('formats YYYYMMDD_hhmm correctly (filename timestamp)', () => {
      const dh = new DateHelper(LOCAL_DATE);
      expect(dh.format('YYYYMMDD_hhmm')).to.match(/^\d{8}_\d{4}$/);
    });

    it('formats YYYYMMDD-hhmmss correctly (filename timestamp with seconds)', () => {
      const dh = new DateHelper(LOCAL_DATE);
      expect(dh.format('YYYYMMDD-hhmmss')).to.match(/^\d{8}-\d{6}$/);
    });

    it('formats HH (24-hour) correctly', () => {
      expect(new DateHelper(LOCAL_DATE).format('HH')).to.equal('14');
    });

    it('formats hh (12-hour) correctly', () => {
      expect(new DateHelper(LOCAL_DATE).format('hh')).to.equal('02');
    });

    it('formats mm (minutes) correctly', () => {
      expect(new DateHelper(LOCAL_DATE).format('mm')).to.equal('07');
    });

    it('formats ss (seconds) correctly', () => {
      expect(new DateHelper(LOCAL_DATE).format('ss')).to.equal('09');
    });

    it('formats SSS (milliseconds) correctly', () => {
      expect(new DateHelper(LOCAL_DATE).format('SSS')).to.equal('042');
    });

    it('formats YYYY-MM-DD hh:mm correctly', () => {
      const result = new DateHelper(LOCAL_DATE).format('YYYY-MM-DD hh:mm');
      expect(result).to.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('formats "ll" as a human-readable date', () => {
      const result = new DateHelper(LOCAL_DATE).format('ll');
      // Should contain the year 2024
      expect(result).to.include('2024');
      // Should not look like a raw date string
      expect(result).to.not.match(/^\d{4}-\d{2}-\d{2}/);
    });

    it('preserves literal characters in format strings', () => {
      expect(new DateHelper(LOCAL_DATE).format('YYYY/MM/DD')).to.equal('2024/03/05');
    });
  });

  describe('DateHelper.parse()', () => {
    it('parses a date from a simple YYYYMMDD format', () => {
      const dh = DateHelper.parse('20240305', 'YYYYMMDD');
      expect(dh.isInvalid()).to.be.false;
      expect(dh.format('YYYY')).to.equal('2024');
      expect(dh.format('MM')).to.equal('03');
      expect(dh.format('DD')).to.equal('05');
    });

    it('parses a date from a DD/MM/YYYY format', () => {
      const dh = DateHelper.parse('05/03/2024', 'DD/MM/YYYY');
      expect(dh.format('YYYY-MM-DD')).to.equal('2024-03-05');
    });

    it('parses a date from a YYYY-MM-DD format', () => {
      const dh = DateHelper.parse('2024-03-05', 'YYYY-MM-DD');
      expect(dh.format('YYYY-MM-DD')).to.equal('2024-03-05');
    });

    it('reformats a date from one format to another (date transfo use case)', () => {
      const result = DateHelper.parse('20240305', 'YYYYMMDD').format('YYYY-MM-DD');
      expect(result).to.equal('2024-03-05');
    });

    it('reformats from MM/DD/YYYY to YYYY-MM-DD', () => {
      const result = DateHelper.parse('03/05/2024', 'MM/DD/YYYY').format('YYYY-MM-DD');
      expect(result).to.equal('2024-03-05');
    });
  });

  describe('toDate()', () => {
    it('returns a Date object', () => {
      const dh = new DateHelper(REF_DATE);
      expect(dh.toDate()).to.be.instanceOf(Date);
    });

    it('returns a copy, not the same reference', () => {
      const dh = new DateHelper(REF_DATE);
      const d = dh.toDate();
      d.setFullYear(1900);
      expect(dh.toDate().getFullYear()).to.equal(REF_DATE.getFullYear());
    });
  });

  describe('diff()', () => {
    it('returns positive days when this date is after the other', () => {
      const later = dateHelper('2024-03-10');
      const earlier = dateHelper('2024-03-05');
      expect(later.diff(earlier, 'days')).to.equal(5);
    });

    it('returns negative days when this date is before the other', () => {
      const earlier = dateHelper('2024-03-05');
      const later = dateHelper('2024-03-10');
      expect(earlier.diff(later, 'days')).to.equal(-5);
    });

    it('returns 0 for the same date', () => {
      const dh = dateHelper('2024-03-05');
      expect(dh.diff(dateHelper('2024-03-05'), 'days')).to.equal(0);
    });

    it('computes diff in months correctly', () => {
      const later = dateHelper('2024-06-05');
      const earlier = dateHelper('2024-03-05');
      expect(later.diff(earlier, 'months')).to.equal(3);
    });

    it('computes diff in months across year boundary', () => {
      const later = dateHelper('2025-01-05');
      const earlier = dateHelper('2024-11-05');
      expect(later.diff(earlier, 'months')).to.equal(2);
    });

    it('accepts a Date object as the second argument', () => {
      const later = dateHelper('2024-03-10');
      expect(later.diff(new Date('2024-03-05'), 'days')).to.equal(5);
    });

    it('defaults to days when unit is not specified', () => {
      const later = dateHelper('2024-03-10');
      const earlier = dateHelper('2024-03-05');
      expect(later.diff(earlier)).to.equal(5);
    });
  });

  describe('isAfter()', () => {
    it('returns true when this date is after the other', () => {
      expect(dateHelper('2024-03-10').isAfter(dateHelper('2024-03-05'))).to.be.true;
    });

    it('returns false when this date is before the other', () => {
      expect(dateHelper('2024-03-05').isAfter(dateHelper('2024-03-10'))).to.be.false;
    });

    it('returns false for equal dates', () => {
      expect(dateHelper('2024-03-05').isAfter(dateHelper('2024-03-05'))).to.be.false;
    });

    it('compares by day granularity when unit is "day"', () => {
      const d1 = new DateHelper(new Date(2024, 2, 10, 23, 59, 59));
      const d2 = new DateHelper(new Date(2024, 2, 5, 0, 0, 0));
      expect(d1.isAfter(d2, 'day')).to.be.true;
    });

    it('returns false for same day with "day" unit even if times differ', () => {
      const d1 = new DateHelper(new Date(2024, 2, 5, 23, 59));
      const d2 = new DateHelper(new Date(2024, 2, 5, 0, 0));
      expect(d1.isAfter(d2, 'day')).to.be.false;
    });
  });

  describe('isBefore()', () => {
    it('returns true when this date is before the other', () => {
      expect(dateHelper('2024-03-05').isBefore(dateHelper('2024-03-10'))).to.be.true;
    });

    it('returns false when this date is after the other', () => {
      expect(dateHelper('2024-03-10').isBefore(dateHelper('2024-03-05'))).to.be.false;
    });

    it('returns false for equal dates', () => {
      expect(dateHelper('2024-03-05').isBefore(dateHelper('2024-03-05'))).to.be.false;
    });

    it('compares by day granularity when unit is "day"', () => {
      const d1 = new DateHelper(new Date(2024, 2, 5, 0, 0));
      const d2 = new DateHelper(new Date(2024, 2, 10, 23, 59));
      expect(d1.isBefore(d2, 'day')).to.be.true;
    });

    it('returns false for same day with "day" unit', () => {
      const d1 = new DateHelper(new Date(2024, 2, 5, 0, 0));
      const d2 = new DateHelper(new Date(2024, 2, 5, 23, 59));
      expect(d1.isBefore(d2, 'day')).to.be.false;
    });
  });

  describe('isSame()', () => {
    it('returns true for equal timestamps', () => {
      expect(dateHelper('2024-03-05').isSame(dateHelper('2024-03-05'))).to.be.true;
    });

    it('returns false for different timestamps', () => {
      expect(dateHelper('2024-03-05').isSame(dateHelper('2024-03-06'))).to.be.false;
    });

    it('returns true for same day regardless of time with "day" unit', () => {
      const d1 = new DateHelper(new Date(2024, 2, 5, 0, 0));
      const d2 = new DateHelper(new Date(2024, 2, 5, 23, 59));
      expect(d1.isSame(d2, 'day')).to.be.true;
    });

    it('returns false for different days with "day" unit', () => {
      const d1 = new DateHelper(new Date(2024, 2, 5, 23, 59));
      const d2 = new DateHelper(new Date(2024, 2, 6, 0, 0));
      expect(d1.isSame(d2, 'day')).to.be.false;
    });
  });

});

describe('formatElapsedMs()', () => {
  it('formats 0ms as 0:00:00.000', () => {
    expect(formatElapsedMs(0)).to.equal('0:00:00.000');
  });

  it('formats 1 second correctly', () => {
    expect(formatElapsedMs(1000)).to.equal('0:00:01.000');
  });

  it('formats 1 minute correctly', () => {
    expect(formatElapsedMs(60000)).to.equal('0:01:00.000');
  });

  it('formats 1 hour correctly', () => {
    expect(formatElapsedMs(3600000)).to.equal('1:00:00.000');
  });

  it('formats a complex duration correctly', () => {
    // 1h 23min 45s 678ms = 5025678ms
    const ms = 1 * 3600000 + 23 * 60000 + 45 * 1000 + 678;
    expect(formatElapsedMs(ms)).to.equal('1:23:45.678');
  });

  it('formats milliseconds with leading zeros', () => {
    expect(formatElapsedMs(42)).to.equal('0:00:00.042');
  });

  it('formats sub-10ms with double leading zeros', () => {
    expect(formatElapsedMs(5)).to.equal('0:00:00.005');
  });
});

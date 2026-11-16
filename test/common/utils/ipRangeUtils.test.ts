/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { getRangeSize, isIpInRange, isRangeWiderThan, parseIp } from '../../../src/common/utils/ipRangeUtils.js';

describe('ipRangeUtils', () => {
  describe('parseIp()', () => {
    it('parses IPv4 addresses', () => {
      expect(parseIp('10.0.0.1')).to.deep.equal({ version: 4, value: 167772161n });
      expect(parseIp('255.255.255.255')?.value).to.equal(4294967295n);
    });

    it('parses IPv6 addresses, compressed or not', () => {
      expect(parseIp('::1')).to.deep.equal({ version: 6, value: 1n });
      expect(parseIp('2001:db8::')?.value).to.equal(parseIp('2001:0db8:0000:0000:0000:0000:0000:0000')?.value);
      expect(parseIp('fe80::1%eth0')?.value).to.equal(parseIp('fe80::1')?.value);
    });

    it('parses IPv6 addresses ending with an IPv4 address', () => {
      expect(parseIp('::ffff:192.168.0.1')?.value).to.equal(parseIp('::ffff:c0a8:1')?.value);
    });

    it('rejects invalid addresses', () => {
      expect(parseIp('')).to.be.null;
      expect(parseIp('10.0.0')).to.be.null;
      expect(parseIp('10.0.0.256')).to.be.null;
      expect(parseIp('1::2::3')).to.be.null;
      expect(parseIp('1:2:3:4:5:6:7:8:9')).to.be.null;
      expect(parseIp('not an ip')).to.be.null;
    });
  });

  describe('isIpInRange()', () => {
    it('includes both bounds', () => {
      expect(isIpInRange('10.0.0.0', '10.0.0.0', '10.0.0.255')).to.be.true;
      expect(isIpInRange('10.0.0.255', '10.0.0.0', '10.0.0.255')).to.be.true;
      expect(isIpInRange('10.0.1.0', '10.0.0.0', '10.0.0.255')).to.be.false;
    });

    it('never matches across IP families', () => {
      expect(isIpInRange('::1', '0.0.0.0', '255.255.255.255')).to.be.false;
    });

    it('works with IPv6 ranges', () => {
      expect(isIpInRange('2001:db8::5', '2001:db8::', '2001:db8::ffff')).to.be.true;
    });
  });

  describe('isRangeWiderThan()', () => {
    it('tells an IPv4 range wider than /8', () => {
      // Exactly a /8: not wider
      expect(isRangeWiderThan('10.0.0.0', '10.255.255.255', 8, 29)).to.be.false;
      // One address more than a /8
      expect(isRangeWiderThan('10.0.0.0', '11.0.0.0', 8, 29)).to.be.true;
      expect(isRangeWiderThan('0.0.0.0', '255.255.255.255', 8, 29)).to.be.true;
    });

    it('tells an IPv6 range wider than /29', () => {
      expect(isRangeWiderThan('2001:db8::', '2001:dbf:ffff:ffff:ffff:ffff:ffff:ffff', 8, 29)).to.be.false;
      expect(isRangeWiderThan('2001:db8::', '2001:dc0::', 8, 29)).to.be.true;
    });

    it('returns false for an invalid range', () => {
      expect(isRangeWiderThan('10.0.0.5', '10.0.0.1', 8, 29)).to.be.false;
      expect(isRangeWiderThan('10.0.0.1', '::1', 8, 29)).to.be.false;
    });
  });

  describe('getRangeSize()', () => {
    it('counts the addresses of a range', () => {
      expect(getRangeSize('10.0.0.0', '10.0.0.255')).to.equal(256n);
      expect(getRangeSize('10.0.0.1', '10.0.0.1')).to.equal(1n);
      expect(getRangeSize('10.0.0.2', '10.0.0.1')).to.be.null;
    });
  });
});

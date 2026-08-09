/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { extractRegistrableDomain } from '../../../src/common/utils/domainUtils.js';

describe('extractRegistrableDomain()', () => {
  it('extracts the domain of a simple hostname', () => {
    expect(extractRegistrableDomain('api.example.com')).to.equal('example.com');
    expect(extractRegistrableDomain('deep.sub.example.org')).to.equal('example.org');
  });

  it('keeps a bare domain unchanged', () => {
    expect(extractRegistrableDomain('example.com')).to.equal('example.com');
  });

  it('handles common multi-part TLDs', () => {
    expect(extractRegistrableDomain('docs.example.co.uk')).to.equal('example.co.uk');
    expect(extractRegistrableDomain('www.company.com.au')).to.equal('company.com.au');
    expect(extractRegistrableDomain('site.example.co.jp')).to.equal('example.co.jp');
  });

  it('returns IP addresses as-is', () => {
    expect(extractRegistrableDomain('192.168.1.10')).to.equal('192.168.1.10');
    expect(extractRegistrableDomain('::1')).to.equal('::1');
  });

  it('returns single-label hosts as-is', () => {
    expect(extractRegistrableDomain('localhost')).to.equal('localhost');
  });

  it('normalizes case and trailing dot', () => {
    expect(extractRegistrableDomain('API.Example.COM.')).to.equal('example.com');
  });

  it('returns null for empty input', () => {
    expect(extractRegistrableDomain('')).to.be.null;
    expect(extractRegistrableDomain(null)).to.be.null;
    expect(extractRegistrableDomain(undefined)).to.be.null;
  });
});

import { expect } from 'chai';
import { buildConventionalCommitMessage } from '../../../src/common/utils/gitUtils.js';

// Conventional commits header: type(scope)?: subject, max 100 chars, lowercase subject, no trailing period
const HEADER_REGEX = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([\w-]+\))?: [a-z].*[^.\s]$/;

describe('buildConventionalCommitMessage()', () => {
  it('defaults to chore type and sfdx-hardis scope', () => {
    const message = buildConventionalCommitMessage({ subject: 'update package content' });
    expect(message).to.equal('chore(sfdx-hardis): update package content');
    expect(message).to.match(HEADER_REGEX);
  });

  it('lowercases the first character of the subject', () => {
    const message = buildConventionalCommitMessage({ subject: 'Update package content' });
    expect(message).to.equal('chore(sfdx-hardis): update package content');
  });

  it('strips trailing periods from the subject', () => {
    const message = buildConventionalCommitMessage({ subject: 'clean sfdx project.' });
    expect(message).to.equal('chore(sfdx-hardis): clean sfdx project');
  });

  it('collapses newlines and extra spaces in the subject', () => {
    const message = buildConventionalCommitMessage({ subject: 'clean\nsfdx   project' });
    expect(message).to.equal('chore(sfdx-hardis): clean sfdx project');
  });

  it('accepts a custom type without scope', () => {
    const message = buildConventionalCommitMessage({ type: 'fix', scope: null, subject: 'auto-fix deployment errors' });
    expect(message).to.equal('fix: auto-fix deployment errors');
    expect(message).to.match(HEADER_REGEX);
  });

  it('truncates the header to 100 characters with a long subject', () => {
    const longUsername = 'a'.repeat(80) + '@really-long-domain-name.com';
    const message = buildConventionalCommitMessage({ subject: `retrofit changes from ${longUsername}` });
    expect(message.length).to.be.at.most(100);
    expect(message).to.match(HEADER_REGEX);
  });

  it('does not end with a period after truncation', () => {
    // Prefix "chore(sfdx-hardis): " is 20 chars, so char 80 of the subject lands exactly at position 100
    const subject = 'u' + 'x'.repeat(78) + '.' + 'suffix';
    const message = buildConventionalCommitMessage({ subject: subject });
    expect(message.length).to.be.at.most(100);
    expect(message.endsWith('.')).to.be.false;
  });

  it('separates the body from the header with a blank line', () => {
    const message = buildConventionalCommitMessage({ subject: 'update stuff', body: 'Some details' });
    expect(message).to.equal('chore(sfdx-hardis): update stuff\n\nSome details');
  });

  it('wraps body lines at 100 characters', () => {
    const body = 'word '.repeat(60).trim();
    const message = buildConventionalCommitMessage({ subject: 'update stuff', body: body });
    const bodyLines = message.split('\n').slice(2);
    expect(bodyLines.length).to.be.greaterThan(1);
    for (const line of bodyLines) {
      expect(line.length).to.be.at.most(100);
    }
  });

  it('hard-splits body words longer than 100 characters', () => {
    const body = 'See https://example.com/' + 'z'.repeat(150);
    const message = buildConventionalCommitMessage({ subject: 'update stuff', body: body });
    const bodyLines = message.split('\n').slice(2);
    for (const line of bodyLines) {
      expect(line.length).to.be.at.most(100);
    }
  });

  it('keeps existing body line breaks', () => {
    const message = buildConventionalCommitMessage({ subject: 'update stuff', body: 'line one\nline two' });
    expect(message).to.equal('chore(sfdx-hardis): update stuff\n\nline one\nline two');
  });
});

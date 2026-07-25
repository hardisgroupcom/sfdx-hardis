/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import type { NotifMessage } from '../../../src/common/notifProvider/types.js';
import {
  applyMessageSizeGuard,
  clampBlockText,
  SizeGuardLimits,
} from '../../../src/common/notifProvider/messageSizeGuard.js';

const LIMITS: SizeGuardLimits = { maxAttachmentsChars: 200, maxBlockChars: 100, maxBlocks: 10 };

function message(attachments: any[], pullRequestUrl?: string): NotifMessage {
  return {
    text: 'Deployment has been successfully processed',
    type: 'DEPLOYMENT',
    severity: 'success',
    attachments,
    logElements: [],
    metrics: {},
    data: {},
    ...(pullRequestUrl ? { pullRequestUrl } : {}),
  };
}

function rows(title: string, count: number): string {
  return [`**${title}**`, ...Array.from({ length: count }, (_, i) => `- row ${i}`)].join('\n');
}

describe('applyMessageSizeGuard()', () => {
  it('returns the message untouched when there are no attachments', () => {
    const msg = message([]);
    expect(applyMessageSizeGuard(msg, LIMITS)).to.equal(msg);
  });

  it('returns the message untouched when it is under budget', () => {
    const msg = message([{ text: rows('Small', 3) }]);
    expect(applyMessageSizeGuard(msg, LIMITS)).to.equal(msg);
  });

  it('does not mutate the input message', () => {
    const original = rows('Commits', 60);
    const msg = message([{ text: original }]);
    applyMessageSizeGuard(msg, LIMITS);
    expect(msg.attachments?.[0].text).to.equal(original);
  });

  it('truncates the last attachment first, leaving the first intact', () => {
    const first = rows('Deployment Actions', 8);
    const last = rows('Commits', 60);
    const guarded = applyMessageSizeGuard(message([{ text: first }, { text: last }]), LIMITS);
    expect(guarded.attachments?.[0].text).to.equal(first);
    expect(guarded.attachments?.[1].text).to.not.equal(last);
    expect(guarded.attachments?.[1].text.length).to.be.lessThan(last.length);
  });

  it('brings the total under the budget', () => {
    const guarded = applyMessageSizeGuard(
      message([{ text: rows('A', 40) }, { text: rows('B', 40) }]),
      LIMITS
    );
    const total = guarded.attachments!.reduce((sum: number, att: any) => sum + att.text.length, 0);
    expect(total).to.be.at.most(LIMITS.maxAttachmentsChars);
  });

  it('keeps the attachment title on the surviving rows', () => {
    const guarded = applyMessageSizeGuard(message([{ text: rows('Commits', 200) }]), LIMITS);
    expect(guarded.attachments?.[0].text).to.contain('**Commits**');
  });

  it('mentions the Pull Request in the notice when the message has one', () => {
    const guarded = applyMessageSizeGuard(
      message([{ text: rows('Commits', 200) }], 'https://example.com/pr/1'),
      LIMITS
    );
    expect(guarded.attachments?.[0].text).to.contain('Pull Request');
  });

  it('omits the Pull Request mention when the message has none', () => {
    const guarded = applyMessageSizeGuard(message([{ text: rows('Commits', 200) }]), LIMITS);
    expect(guarded.attachments?.[0].text).to.not.contain('Pull Request');
  });

  it('leaves attachments without text alone', () => {
    const guarded = applyMessageSizeGuard(
      message([{ color: '#fff' }, { text: rows('Commits', 60) }]),
      LIMITS
    );
    expect(guarded.attachments?.[0]).to.deep.equal({ color: '#fff' });
  });
});

describe('clampBlockText()', () => {
  it('returns short text unchanged', () => {
    expect(clampBlockText('hello', 100)).to.equal('hello');
  });

  it('returns empty text unchanged', () => {
    expect(clampBlockText('', 100)).to.equal('');
  });

  it('clamps text over the limit', () => {
    const long = 'x'.repeat(500);
    const clamped = clampBlockText(long, 100);
    expect(clamped.length).to.be.at.most(100);
    expect(clamped).to.not.equal(long);
  });
});

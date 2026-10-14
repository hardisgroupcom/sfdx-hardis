import { expect } from 'chai';
import { Writable } from 'stream';
import { createSpinner, Spinner } from '../../../src/common/utils/spinner.js';

function fakeStream(isTTY: boolean): { stream: NodeJS.WriteStream; output: () => string } {
  const chunks: string[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  }) as unknown as NodeJS.WriteStream;
  (writable as any).isTTY = isTTY;
  return { stream: writable, output: () => chunks.join('') };
}

describe('Spinner', () => {
  let previousCi: string | undefined;
  let previousTerm: string | undefined;

  beforeEach(() => {
    previousCi = process.env.CI;
    previousTerm = process.env.TERM;
    delete process.env.CI;
    delete process.env.TERM;
  });

  afterEach(() => {
    if (previousCi === undefined) delete process.env.CI;
    else process.env.CI = previousCi;
    if (previousTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousTerm;
  });

  it('prints plain lines when the stream is not a TTY', () => {
    const { stream, output } = fakeStream(false);
    const spinner = createSpinner({ text: 'Working', stream }).start();
    expect(spinner.isSpinning).to.equal(false);
    spinner.text = 'Still working';
    spinner.succeed('Done');
    const lines = output().split('\n').filter((line) => line.length > 0);
    expect(lines).to.have.length(2);
    expect(lines[0]).to.equal('- Working');
    expect(lines[1]).to.contain('Done');
  });

  it('prints plain lines in CI even on a TTY', () => {
    process.env.CI = 'true';
    const { stream, output } = fakeStream(true);
    const spinner = createSpinner('Working').start();
    expect(spinner.isSpinning).to.equal(false);
    spinner.stop();
    expect(output()).to.equal('');
    const spinner2 = new Spinner({ text: 'Working', stream }).start();
    spinner2.fail();
    expect(output()).to.contain('- Working\n');
    expect(output()).to.contain('Working\n');
  });

  it('animates on a TTY and clears the line on completion', async () => {
    const { stream, output } = fakeStream(true);
    const spinner = createSpinner({ text: 'Loading', stream, interval: 5 }).start();
    expect(spinner.isSpinning).to.equal(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    spinner.text = 'Loading more';
    spinner.succeed('Loaded');
    expect(spinner.isSpinning).to.equal(false);
    const out = output();
    expect(out).to.contain('Loading');
    expect(out).to.contain('\r\x1b[K');
    expect(out.endsWith('Loaded\n')).to.equal(true);
  });

  it('uses the current text when succeed or fail have no argument', () => {
    const { stream, output } = fakeStream(false);
    createSpinner({ text: 'Final text', stream }).start().fail();
    expect(output()).to.contain('Final text\n');
  });

  it('accepts a string as options', () => {
    const spinner = createSpinner('Hello');
    expect(spinner.text).to.equal('Hello');
  });
});

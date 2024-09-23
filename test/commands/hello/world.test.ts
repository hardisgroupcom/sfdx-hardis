import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import World from '../../../src/commands/hello/world.js';

describe('hello world', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;

  beforeEach(() => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs hello world', async () => {
    await World.run([]);
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('Hello World');
  });

  it('runs hello world with --json and no provided name', async () => {
    const result = await World.run([]);
    expect(result.name).to.equal('World');
  });

  it('runs hello world --name Astro', async () => {
    await World.run(['--name', 'Astro']);
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('Hello Astro');
  });

  it('runs hello world --name Astro --json', async () => {
    const result = await World.run(['--name', 'Astro', '--json']);
    expect(result.name).to.equal('Astro');
  });
});

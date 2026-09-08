import { expect } from 'chai';
// Load the barrel first: gitProvider modules take part in a pre-existing import cycle
import '../../../src/common/gitProvider/index.js';
import { GitProviderRoot } from '../../../src/common/gitProvider/gitProviderRoot.js';

// The job name and its URL come from CI variables that only exist inside the CI system. A run from
// a developer machine, or from a CI system other than the git provider's own, has neither, and
// interpolating them anyway printed a dead link in every single Pull Request comment:
// `from job [null](null)` on GitHub, `from job [undefined](undefined)` on GitLab.
describe('GitProviderRoot.buildPoweredByFooter', () => {
  class TestProvider extends GitProviderRoot {
    public getLabel(): string {
      return 'test';
    }
    public footer(name: any, url: any): string {
      return (this as any).buildPoweredByFooter(name, url);
    }
  }
  const provider = new TestProvider();

  it('links to the job when both the name and the URL are known', () => {
    const footer = provider.footer('deploy-uat', 'https://ci.example.com/jobs/42');
    expect(footer).to.include('from job [deploy-uat](https://ci.example.com/jobs/42)');
    expect(footer).to.include('Powered by [sfdx-hardis]');
  });

  it('mentions no job at all when the name is missing', () => {
    const footer = provider.footer(null, 'https://ci.example.com/jobs/42');
    expect(footer).to.not.include('from job');
    expect(footer).to.include('Powered by [sfdx-hardis]');
    expect(footer.endsWith('_')).to.equal(true);
  });

  it('mentions no job at all when the URL is missing', () => {
    expect(provider.footer('deploy-uat', undefined)).to.not.include('from job');
  });

  it('never prints the string null or undefined as a job', () => {
    for (const value of [null, undefined, '', '  ', 'null', 'undefined']) {
      const footer = provider.footer(value, value);
      expect(footer, `footer for ${JSON.stringify(value)}`).to.not.match(/\bnull\b|\bundefined\b/);
      expect(footer).to.not.include('from job');
    }
  });

  it('is not fooled by a name that only looks empty', () => {
    expect(provider.footer('  deploy  ', 'https://ci.example.com/1')).to.include('from job [deploy](https://ci.example.com/1)');
  });

  it('accepts a numeric job name, as Bitbucket build numbers are', () => {
    expect(provider.footer(7 as any, 'https://bitbucket.org/x/y/pipelines/results/7')).to.include('from job [7](');
  });
});

// The same absent job name used to be baked into the message key that identifies the comment, so a
// project whose jobs sometimes carry a name and sometimes do not produced two different keys for
// what is the same comment.
describe('GitProviderRoot.jobMessageKeySegment', () => {
  class TestProvider extends GitProviderRoot {
    public getLabel(): string {
      return 'test';
    }
    public segment(name: any): string {
      return (this as any).jobMessageKeySegment(name);
    }
  }
  const provider = new TestProvider();

  it('keeps a real job name', () => {
    expect(provider.segment('deploy-uat')).to.equal('deploy-uat');
  });

  it('falls back to a stable placeholder when there is no job name', () => {
    for (const value of [null, undefined, '', '   ', 'null', 'undefined']) {
      expect(provider.segment(value), `segment for ${JSON.stringify(value)}`).to.equal('job');
    }
  });
});

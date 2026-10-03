import { expect } from 'chai';
// Loads the providers in the order the circular imports need, like github.test.ts
import '../../../src/common/gitProvider/index.js';
import { AzureDevopsProvider } from '../../../src/common/gitProvider/azureDevops.js';
import { BitbucketProvider } from '../../../src/common/gitProvider/bitbucket.js';
import { GithubProvider } from '../../../src/common/gitProvider/github.js';
import { GitlabProvider } from '../../../src/common/gitProvider/gitlab.js';
import { GitProviderRoot } from '../../../src/common/gitProvider/gitProviderRoot.js';

// The line a deployment job asks to add when git refuses the checkout ("detected dubious ownership")
describe('getSafeDirectoryCommand()', () => {
  const command = (provider: { prototype: GitProviderRoot }) => provider.prototype.getSafeDirectoryCommand.call({});

  it('names the workspace variable of each provider CI', () => {
    expect(command(GithubProvider)).to.equal('git config --global --add safe.directory "$GITHUB_WORKSPACE"');
    expect(command(GitlabProvider)).to.equal('git config --global --add safe.directory "$CI_PROJECT_DIR"');
    expect(command(BitbucketProvider)).to.equal('git config --global --add safe.directory "$BITBUCKET_CLONE_DIR"');
    expect(command(AzureDevopsProvider)).to.equal('git config --global --add safe.directory "$(Build.SourcesDirectory)"');
  });

  it('falls back to the directory of the job', () => {
    expect(command(GitProviderRoot as any)).to.equal(`git config --global --add safe.directory "${process.cwd()}"`);
  });
});

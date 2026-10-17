/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  findJobUrlInMarkdown,
  normalizeJobUrl,
  parseAzureBuildUrl,
  parseBitbucketPipelineUrl,
  parseGithubRunUrl,
  parseGitlabJobUrl,
} from '../../../../src/common/gitProvider/utils/jobUrlUtils.js';

describe('Job URL of a Pull Request comment', () => {
  it('reads the run of a GitHub Actions URL, whatever follows the run id', () => {
    expect(parseGithubRunUrl('https://github.com/acme/my-repo/actions/runs/123456')).to.deep.equal({ serverUrl: 'https://github.com', owner: 'acme', repo: 'my-repo', runId: 123456 });
    expect(parseGithubRunUrl('https://github.acme.com/acme/my-repo/actions/runs/12/job/34?pr=5')?.runId).to.equal(12);
    expect(parseGithubRunUrl('https://github.com/acme/my-repo/actions/runs/12/attempts/2')?.runId).to.equal(12);
    expect(parseGithubRunUrl('https://github.com/acme/my-repo/pull/12')).to.be.null;
    expect(parseGithubRunUrl('')).to.be.null;
  });

  it('reads the job of a GitLab URL, with sub-groups in the project path', () => {
    expect(parseGitlabJobUrl('https://gitlab.com/acme/team/my-project/-/jobs/987')).to.deep.equal({ serverUrl: 'https://gitlab.com', projectPath: 'acme/team/my-project', jobId: 987 });
    expect(parseGitlabJobUrl('https://gitlab.acme.com/acme/my-project/-/jobs/987/artifacts/browse')?.jobId).to.equal(987);
    expect(parseGitlabJobUrl('https://gitlab.com/acme/my-project/-/pipelines/987')).to.be.null;
  });

  it('reads the build of an Azure DevOps URL, with an encoded project name', () => {
    expect(parseAzureBuildUrl('https://dev.azure.com/acme/My%20Project/_build/results?buildId=42')).to.deep.equal({
      projectUrl: 'https://dev.azure.com/acme/My%20Project',
      teamProject: 'My Project',
      buildId: 42,
    });
    expect(parseAzureBuildUrl('https://dev.azure.com/acme/proj/_build/results?view=artifacts&buildId=42&type=publishedArtifacts')?.buildId).to.equal(42);
    expect(parseAzureBuildUrl('https://dev.azure.com/acme/proj/_build?definitionId=3')).to.be.null;
  });

  it('reads the pipeline of a Bitbucket URL', () => {
    expect(parseBitbucketPipelineUrl('https://bitbucket.org/acme/my-repo/pipelines/results/77')).to.deep.equal({ serverUrl: 'https://bitbucket.org', workspace: 'acme', repo: 'my-repo', buildNumber: 77 });
    expect(parseBitbucketPipelineUrl('https://bitbucket.org/acme/my-repo/pull-requests/77')).to.be.null;
  });

  it('reduces a job URL to what identifies the job', () => {
    expect(normalizeJobUrl('https://github.com/acme/my-repo/actions/runs/12/job/34')).to.equal('https://github.com/acme/my-repo/actions/runs/12');
    expect(normalizeJobUrl('https://gitlab.com/acme/my-project/-/jobs/987/artifacts/browse')).to.equal('https://gitlab.com/acme/my-project/-/jobs/987');
    expect(normalizeJobUrl('https://dev.azure.com/acme/proj/_build/results?buildId=42&view=artifacts')).to.equal('https://dev.azure.com/acme/proj/_build/results?buildId=42');
    expect(normalizeJobUrl('https://megalinter.io/9.0.1')).to.be.null;
  });

  it('finds the job a MegaLinter comment links its reports to', () => {
    const body = [
      '## ✅ [MegaLinter](https://megalinter.io/9.0.1) analysis: Success',
      '',
      '| Descriptor | Linter |',
      '',
      'See detailed reports in [MegaLinter artifacts](https://github.com/acme/my-repo/actions/runs/555)',
      '_Set `VALIDATE_ALL_CODEBASE: true` in mega-linter.yml to validate all sources_',
    ].join('\n');
    expect(findJobUrlInMarkdown(body)).to.equal('https://github.com/acme/my-repo/actions/runs/555');
    expect(findJobUrlInMarkdown('See [reports](https://dev.azure.com/acme/proj/_build/results?buildId=42&amp;view=artifacts)')).to.equal('https://dev.azure.com/acme/proj/_build/results?buildId=42');
    expect(findJobUrlInMarkdown('## [MegaLinter](https://megalinter.io/9.0.1) analysis: Success')).to.equal('');
    expect(findJobUrlInMarkdown('')).to.equal('');
  });
});

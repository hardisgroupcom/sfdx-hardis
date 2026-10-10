/*
The job URL written in a Pull Request comment is all a reader has to find the run again: these
helpers read the run, job, build or pipeline id back from it, for each provider, and find such a
URL in the comment MegaLinter posts, which has no hidden marker of ours.
*/

export interface GithubRunUrl {
  serverUrl: string;
  owner: string;
  repo: string;
  runId: number;
}

export interface GitlabJobUrl {
  serverUrl: string;
  projectPath: string;
  jobId: number;
}

export interface AzureBuildUrl {
  // Collection URI followed by the team project, as in the URL (URL-encoded)
  projectUrl: string;
  teamProject: string;
  buildId: number;
}

export interface BitbucketPipelineUrl {
  serverUrl: string;
  workspace: string;
  repo: string;
  buildNumber: number;
}

const GITHUB_RUN_REGEX = /^(https?:\/\/[^/\s]+)\/([^/\s]+)\/([^/\s]+)\/actions\/runs\/(\d+)/;
const GITLAB_JOB_REGEX = /^(https?:\/\/[^/\s]+)\/([^\s?#]+?)\/-\/jobs\/(\d+)/;
const AZURE_BUILD_REGEX = /^(https?:\/\/[^\s?#]+?)\/_build\/results\?(?:[^\s#]*&)?buildId=(\d+)/;
const BITBUCKET_PIPELINE_REGEX = /^(https?:\/\/[^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pipelines\/results\/(\d+)/;
// Links of a markdown body: [text](url), <url> and bare URLs
const MARKDOWN_URL_REGEX = /https?:\/\/[^\s)<>"'\]]+/g;

/** https://github.com/owner/repo/actions/runs/123, with or without /job/456 or /attempts/2 after it */
export function parseGithubRunUrl(url: string): GithubRunUrl | null {
  const match = (url || '').trim().match(GITHUB_RUN_REGEX);
  if (!match) {
    return null;
  }
  return { serverUrl: match[1], owner: match[2], repo: match[3], runId: parseInt(match[4], 10) };
}

/** https://gitlab.com/group/subgroup/project/-/jobs/123, with or without /artifacts/browse after it */
export function parseGitlabJobUrl(url: string): GitlabJobUrl | null {
  const match = (url || '').trim().match(GITLAB_JOB_REGEX);
  if (!match) {
    return null;
  }
  return { serverUrl: match[1], projectPath: match[2], jobId: parseInt(match[3], 10) };
}

/** https://dev.azure.com/org/project/_build/results?buildId=123, with or without other parameters */
export function parseAzureBuildUrl(url: string): AzureBuildUrl | null {
  const match = (url || '').trim().match(AZURE_BUILD_REGEX);
  if (!match) {
    return null;
  }
  const projectUrl = match[1];
  let teamProject = projectUrl.split('/').pop() || '';
  try {
    teamProject = decodeURIComponent(teamProject);
  } catch {
    // Kept as written when it is not valid URL encoding
  }
  return { projectUrl, teamProject, buildId: parseInt(match[2], 10) };
}

/** https://bitbucket.org/workspace/repo/pipelines/results/123 */
export function parseBitbucketPipelineUrl(url: string): BitbucketPipelineUrl | null {
  const match = (url || '').trim().match(BITBUCKET_PIPELINE_REGEX);
  if (!match) {
    return null;
  }
  return { serverUrl: match[1], workspace: match[2], repo: match[3], buildNumber: parseInt(match[4], 10) };
}

/**
 * The job URL of any provider reduced to what identifies the job, without the page, tab or
 * attempt a link can carry after it. Null when the URL is not the one of a job.
 */
export function normalizeJobUrl(url: string): string | null {
  const github = parseGithubRunUrl(url);
  if (github) {
    return `${github.serverUrl}/${github.owner}/${github.repo}/actions/runs/${github.runId}`;
  }
  const gitlab = parseGitlabJobUrl(url);
  if (gitlab) {
    return `${gitlab.serverUrl}/${gitlab.projectPath}/-/jobs/${gitlab.jobId}`;
  }
  const azure = parseAzureBuildUrl(url);
  if (azure) {
    return `${azure.projectUrl}/_build/results?buildId=${azure.buildId}`;
  }
  const bitbucket = parseBitbucketPipelineUrl(url);
  if (bitbucket) {
    return `${bitbucket.serverUrl}/${bitbucket.workspace}/${bitbucket.repo}/pipelines/results/${bitbucket.buildNumber}`;
  }
  return null;
}

/**
 * First link of a markdown body that points to a CI job, normalized. Used on the comment of
 * MegaLinter, which links its reports to the run that produced them.
 */
export function findJobUrlInMarkdown(markdown: string): string {
  for (const candidate of (markdown || '').match(MARKDOWN_URL_REGEX) || []) {
    const jobUrl = normalizeJobUrl(candidate.replace(/&amp;/g, '&'));
    if (jobUrl) {
      return jobUrl;
    }
  }
  return '';
}

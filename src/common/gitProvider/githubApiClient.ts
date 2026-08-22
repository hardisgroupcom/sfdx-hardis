// Minimal GitHub API client covering only the REST and GraphQL calls used by the
// GitHub git provider, so @actions/github and its octokit stack do not need to be
// shipped as dependencies. Built on the shared httpUtils client (proxy support).
//
// It also exposes the GitHub Actions context values that the provider reads
// (repository, event payload, ref, run id), computed from the same environment
// variables @actions/github used, so behavior inside GitHub Actions is unchanged.
import fs from '../utils/fsUtils.js';
import { createHttpClient, HttpClient, HttpError, HttpRequestConfig, HttpResponse } from '../utils/httpUtils.js';

export const GITHUB_DEFAULT_API_URL = 'https://api.github.com';
export const GITHUB_DEFAULT_SERVER_URL = 'https://github.com';
export const GITHUB_DEFAULT_GRAPHQL_URL = 'https://api.github.com/graphql';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_PAGE_SIZE = 100;

// Error raised by the GitHub client: same fields as the octokit RequestError the
// provider used to receive (status, message from the API payload, response).
export class GithubApiError extends Error {
  public status: number;
  public response: { status: number; statusText: string; data: any };
  public request: { method: string; url: string };

  constructor(message: string, status: number, response: { status: number; statusText: string; data: any }, request: { method: string; url: string }) {
    super(message);
    this.name = 'GithubApiError';
    this.status = status;
    this.response = response;
    this.request = request;
  }
}

export interface GithubActionsContext {
  payload: any;
  eventName: string;
  sha: string;
  ref: string;
  workflow: string;
  action: string;
  actor: string;
  job: string;
  runNumber: number;
  runId: number;
  apiUrl: string;
  serverUrl: string;
  graphqlUrl: string;
  // null when neither GITHUB_REPOSITORY nor the event payload names the repository
  repo: { owner: string; repo: string } | null;
  // Number of the issue or pull request that triggered the run, when any
  issueNumber: number | null;
}

// Same values @actions/github computed in its Context class, read from the environment
// and from the webhook event payload file when GITHUB_EVENT_PATH exists.
export function getGithubActionsContext(): GithubActionsContext {
  let payload: any = {};
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    try {
      payload = JSON.parse(fs.readFileSync(eventPath, { encoding: 'utf8' }));
    } catch {
      payload = {};
    }
  }
  let repo: { owner: string; repo: string } | null = null;
  if (process.env.GITHUB_REPOSITORY) {
    const [owner, repoName] = process.env.GITHUB_REPOSITORY.split('/');
    repo = { owner, repo: repoName };
  } else if (payload?.repository) {
    repo = { owner: payload.repository.owner?.login, repo: payload.repository.name };
  }
  const issueNumberRaw = (payload?.issue || payload?.pull_request || payload)?.number;
  return {
    payload,
    eventName: process.env.GITHUB_EVENT_NAME as string,
    sha: process.env.GITHUB_SHA as string,
    ref: process.env.GITHUB_REF as string,
    workflow: process.env.GITHUB_WORKFLOW as string,
    action: process.env.GITHUB_ACTION as string,
    actor: process.env.GITHUB_ACTOR as string,
    job: process.env.GITHUB_JOB as string,
    runNumber: parseInt(process.env.GITHUB_RUN_NUMBER as string, 10),
    runId: parseInt(process.env.GITHUB_RUN_ID as string, 10),
    apiUrl: process.env.GITHUB_API_URL || GITHUB_DEFAULT_API_URL,
    serverUrl: process.env.GITHUB_SERVER_URL || GITHUB_DEFAULT_SERVER_URL,
    graphqlUrl: process.env.GITHUB_GRAPHQL_URL || GITHUB_DEFAULT_GRAPHQL_URL,
    repo,
    issueNumber: typeof issueNumberRaw === 'number' ? issueNumberRaw : null,
  };
}

export interface GithubRequestOptions {
  params?: Record<string, any>;
  headers?: Record<string, string>;
}

export class GithubApiClient {
  public readonly apiUrl: string;
  public readonly graphqlUrl: string;
  private readonly http: HttpClient;

  constructor(token: string, options: { apiUrl?: string; graphqlUrl?: string } = {}) {
    this.apiUrl = (options.apiUrl || process.env.GITHUB_API_URL || GITHUB_DEFAULT_API_URL).replace(/\/$/, '');
    this.graphqlUrl = options.graphqlUrl || process.env.GITHUB_GRAPHQL_URL || GITHUB_DEFAULT_GRAPHQL_URL;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'sfdx-hardis',
    };
    if (token) {
      headers.Authorization = `token ${token}`;
    }
    this.http = createHttpClient({ baseURL: this.apiUrl, headers });
  }

  // REST GET: path is relative to the API root (for example /repos/{owner}/{repo}/pulls)
  public async get<T = any>(path: string, options: GithubRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.send<T>('GET', path, undefined, options);
  }

  public async post<T = any>(path: string, body?: any, options: GithubRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.send<T>('POST', path, body, options);
  }

  public async patch<T = any>(path: string, body?: any, options: GithubRequestOptions = {}): Promise<HttpResponse<T>> {
    return this.send<T>('PATCH', path, body, options);
  }

  // Follows the Link: <...>; rel="next" header until the last page and returns the
  // concatenated items (the REST list endpoints return one JSON array per page)
  public async paginate<T = any>(path: string, options: GithubRequestOptions = {}): Promise<T[]> {
    const items: T[] = [];
    const params = { per_page: GITHUB_PAGE_SIZE, ...(options.params || {}) };
    let nextUrl: string | null = this.buildUrl(path);
    let nextOptions: GithubRequestOptions = { ...options, params };
    while (nextUrl) {
      const response: HttpResponse<T[]> = await this.send<T[]>('GET', nextUrl, undefined, nextOptions);
      if (Array.isArray(response.data)) {
        items.push(...response.data);
      }
      nextUrl = GithubApiClient.getNextPageUrl(response.headers);
      // The next link already carries the query string (page, per_page, filters)
      nextOptions = { headers: options.headers };
    }
    return items;
  }

  // Runs a GraphQL query and returns its data, throwing when the API reports errors
  public async graphql<T = any>(query: string, variables: Record<string, any> = {}): Promise<T> {
    const response = await this.send<{ data?: T; errors?: Array<{ message: string }> }>('POST', this.graphqlUrl, { query, variables });
    const errors = response.data?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const details = errors.map((error) => ` - ${error?.message || JSON.stringify(error)}`).join('\n');
      throw new GithubApiError(`Request failed due to following response errors:\n${details}`, response.status, { status: response.status, statusText: response.statusText, data: response.data }, { method: 'POST', url: this.graphqlUrl });
    }
    return response.data?.data as T;
  }

  public static getNextPageUrl(headers: Record<string, string>): string | null {
    const linkHeader = headers?.link || headers?.Link || '';
    for (const part of linkHeader.split(',')) {
      const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  private buildUrl(path: string): string {
    return path.startsWith('http') ? path : this.apiUrl + path;
  }

  private async send<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body: any, options: GithubRequestOptions = {}): Promise<HttpResponse<T>> {
    const url = this.buildUrl(path);
    const config: HttpRequestConfig = { params: options.params, headers: options.headers };
    try {
      if (method === 'GET') {
        return await this.http.get<T>(url, config);
      }
      if (method === 'PATCH') {
        return await this.http.patch<T>(url, body, config);
      }
      return await this.http.post<T>(url, body, config);
    } catch (error) {
      throw GithubApiClient.toGithubApiError(error, method, url);
    }
  }

  // Map the generic HttpError to the shape octokit errors had: message from the API
  // payload ("Not Found", "Bad credentials"), status and response kept
  private static toGithubApiError(error: unknown, method: string, url: string): Error {
    if (error instanceof HttpError) {
      const data = error.response?.data;
      const apiMessage = data && typeof data === 'object' && typeof data.message === 'string' ? data.message : null;
      const message = apiMessage || error.response?.statusText || error.message;
      return new GithubApiError(`${message} (HTTP ${error.status}, ${method} ${url})`, error.status, error.response, { method, url });
    }
    return error as Error;
  }
}

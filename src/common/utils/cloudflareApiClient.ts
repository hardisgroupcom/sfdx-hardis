// Minimal Cloudflare REST API client, covering only the endpoints used by
// hardis:doc:mkdocs-to-cf (Pages projects + Zero Trust Access), so the full
// cloudflare SDK does not need to be shipped as a dependency.
// Built on the shared httpUtils client (proxy support, timeout) and only adds
// the Cloudflare { success, result, errors } envelope handling.
import { SfError } from '@salesforce/core';
import { createHttpClient, HttpClient, HttpError } from './httpUtils.js';

export interface CloudflarePagesProject {
  id?: string;
  name?: string;
  domains?: string[];
  production_branch?: string;
  [key: string]: any;
}

export interface CloudflareAccessPolicy {
  id?: string;
  name?: string;
  [key: string]: any;
}

export interface CloudflareIdentityProvider {
  id?: string;
  name?: string;
  type?: string;
  [key: string]: any;
}

export interface CloudflareAccessApplication {
  id?: string;
  name?: string;
  domain?: string;
  type?: string;
  destinations?: Array<{ type: string; uri: string }>;
  policies?: Array<{ id?: string;[key: string]: any }>;
  [key: string]: any;
}

const CLOUDFLARE_API_ROOT = 'https://api.cloudflare.com/client/v4';
const CLOUDFLARE_TIMEOUT_MS = 60000;

export class CloudflareApiClient {
  private readonly accountId: string;
  private readonly http: HttpClient;

  constructor(options: { apiEmail: string; apiToken: string; accountId: string }) {
    this.accountId = options.accountId;
    this.http = createHttpClient({
      baseURL: CLOUDFLARE_API_ROOT,
      timeout: CLOUDFLARE_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        'X-Auth-Email': options.apiEmail,
        'Content-Type': 'application/json',
      },
    });
  }

  public async getPagesProject(projectName: string): Promise<CloudflarePagesProject> {
    return this.request<CloudflarePagesProject>('GET', `/accounts/${this.accountId}/pages/projects/${projectName}`);
  }

  public async createPagesProject(body: { name: string; production_branch: string }): Promise<CloudflarePagesProject> {
    return this.request<CloudflarePagesProject>('POST', `/accounts/${this.accountId}/pages/projects`, body);
  }

  public async listAccessPolicies(): Promise<CloudflareAccessPolicy[]> {
    return this.request<CloudflareAccessPolicy[]>('GET', `/accounts/${this.accountId}/access/policies`);
  }

  public async createAccessPolicy(body: Record<string, any>): Promise<CloudflareAccessPolicy> {
    return this.request<CloudflareAccessPolicy>('POST', `/accounts/${this.accountId}/access/policies`, body);
  }

  public async listIdentityProviders(): Promise<CloudflareIdentityProvider[]> {
    return this.request<CloudflareIdentityProvider[]>('GET', `/accounts/${this.accountId}/access/identity_providers`);
  }

  public async listAccessApplications(): Promise<CloudflareAccessApplication[]> {
    return this.request<CloudflareAccessApplication[]>('GET', `/accounts/${this.accountId}/access/apps`);
  }

  public async createAccessApplication(body: Record<string, any>): Promise<CloudflareAccessApplication> {
    return this.request<CloudflareAccessApplication>('POST', `/accounts/${this.accountId}/access/apps`, body);
  }

  public async updateAccessApplication(appId: string, body: Record<string, any>): Promise<CloudflareAccessApplication> {
    return this.request<CloudflareAccessApplication>('PUT', `/accounts/${this.accountId}/access/apps/${appId}`, body);
  }

  // Sends the request and unwraps the Cloudflare response envelope { success, result, errors }
  private async request<T>(method: string, apiPath: string, body?: Record<string, any>): Promise<T> {
    let status = 0;
    let payload: any = null;
    try {
      const response =
        method === 'GET' ? await this.http.get(apiPath)
          : method === 'PUT' ? await this.http.put(apiPath, body)
            : await this.http.post(apiPath, body);
      status = response.status;
      payload = response.data;
    } catch (e: any) {
      if (!(e instanceof HttpError)) {
        throw e;
      }
      status = e.response.status;
      payload = typeof e.response.data === 'object' ? e.response.data : null;
      // Falls through to the envelope error below
    }
    if (status < 200 || status >= 300 || payload?.success === false) {
      const errors = (payload?.errors || [])
        .map((err: any) => `${err.code ? err.code + ': ' : ''}${err.message || JSON.stringify(err)}`)
        .join('; ');
      throw new SfError(`Cloudflare API error on ${method} ${apiPath} (HTTP ${status})${errors ? ': ' + errors : ''}`);
    }
    return payload?.result as T;
  }
}

// Minimal Cloudflare REST API client, covering only the endpoints used by
// hardis:doc:mkdocs-to-cf (Pages projects + Zero Trust Access), so the full
// cloudflare SDK does not need to be shipped as a dependency.
import { SfError } from '@salesforce/core';

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

export class CloudflareApiClient {
  private readonly apiEmail: string;
  private readonly apiToken: string;
  private readonly accountId: string;

  constructor(options: { apiEmail: string; apiToken: string; accountId: string }) {
    this.apiEmail = options.apiEmail;
    this.apiToken = options.apiToken;
    this.accountId = options.accountId;
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
    const response = await fetch(`${CLOUDFLARE_API_ROOT}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'X-Auth-Email': this.apiEmail,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      // Non-JSON response body: handled below with the HTTP status
    }
    if (!response.ok || payload?.success === false) {
      const errors = (payload?.errors || [])
        .map((err: any) => `${err.code ? err.code + ': ' : ''}${err.message || JSON.stringify(err)}`)
        .join('; ');
      throw new SfError(`Cloudflare API error on ${method} ${apiPath} (HTTP ${response.status})${errors ? ': ' + errors : ''}`);
    }
    return payload?.result as T;
  }
}

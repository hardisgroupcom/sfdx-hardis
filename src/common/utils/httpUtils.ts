// Thin HTTP helpers over fetch, used as the single HTTP client of sfdx-hardis.
// The API mimics the axios semantics historically used in the codebase:
// - resolves only on 2xx, throws an HttpError exposing error.response.status / error.response.data
// - JSON request/response handling by default, responseType: 'text' for raw payloads
// - params / auth (basic) / headers / timeout config options
// - HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars are honored (like axios and
//   make-fetch-happen did) through undici's EnvHttpProxyAgent
import { fetch as undiciFetch, EnvHttpProxyAgent } from 'undici';

let envProxyAgent: EnvHttpProxyAgent | null = null;
let fetchOverrideForTests: ((url: string, init: any) => Promise<any>) | null = null;

/**
 * Proxy-aware fetch used for every outbound HTTP call of sfdx-hardis.
 * Honors HTTP_PROXY / HTTPS_PROXY / NO_PROXY like the axios and make-fetch-happen
 * clients it replaces. Signature-compatible with global fetch for our usage.
 */
export async function proxyFetch(url: string, init: any = {}): Promise<Response> {
  if (fetchOverrideForTests) {
    return fetchOverrideForTests(url, init) as Promise<Response>;
  }
  if (envProxyAgent === null) {
    envProxyAgent = new EnvHttpProxyAgent();
  }
  return undiciFetch(url, { ...init, dispatcher: envProxyAgent }) as unknown as Promise<Response>;
}

/** Test seam: override the fetch implementation (pass null to restore), and drop the cached proxy agent */
export function setFetchForTests(fetchImpl: ((url: string, init: any) => Promise<any>) | null): void {
  fetchOverrideForTests = fetchImpl;
  envProxyAgent = null;
}

export interface HttpRequestConfig {
  headers?: Record<string, string>;
  params?: Record<string, any>;
  auth?: { username: string; password: string };
  timeout?: number;
  responseType?: 'json' | 'text';
}

export interface HttpResponse<T = any> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
}

export class HttpError extends Error {
  public response: { status: number; statusText: string; data: any };
  public status: number;

  constructor(message: string, response: { status: number; statusText: string; data: any }) {
    super(message);
    this.name = 'HttpError';
    this.response = response;
    this.status = response.status;
  }
}

function buildUrl(url: string, params?: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) {
    return url;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      search.append(key, String(value));
    }
  }
  return url + (url.includes('?') ? '&' : '?') + search.toString();
}

function buildHeaders(config: HttpRequestConfig, hasJsonBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { ...(config.headers || {}) };
  const headerNames = Object.keys(headers).map((h) => h.toLowerCase());
  if (hasJsonBody && !headerNames.includes('content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  if (config.auth && !headerNames.includes('authorization')) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${config.auth.username}:${config.auth.password}`).toString('base64');
  }
  return headers;
}

async function parseResponseData(response: Response, responseType?: 'json' | 'text'): Promise<any> {
  const text = await response.text();
  if (responseType === 'text') {
    return text;
  }
  const contentType = response.headers.get('content-type') || '';
  if (responseType === 'json' || contentType.includes('json') || contentType === '') {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

async function request<T = any>(method: string, url: string, data?: any, config: HttpRequestConfig = {}): Promise<HttpResponse<T>> {
  // FormData bodies are passed through so fetch sets the multipart boundary itself
  const isJsonBody = data !== undefined && typeof data !== 'string' && !(data instanceof FormData);
  const body = data === undefined ? undefined : (isJsonBody ? JSON.stringify(data) : data);
  const headersToSend = buildHeaders(config, isJsonBody);
  if (data instanceof FormData) {
    // Let fetch compute the multipart Content-Type (with boundary) itself
    for (const headerName of Object.keys(headersToSend)) {
      if (headerName.toLowerCase() === 'content-type') {
        delete headersToSend[headerName];
      }
    }
  }
  const response = await proxyFetch(buildUrl(url, config.params), {
    method,
    headers: headersToSend,
    body,
    signal: config.timeout ? AbortSignal.timeout(config.timeout) : undefined,
  });
  const responseData = await parseResponseData(response, config.responseType);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  if (!response.ok) {
    throw new HttpError(`Request failed with status code ${response.status}`, {
      status: response.status,
      statusText: response.statusText,
      data: responseData,
    });
  }
  return { status: response.status, statusText: response.statusText, headers, data: responseData as T };
}

export async function httpGet<T = any>(url: string, config: HttpRequestConfig = {}): Promise<HttpResponse<T>> {
  return request<T>('GET', url, undefined, config);
}

export async function httpPost<T = any>(url: string, data?: any, config: HttpRequestConfig = {}): Promise<HttpResponse<T>> {
  return request<T>('POST', url, data, config);
}

export async function httpPut<T = any>(url: string, data?: any, config: HttpRequestConfig = {}): Promise<HttpResponse<T>> {
  return request<T>('PUT', url, data, config);
}

export async function httpPatch<T = any>(url: string, data?: any, config: HttpRequestConfig = {}): Promise<HttpResponse<T>> {
  return request<T>('PATCH', url, data, config);
}

export async function httpDelete<T = any>(url: string, config: HttpRequestConfig = {}): Promise<HttpResponse<T>> {
  return request<T>('DELETE', url, undefined, config);
}

export interface HttpClient {
  get<T = any>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
  post<T = any>(url: string, data?: any, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
  put<T = any>(url: string, data?: any, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
  patch<T = any>(url: string, data?: any, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
  delete<T = any>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
}

// Returns an HTTP client bound to a base URL and default config (axios.create equivalent)
export function createHttpClient(defaults: { baseURL: string; headers?: Record<string, string>; timeout?: number; auth?: { username: string; password: string } }): HttpClient {
  const mergeConfig = (config: HttpRequestConfig = {}): HttpRequestConfig => ({
    ...config,
    timeout: config.timeout ?? defaults.timeout,
    auth: config.auth ?? defaults.auth,
    headers: { ...(defaults.headers || {}), ...(config.headers || {}) },
  });
  const fullUrl = (url: string): string => (url.startsWith('http') ? url : defaults.baseURL + url);
  return {
    get: (url, config) => httpGet(fullUrl(url), mergeConfig(config)),
    post: (url, data, config) => httpPost(fullUrl(url), data, mergeConfig(config)),
    put: (url, data, config) => httpPut(fullUrl(url), data, mergeConfig(config)),
    patch: (url, data, config) => httpPatch(fullUrl(url), data, mergeConfig(config)),
    delete: (url, config) => httpDelete(fullUrl(url), mergeConfig(config)),
  };
}

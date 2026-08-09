/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { CloudflareApiClient } from '../../../src/common/utils/cloudflareApiClient.js';

describe('CloudflareApiClient', () => {
  const originalFetch = globalThis.fetch;
  let requests: Array<{ url: string; init: any }> = [];
  let nextResponses: Response[] = [];

  function mockFetch(...responses: Response[]) {
    requests = [];
    nextResponses = responses;
    globalThis.fetch = (async (url: any, init: any) => {
      requests.push({ url: String(url), init });
      return nextResponses.shift() ?? new Response('{}', { status: 200 });
    }) as any;
  }

  function envelope(result: any): Response {
    return new Response(JSON.stringify({ success: true, result, errors: [] }), { status: 200 });
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new CloudflareApiClient({ apiEmail: 'me@example.com', apiToken: 'tok', accountId: 'acc123' });

  it('gets a Pages project with auth headers', async () => {
    mockFetch(envelope({ name: 'sfdoc-proj', domains: ['sfdoc-proj.pages.dev'] }));
    const project = await client.getPagesProject('sfdoc-proj');
    expect(project.domains).to.deep.equal(['sfdoc-proj.pages.dev']);
    expect(requests[0].url).to.equal('https://api.cloudflare.com/client/v4/accounts/acc123/pages/projects/sfdoc-proj');
    expect(requests[0].init.method).to.equal('GET');
    expect(requests[0].init.headers.Authorization).to.equal('Bearer tok');
    expect(requests[0].init.headers['X-Auth-Email']).to.equal('me@example.com');
  });

  it('creates a Pages project with a JSON body', async () => {
    mockFetch(envelope({ name: 'sfdoc-proj' }));
    await client.createPagesProject({ name: 'sfdoc-proj', production_branch: 'main' });
    expect(requests[0].url).to.equal('https://api.cloudflare.com/client/v4/accounts/acc123/pages/projects');
    expect(requests[0].init.method).to.equal('POST');
    expect(JSON.parse(requests[0].init.body)).to.deep.equal({ name: 'sfdoc-proj', production_branch: 'main' });
  });

  it('lists access policies from the result field', async () => {
    mockFetch(envelope([{ id: 'p1', name: 'access-policy-x' }]));
    const policies = await client.listAccessPolicies();
    expect(policies).to.deep.equal([{ id: 'p1', name: 'access-policy-x' }]);
    expect(requests[0].url).to.equal('https://api.cloudflare.com/client/v4/accounts/acc123/access/policies');
  });

  it('lists identity providers', async () => {
    mockFetch(envelope([{ id: 'i1', type: 'onetimepin' }]));
    const providers = await client.listIdentityProviders();
    expect(providers[0].type).to.equal('onetimepin');
    expect(requests[0].url).to.equal('https://api.cloudflare.com/client/v4/accounts/acc123/access/identity_providers');
  });

  it('updates an access application with PUT on its id', async () => {
    mockFetch(envelope({ id: 'app1', policies: [{ id: 'p1' }] }));
    const app = await client.updateAccessApplication('app1', { policies: ['p1'] });
    expect(app.id).to.equal('app1');
    expect(requests[0].url).to.equal('https://api.cloudflare.com/client/v4/accounts/acc123/access/apps/app1');
    expect(requests[0].init.method).to.equal('PUT');
  });

  it('throws an explicit error on a Cloudflare error envelope', async () => {
    mockFetch(new Response(JSON.stringify({ success: false, result: null, errors: [{ code: 8000007, message: 'Project not found' }] }), { status: 404 }));
    try {
      await client.getPagesProject('missing');
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.message).to.include('HTTP 404');
      expect(e.message).to.include('Project not found');
      expect(e.message).to.include('8000007');
    }
  });

  it('throws on a non-JSON error response', async () => {
    mockFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    try {
      await client.listAccessApplications();
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.message).to.include('HTTP 502');
    }
  });
});

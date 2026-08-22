/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as http from 'http';
import { AddressInfo } from 'net';
import { createHttpClient, httpGet, httpPost, HttpError, setFetchForTests } from '../../../src/common/utils/httpUtils.js';

describe('httpUtils', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastRequest: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string };

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        lastRequest = { method: req.method, url: req.url, headers: req.headers, body };
        if (req.url?.startsWith('/json')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, echo: body ? JSON.parse(body) : null }));
        } else if (req.url?.startsWith('/text')) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('plain text response');
        } else if (req.url?.startsWith('/yaml')) {
          res.writeHead(200, { 'Content-Type': 'text/yaml' });
          res.end('key: value');
        } else if (req.url?.startsWith('/error')) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'boom' }));
        } else {
          res.writeHead(404);
          res.end('not found');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.close();
  });

  it('GETs and parses a JSON response', async () => {
    const res = await httpGet(`${baseUrl}/json`);
    expect(res.status).to.equal(200);
    expect(res.data.ok).to.be.true;
  });

  it('POSTs a JSON body with Content-Type application/json', async () => {
    const res = await httpPost(`${baseUrl}/json`, { hello: 'world' });
    expect(lastRequest.headers['content-type']).to.equal('application/json');
    expect(res.data.echo).to.deep.equal({ hello: 'world' });
  });

  it('POSTs a raw string body without JSON serialization', async () => {
    await httpPost(`${baseUrl}/text`, 'metric 1 2', { headers: { 'Content-Type': 'text/plain' } });
    expect(lastRequest.body).to.equal('metric 1 2');
    expect(lastRequest.headers['content-type']).to.equal('text/plain');
  });

  it('POSTs a global FormData as a real multipart body (undici fetch only knows its own FormData)', async () => {
    const form = new FormData();
    form.append('files', new Blob(['image-bytes']), 'picture.png');
    form.append('comment', 'hello');
    await httpPost(`${baseUrl}/text`, form, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' } });
    expect(lastRequest.headers['content-type']).to.match(/^multipart\/form-data; boundary=/);
    expect(lastRequest.headers['authorization']).to.equal('Bearer x');
    expect(lastRequest.body).to.not.contain('[object FormData]');
    expect(lastRequest.body).to.contain('name="files"; filename="picture.png"');
    expect(lastRequest.body).to.contain('image-bytes');
    expect(lastRequest.body).to.contain('name="comment"');
    expect(lastRequest.body).to.contain('hello');
  });

  it('encodes query params', async () => {
    await httpGet(`${baseUrl}/json`, { params: { q: 'a b', limit: 5 } });
    expect(lastRequest.url).to.equal('/json?q=a+b&limit=5');
  });

  it('sends basic auth as an Authorization header', async () => {
    await httpGet(`${baseUrl}/json`, { auth: { username: 'user', password: 'pass' } });
    expect(lastRequest.headers.authorization).to.equal('Basic ' + Buffer.from('user:pass').toString('base64'));
  });

  it('returns raw text with responseType text', async () => {
    const res = await httpGet(`${baseUrl}/yaml`, { responseType: 'text' });
    expect(res.data).to.equal('key: value');
  });

  it('throws an axios-shaped HttpError on non-2xx', async () => {
    try {
      await httpGet(`${baseUrl}/error`);
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e).to.be.instanceOf(HttpError);
      expect(e.response.status).to.equal(500);
      expect(e.response.data).to.deep.equal({ message: 'boom' });
      expect(e.message).to.include('500');
    }
  });

  it('createHttpClient prefixes the baseURL and merges headers', async () => {
    const client = createHttpClient({ baseUrl: '', baseURL: baseUrl, headers: { 'X-Default': 'yes' } } as any);
    const res = await client.get('/json', { headers: { 'X-Extra': 'also' } });
    expect(res.status).to.equal(200);
    expect(lastRequest.headers['x-default']).to.equal('yes');
    expect(lastRequest.headers['x-extra']).to.equal('also');
  });

  it('client PUT sends the JSON body', async () => {
    const client = createHttpClient({ baseURL: baseUrl });
    await client.put('/json', { updated: true });
    expect(lastRequest.method).to.equal('PUT');
    expect(JSON.parse(lastRequest.body || '{}')).to.deep.equal({ updated: true });
  });

  describe('proxy support (HTTP_PROXY / NO_PROXY)', () => {
    let proxyServer: http.Server;
    let proxyPort: number;
    let proxiedUrls: string[] = [];
    const savedProxyEnv: Record<string, string | undefined> = {};

    before(async () => {
      // Minimal forward proxy: absolute-form requests are answered directly
      proxyServer = http.createServer((req, res) => {
        proxiedUrls.push(req.url || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ viaProxy: true }));
      });
      await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', () => resolve()));
      proxyPort = (proxyServer.address() as AddressInfo).port;
    });

    after(() => {
      proxyServer.close();
    });

    beforeEach(() => {
      proxiedUrls = [];
      for (const envVar of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']) {
        savedProxyEnv[envVar] = process.env[envVar];
        delete process.env[envVar];
      }
    });

    afterEach(() => {
      for (const [envVar, value] of Object.entries(savedProxyEnv)) {
        if (value === undefined) {
          delete process.env[envVar];
        } else {
          process.env[envVar] = value;
        }
      }
      // Drop the cached proxy agent so other tests never route through the test proxy
      setFetchForTests(null);
    });

    it('routes requests through the HTTP_PROXY env var', async () => {
      process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
      setFetchForTests(null); // reset the cached agent so the env var is re-read
      const res = await httpGet('http://sfdx-hardis-proxy-test.invalid/ping');
      expect(res.data).to.deep.equal({ viaProxy: true });
      expect(proxiedUrls.some((u) => u.includes('sfdx-hardis-proxy-test.invalid'))).to.be.true;
    });

    it('bypasses the proxy for NO_PROXY hosts', async () => {
      process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
      process.env.NO_PROXY = '127.0.0.1';
      setFetchForTests(null);
      const res = await httpGet(`${baseUrl}/json`);
      expect(res.data.ok).to.be.true;
      expect(proxiedUrls).to.have.length(0);
    });
  });
});

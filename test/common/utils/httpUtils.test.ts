/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as http from 'http';
import { AddressInfo } from 'net';
import { createHttpClient, httpGet, httpPost, HttpError } from '../../../src/common/utils/httpUtils.js';

describe('httpUtils', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastRequest: { method?: string; url?: string; headers?: http.IncomingHttpHeaders; body?: string };

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
});

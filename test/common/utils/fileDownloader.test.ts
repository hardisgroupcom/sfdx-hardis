/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AddressInfo } from 'net';
import { FileDownloader } from '../../../src/common/utils/fileDownloader.js';

function startServer(handler: http.RequestListener): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function makeTmpFile(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfdx-hardis-dl-test-'));
  return path.join(tmpDir, 'downloaded.bin');
}

describe('FileDownloader', () => {
  let server: http.Server | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it('downloads a file with content-length', async () => {
    const content = 'sfdx-hardis download test content';
    const started = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(Buffer.byteLength(content)) });
      res.end(content);
    });
    server = started.server;
    const outputFile = await makeTmpFile();
    const result = await new FileDownloader(`${started.baseUrl}/file`, { outputFile, fetchOptions: { method: 'GET' } }).download();
    expect(result.success).to.be.true;
    expect(await fs.readFile(outputFile, 'utf8')).to.equal(content);
  });

  it('downloads a chunked file without content-length', async () => {
    const started = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.write('chunk1-');
      res.write('chunk2');
      res.end();
    });
    server = started.server;
    const outputFile = await makeTmpFile();
    const result = await new FileDownloader(`${started.baseUrl}/file`, { outputFile, fetchOptions: { method: 'GET' } }).download();
    expect(result.success).to.be.true;
    expect(await fs.readFile(outputFile, 'utf8')).to.equal('chunk1-chunk2');
  });

  it('retries on a 500 then succeeds', async () => {
    let calls = 0;
    const started = await startServer((req, res) => {
      calls++;
      if (calls === 1) {
        res.writeHead(500);
        res.end('boom');
        return;
      }
      res.writeHead(200, { 'Content-Length': '2' });
      res.end('ok');
    });
    server = started.server;
    const outputFile = await makeTmpFile();
    const result = await new FileDownloader(`${started.baseUrl}/file`, {
      outputFile,
      fetchOptions: { method: 'GET', retry: { retries: 2, factor: 1, randomize: false } },
    }).download();
    expect(result.success).to.be.true;
    expect(calls).to.equal(2);
    expect(await fs.readFile(outputFile, 'utf8')).to.equal('ok');
  }).timeout(30000);

  it('fails without retry on a 404', async () => {
    let calls = 0;
    const started = await startServer((req, res) => {
      calls++;
      res.writeHead(404);
      res.end('not found');
    });
    server = started.server;
    const outputFile = await makeTmpFile();
    const result = await new FileDownloader(`${started.baseUrl}/missing`, {
      outputFile,
      fetchOptions: { method: 'GET', retry: { retries: 3, factor: 1, randomize: false } },
    }).download();
    expect(result.success).to.be.false;
    expect(calls).to.equal(1);
    expect(result.error).to.exist;
  });

  it('fails after exhausting retries on network error', async () => {
    // Port from a server that is closed immediately: connection refused
    const started = await startServer(() => { });
    const deadUrl = started.baseUrl;
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
    const outputFile = await makeTmpFile();
    const result = await new FileDownloader(`${deadUrl}/file`, {
      outputFile,
      fetchOptions: { method: 'GET', retry: { retries: 1, factor: 1, randomize: false } },
    }).download();
    expect(result.success).to.be.false;
    expect(result.error).to.exist;
  }).timeout(30000);
});

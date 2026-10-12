/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';
import {
  crudReadMetadatas,
  isTransientMetadataApiError,
  parallelReadCallSizes,
  DEFAULT_READ_CONCURRENCY,
} from '../../../src/common/metadata-utils/crudMetadataApi.js';

const noSleep = async () => { };
const commandThis = { ux: { log: () => { } } };

function profileSet(names: string[]): ComponentSet {
  return new ComponentSet(names.map((fullName) => ({ fullName, type: 'Profile' })));
}

function tempOutputDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crud-read-test-'));
}

// A connection whose readMetadata takes a few milliseconds and records how many calls run together
function recordingConnection(delayMs: number) {
  const state = { running: 0, maxRunning: 0 };
  const conn: any = {
    metadata: {
      read: async (_type: string, fullNames: string[]) => {
        state.running++;
        state.maxRunning = Math.max(state.maxRunning, state.running);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        state.running--;
        return fullNames.map((fullName) => ({ fullName, custom: 'true', userLicense: 'Salesforce' }));
      },
    },
  };
  return { conn, state };
}

describe('parallelReadCallSizes()', () => {
  it('starts at the default number of parallel calls and ends at one call at a time', () => {
    expect(DEFAULT_READ_CONCURRENCY).to.equal(5);
    expect(parallelReadCallSizes()).to.deep.equal([5, 4, 2, 1]);
  });

  it('starts at the requested number', () => {
    expect(parallelReadCallSizes(8)).to.deep.equal([8, 4, 2, 1]);
    expect(parallelReadCallSizes(2)).to.deep.equal([2, 1]);
  });

  it('reads one call at a time when asked for 1, 0 or less', () => {
    expect(parallelReadCallSizes(1)).to.deep.equal([1]);
    expect(parallelReadCallSizes(0)).to.deep.equal([1]);
    expect(parallelReadCallSizes(-3)).to.deep.equal([1]);
  });

  it('falls back to the default when the number is not one', () => {
    expect(parallelReadCallSizes(NaN)).to.deep.equal([5, 4, 2, 1]);
    expect(parallelReadCallSizes(null)).to.deep.equal([5, 4, 2, 1]);
  });
});

describe('isTransientMetadataApiError()', () => {
  it('is true for too many concurrent requests, an unavailable server and a dropped connection', () => {
    expect(isTransientMetadataApiError(new Error('REQUEST_LIMIT_EXCEEDED: ConcurrentRequests (Concurrent API Requests) Limit exceeded.'))).to.be.true;
    expect(isTransientMetadataApiError({ name: 'SERVER_UNAVAILABLE', message: 'Service unavailable' })).to.be.true;
    expect(isTransientMetadataApiError({ errorCode: 'ERROR_HTTP_503', message: '' })).to.be.true;
    expect(isTransientMetadataApiError({ code: 'ECONNRESET', message: 'read ECONNRESET' })).to.be.true;
    expect(isTransientMetadataApiError(new Error('socket hang up'))).to.be.true;
  });

  it('is false for the daily API limit and for an error about the component', () => {
    expect(isTransientMetadataApiError(new Error('REQUEST_LIMIT_EXCEEDED: TotalRequests Limit exceeded.'))).to.be.false;
    expect(isTransientMetadataApiError(new Error('INVALID_TYPE: Unknown type: Profil'))).to.be.false;
    expect(isTransientMetadataApiError(new Error('Your request timed out while reading the component'))).to.be.false;
    expect(isTransientMetadataApiError(null)).to.be.false;
  });
});

describe('crudReadMetadatas() parallel calls', () => {
  it('sends the calls side by side and writes every Profile', async () => {
    const { conn, state } = recordingConnection(20);
    const outputDir = tempOutputDir();
    const outcome = await crudReadMetadatas({
      conn,
      componentSet: profileSet(['A', 'B', 'C', 'D', 'E', 'F']),
      outputDir,
      packageDirs: [outputDir],
      chunkSizeOverride: 2,
      commandThis,
      sleep: noSleep,
    });
    expect(outcome.failures).to.deep.equal([]);
    expect(outcome.successes.map((success) => success.fullName).sort()).to.deep.equal(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(state.maxRunning).to.equal(3);
    expect(fs.existsSync(path.join(outputDir, 'main', 'default', 'profiles', 'F.profile-meta.xml'))).to.be.true;
  });

  it('reads one call at a time with a concurrency of 1', async () => {
    const { conn, state } = recordingConnection(5);
    const outputDir = tempOutputDir();
    const outcome = await crudReadMetadatas({
      conn,
      componentSet: profileSet(['A', 'B', 'C']),
      outputDir,
      packageDirs: [outputDir],
      chunkSizeOverride: 1,
      commandThis,
      concurrency: 1,
      sleep: noSleep,
    });
    expect(outcome.successes).to.have.length(3);
    expect(state.maxRunning).to.equal(1);
  });

  it('reads a call again when the org pushed back', async () => {
    const calls: string[] = [];
    const conn: any = {
      metadata: {
        read: async (_type: string, fullNames: string[]) => {
          calls.push(fullNames.join(','));
          if (fullNames[0] === 'B' && calls.filter((call) => call === 'B').length === 1) {
            throw new Error('REQUEST_LIMIT_EXCEEDED: ConcurrentRequests (Concurrent API Requests) Limit exceeded.');
          }
          return fullNames.map((fullName) => ({ fullName, userLicense: 'Salesforce' }));
        },
      },
    };
    const outputDir = tempOutputDir();
    const outcome = await crudReadMetadatas({
      conn,
      componentSet: profileSet(['A', 'B', 'C']),
      outputDir,
      packageDirs: [outputDir],
      chunkSizeOverride: 1,
      commandThis,
      sleep: noSleep,
    });
    expect(outcome.failures).to.deep.equal([]);
    expect(outcome.successes).to.have.length(3);
    expect(calls.filter((call) => call === 'B')).to.have.length(2);
  });

  it('reports the components of a call that failed for good, and keeps the others', async () => {
    const conn: any = {
      metadata: {
        read: async (_type: string, fullNames: string[]) => {
          if (fullNames.includes('B')) {
            throw new Error('INVALID_CROSS_REFERENCE_KEY: broken');
          }
          return fullNames.map((fullName) => ({ fullName, userLicense: 'Salesforce' }));
        },
      },
    };
    const outputDir = tempOutputDir();
    const outcome = await crudReadMetadatas({
      conn,
      componentSet: profileSet(['A', 'B', 'C']),
      outputDir,
      packageDirs: [outputDir],
      chunkSizeOverride: 1,
      commandThis,
      sleep: noSleep,
    });
    expect(outcome.successes.map((success) => success.fullName).sort()).to.deep.equal(['A', 'C']);
    expect(outcome.failures).to.have.length(1);
    expect(outcome.failures[0]).to.include({ type: 'Profile', fullName: 'B', status: 'error' });
    expect(outcome.failures[0].error).to.contain('INVALID_CROSS_REFERENCE_KEY');
  });
});

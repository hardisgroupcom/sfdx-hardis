/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { soqlQuery, soqlQueryTooling, startQueryLog } from '../../../src/common/utils/apiUtils.js';
import { WebSocketClient } from '../../../src/common/websocketClient.js';

// Captures what uxLog writes to the log file (plain text, ANSI codes stripped)
function captureLogFile(): string[] {
  const lines: string[] = [];
  (globalThis as any).hardisLogFileStream = {
    write: (text: string) => {
      lines.push(text.trim());
    },
  };
  return lines;
}

describe('apiUtils queries', () => {
  let previousLogStream: any;

  beforeEach(() => {
    previousLogStream = (globalThis as any).hardisLogFileStream;
  });

  afterEach(() => {
    (globalThis as any).hardisLogFileStream = previousLogStream;
  });

  describe('startQueryLog', () => {
    it('creates a running query with a unique id', () => {
      const first = startQueryLog('soql');
      const second = startQueryLog('tooling');
      expect(first.status).to.equal('running');
      expect(first.type).to.equal('soql');
      expect(second.type).to.equal('tooling');
      expect(first.id).to.be.a('string').and.not.equal(second.id);
    });
  });

  describe('soqlQuery', () => {
    it('logs the query then the number of records retrieved across batches', async () => {
      const lines = captureLogFile();
      const conn: any = {
        query: async () => ({ done: false, nextRecordsUrl: '/next/1', records: [{ Id: '1' }, { Id: '2' }] }),
        queryMore: async () => ({ done: true, records: [{ Id: '3' }] }),
      };
      const res = await soqlQuery('SELECT Id FROM Account', conn);
      expect(res.records).to.have.length(3);
      expect(lines[0]).to.include('[SOQL Query] SELECT Id FROM Account');
      expect(lines[lines.length - 1]).to.include('[SOQL Query] Retrieved 3 records in 2 chunks(s)');
    });

    it('logs the failure then rethrows the error', async () => {
      const lines = captureLogFile();
      const conn: any = {
        query: async () => {
          throw new Error('INVALID_FIELD: No such column');
        },
      };
      let thrown: any = null;
      try {
        await soqlQuery('SELECT Nope FROM Account', conn);
      } catch (e) {
        thrown = e;
      }
      expect(thrown?.message).to.equal('INVALID_FIELD: No such column');
      expect(lines[lines.length - 1]).to.include('[SOQL Query] Query failed: INVALID_FIELD: No such column');
    });
  });

  describe('soqlQueryTooling', () => {
    it('logs the number of records retrieved', async () => {
      const lines = captureLogFile();
      const conn: any = {
        getApiVersion: () => '65.0',
        request: async () => ({ done: true, records: [{ Id: '1' }] }),
      };
      const res = await soqlQueryTooling('SELECT Id FROM ApexClass', conn);
      expect(res.records).to.have.length(1);
      expect(lines[lines.length - 1]).to.include('[SOQL Query Tooling] Retrieved 1 records');
    });
  });

  describe('WebSocketClient.sendCommandLogLineMessage', () => {
    let sent: any[];
    const originalSendMessage = WebSocketClient.sendMessage;

    beforeEach(() => {
      sent = [];
      WebSocketClient.sendMessage = (data: any) => {
        sent.push(data);
      };
    });

    afterEach(() => {
      WebSocketClient.sendMessage = originalSendMessage;
    });

    it('attaches the query description only when one is given', () => {
      WebSocketClient.sendCommandLogLineMessage('plain line', 'log');
      const query = { ...startQueryLog('soql'), status: 'completed' as const, recordCount: 12, batchCount: 1 };
      WebSocketClient.sendCommandLogLineMessage('[SOQL Query] Retrieved 12 records', 'log', false, false, query);
      expect(sent).to.have.length(2);
      expect(sent[0].event).to.equal('commandLogLine');
      expect(sent[0]).to.not.have.property('query');
      expect(sent[1].query).to.deep.equal(query);
      expect(sent[1].message).to.equal('[SOQL Query] Retrieved 12 records');
    });
  });
});

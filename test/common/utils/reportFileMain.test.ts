import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateCsvFile } from '../../../src/common/utils/filesUtils.js';
import { WebSocketClient } from '../../../src/common/websocketClient.js';

// Collect the reportFile messages sent while run() executes
async function captureReportFiles(run: () => unknown): Promise<any[]> {
  const originalSendMessage = WebSocketClient.sendMessage;
  const messages: any[] = [];
  try {
    WebSocketClient.sendMessage = (data: any) => {
      if (data.event === 'reportFile') {
        messages.push(data);
      }
    };
    await run();
  } finally {
    WebSocketClient.sendMessage = originalSendMessage;
  }
  return messages;
}

describe('main report of a command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-main-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('marks the main report, so the UI shows it before the other reports', async () => {
    const messages = await captureReportFiles(() =>
      WebSocketClient.sendReportFileMessage('/reports/main.csv', 'Main', 'report', undefined, { main: true })
    );
    expect(messages[0].main).to.equal(true);
  });

  it('sends no main flag for a secondary report', async () => {
    const messages = await captureReportFiles(() => WebSocketClient.sendReportFileMessage('/reports/detail.csv', 'Detail', 'report'));
    expect(messages[0]).to.not.have.property('main');
  });

  it('marks both the CSV and the Excel files of a main report', async () => {
    const messages = await captureReportFiles(() =>
      generateCsvFile([{ Name: 'A' }], path.join(tmpDir, 'main.csv'), { fileTitle: 'Main', mainReport: true })
    );
    expect(messages.map((message) => message.title)).to.deep.equal(['Main (CSV)', 'Main (XLSX)']);
    expect(messages.every((message) => message.main === true)).to.equal(true);
  });
});

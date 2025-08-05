import c from 'chalk';
import * as util from 'util';
import WebSocket from 'ws';
import { isCI, uxLog } from './utils/index.js';
import { SfError } from '@salesforce/core';

let globalWs: WebSocketClient | null;
let isWsOpen = false;
let userInput = "ui";

const PORT = process.env.SFDX_HARDIS_WEBSOCKET_PORT || 2702;

export class WebSocketClient {
  private ws: any;
  private wsContext: any;
  private promptResponse: any;

  constructor(context: any) {
    this.wsContext = context;
    const wsHostPort = context.websocketHostPort ? `ws://${context.websocketHostPort}` : `ws://localhost:${PORT}`;
    try {
      this.ws = new WebSocket(wsHostPort);
      globalWs = this; // eslint-disable-line
      this.start();
    } catch (err) {
      uxLog(
        this,
        c.yellow('Warning: Unable to start WebSocket client on ' + wsHostPort + '\n' + (err as Error).message)
      );
    }
  }

  static isAlive(): boolean {
    return !isCI && globalWs != null && isWsOpen === true;
  }

  static isAliveWithLwcUI(): boolean {
    return this.isAlive() && userInput === 'ui-lwc';
  }

  static sendMessage(data: any) {
    if (globalWs) {
      globalWs.sendMessageToServer(data);
    }
  }

  // Requests open file within VsCode if linked
  static requestOpenFile(file: string) {
    WebSocketClient.sendMessage({ event: 'openFile', file: file.replace(/\\/g, '/') });
  }

  // Send refresh status message
  static sendRefreshStatusMessage() {
    WebSocketClient.sendMessage({ event: 'refreshStatus' });
  }

  // Send refresh commands message
  static sendRefreshCommandsMessage() {
    WebSocketClient.sendMessage({ event: 'refreshCommands' });
  }

  // Send refresh plugins message
  static sendRefreshPluginsMessage() {
    WebSocketClient.sendMessage({ event: 'refreshPlugins' });
  }

  // Send command sub-command start message
  static sendCommandSubCommandStartMessage(command: string, cwd: string, options: any) {
    WebSocketClient.sendMessage({
      event: 'commandSubCommandStart',
      data: {
        command: command,
        cwd: cwd,
        options: options,
      },
    });
  }

  // Send command sub-command end message
  static sendCommandSubCommandEndMessage(command: string, cwd: string, options: any, success: boolean, result: any) {
    WebSocketClient.sendMessage({
      event: 'commandSubCommandEnd',
      data: {
        command: command,
        cwd: cwd,
        options: options,
        success: success,
        result: result,
      },
    });
  }

  // Send command log line message
  static sendCommandLogLineMessage(message: string, logType?: string, isQuestion?: boolean) {
    WebSocketClient.sendMessage({
      event: 'commandLogLine',
      logType: logType,
      message: message,
      isQuestion: isQuestion,
    });
  }

  // Send run SFDX Hardis command message
  static sendRunSfdxHardisCommandMessage(sfdxHardisCommand: string) {
    WebSocketClient.sendMessage({
      event: 'runSfdxHardisCommand',
      sfdxHardisCommand: sfdxHardisCommand,
    });
  }

  // Sends info about downloadable report file
  static sendReportFileMessage(file: string, title: string) {
    WebSocketClient.sendMessage({
      event: 'reportFile',
      file: file.replace(/\\/g, '/'),
      title: title,
    });
  }

  static sendPrompts(prompts: any): Promise<any> {
    if (globalWs) {
      return globalWs.promptServer(prompts);
    }
    throw new SfError('globalWs should be set in sendPrompts');
  }

  // Send close client message with status
  static sendCloseClientMessage(status?: string) {
    WebSocketClient.sendMessage({
      event: 'closeClient',
      status: status,
    });
  }

  // Close the WebSocket connection externally
  static closeClient(status?: string) {
    if (globalWs) {
      globalWs.dispose(status);
    }
  }

  start() {
    this.ws.on('open', () => {
      isWsOpen = true;
      this.ws.send(
        JSON.stringify({
          event: 'initClient',
          context: this.wsContext,
        })
      );
      // uxLog(this,c.grey('Initialized WebSocket connection with VsCode SFDX Hardis'));
    });

    this.ws.on('message', (data: any) => {
      this.receiveMessage(JSON.parse(data));
    });

    this.ws.on('error', (err) => {
      this.ws.terminate();
      globalWs = null;
      if (process.env.DEBUG) {
        console.error(err);
      }
    });
  }

  receiveMessage(data: any) {
    if (process.env.DEBUG) {
      console.debug('websocket: received: %s', util.inspect(data));
    }
    if (data.event === 'promptsResponse') {
      this.promptResponse = data.promptsResponse;
    }
    if (data.event === 'userInput') {
      userInput = data.userInput;
    }
  }

  sendMessageToServer(data: any) {
    data.context = this.wsContext;
    this.ws.send(JSON.stringify(data));
  }

  promptServer(prompts: any): Promise<any> {
    this.sendMessageToServer({ event: 'prompts', prompts: prompts });
    this.promptResponse = null;
    let ok = false;
    return new Promise((resolve, reject) => {
      let interval: any = null;
      let timeout: any = null;
      interval = setInterval(() => {
        if (this.promptResponse != null) {
          clearInterval(interval as NodeJS.Timeout);
          clearTimeout(timeout as NodeJS.Timeout);
          ok = true;
          resolve(this.promptResponse);
        }
      }, 300);
      timeout = setTimeout(() => {
        if (ok === false) {
          clearInterval(interval);
          reject('[sfdx-hardis] No response from UI WebSocket Server');
        }
      }, 7200000); // 2h timeout
    });
  }

  dispose(status?: string) {
    this.ws.send(
      JSON.stringify({
        event: 'closeClient',
        context: this.wsContext,
        status: status,
      })
    );
    this.ws.terminate();
    globalWs = null;
    // uxLog(this,c.grey('Closed WebSocket connection with VsCode SFDX Hardis'));
  }
}

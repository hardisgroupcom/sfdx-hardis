import c from 'chalk';
import * as util from 'util';
import WebSocket from 'ws';
import { isCI, uxLog } from './utils/index.js';
import { SfError } from '@salesforce/core';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  // Sends refresh pipeline message
  static sendRefreshPipelineMessage() {
    WebSocketClient.sendMessage({ event: 'refreshPipeline' });
  }

  // Sends info about downloadable report file
  static sendReportFileMessage(
    file: string,
    title: string,
    type: "actionCommand" | "actionUrl" | "report" | "docUrl"
  ) {
    WebSocketClient.sendMessage({
      event: 'reportFile',
      file: file.replace(/\\/g, '/'),
      title: title,
      type: type
    });
  }

  static sendPrompts(prompts: any): Promise<any> {
    if (globalWs) {
      return globalWs.promptServer(prompts);
    }
    throw new SfError('globalWs should be set in sendPrompts');
  }

  // Send close client message with status
  static sendCloseClientMessage(status?: string, error: any = null) {
    const message: any = {
      event: 'closeClient',
      context: globalWs?.wsContext,
      status: status,
    };
    if (error) {
      message.error = {
        type: error.type || 'unknown',
        message: error.message || 'An error occurred',
        stack: error.stack || '',
      };
    }
    WebSocketClient.sendMessage(message);
  }

  // Close the WebSocket connection externally
  static closeClient(status?: string) {
    if (globalWs) {
      globalWs.dispose(status);
    }
  }

  private getCommandDocUrl(): string | undefined {
    // Extract command from context to build documentation URL
    if (this.wsContext?.command) {
      const command = this.wsContext.command;
      // Convert command format like "hardis:doc:flow2markdown" to URL path
      const urlPath = command.replace(/:/g, '/');
      return `https://sfdx-hardis.cloudity.com/${urlPath}/`;
    }
    // Return undefined if no specific command
    return undefined;
  }

  async start() {
    this.ws.on('open', async () => {
      isWsOpen = true;
      const commandDocUrl = this.getCommandDocUrl();
      const message = {
        event: 'initClient',
        context: this.wsContext,
      } as any;
      if (commandDocUrl) {
        message.commandDocUrl = commandDocUrl;
      }
      // Dynamically import command class and send static uiConfig if present
      if (this.wsContext?.command) {
        try {
          // Convert command string to file path, e.g. hardis:cache:clear -> lib/commands/hardis/cache/clear.js
          const commandParts = this.wsContext.command.split(':');
          const commandPath = path.resolve(__dirname, '../../lib/commands', ...commandParts) + '.js';
          const fileUrl = 'file://' + commandPath.replace(/\\/g, '/');
          const imported = await import(fileUrl);
          const CommandClass = imported.default;
          if (process.env.NO_NEW_COMMAND_TAB === "true") {
            message.uiConfig = { hide: true };
          }
          else if (CommandClass && CommandClass.uiConfig) {
            message.uiConfig = CommandClass.uiConfig;
          }
        } catch (e) {
          uxLog(this, c.yellow(`Warning: Unable to import command class for ${this.wsContext.command}: ${e instanceof Error ? e.message : String(e)}`));
        }
      }
      this.ws.send(JSON.stringify(message));
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
    if (data.event === 'ping') {
      // Respond to ping messages to keep the connection alive
      this.ws.send(JSON.stringify({ event: 'pong' }));
    }
    else if (data.event === 'promptsResponse') {
      this.promptResponse = data.promptsResponse;
    }
    else if (data.event === 'userInput') {
      userInput = data.userInput;
    }
    else if (data.event === 'cancelCommand') {
      if (this.wsContext?.command === data?.context?.command && this.wsContext.id === data?.context?.id) {
        uxLog(this, c.red('Command cancelled by user'));
        process.exit(1);
      }
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

  dispose(status?: string, error: any = null) {
    WebSocketClient.sendCloseClientMessage(status, error);
    this.ws.terminate();
    globalWs = null;
    // uxLog(this,c.grey('Closed WebSocket connection with VsCode SFDX Hardis'));
  }
}

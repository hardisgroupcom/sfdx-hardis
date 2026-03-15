import c from 'chalk';
import * as util from 'util';
import WebSocket from 'ws';
import { isCI, uxLog } from './utils/index.js';
import { SfError } from '@salesforce/core';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONSTANTS } from '../config/index.js';
import { t } from './utils/i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let globalWs: WebSocketClient | null;
// isWsOpen and userInput are now stored on the instance to avoid module-instance isolation issues.
// See activeInstance getter below.

const PORT = process.env.SFDX_HARDIS_WEBSOCKET_PORT || 2702;

// Define allowed log types and type alias outside the class
export const LOG_TYPES = ['log', 'action', 'warning', 'error', 'success', 'table', "other"] as const;
export type LogType = typeof LOG_TYPES[number];

/** Context passed to the WebSocketClient constructor, identifying the running command and connection endpoint. */
export interface WebSocketClientContext {
  /** The command identifier, e.g. `"hardis:doc:flow2markdown"`. */
  command?: string;
  /** The process ID (or any unique identifier) for this client instance. */
  id?: number | string;
  /** Optional `host:port` override for the WebSocket server (e.g. `"localhost:2702"`). */
  websocketHostPort?: string;
  [key: string]: unknown;
}

export class WebSocketClient {
  private ws: any;
  private wsContext: WebSocketClientContext;
  private promptResponse: any;
  private isDead = false;
  private isInitialized = false;
  private userInput: string | null = null;

  /**
   * Returns the active WebSocketClient instance.
   * Falls back to globalThis.webSocketClient so that plugins importing this
   * module from a different package path (separate ES module cache entry) still
   * reach the instance created by sfdx-hardis's init hook.
   */
  private static get activeInstance(): WebSocketClient | null {
    return globalWs ?? ((globalThis as any).webSocketClient as WebSocketClient) ?? null;
  }

  constructor(context: WebSocketClientContext) {
    this.wsContext = context;
    const wsHostPort = context.websocketHostPort ? `ws://${context.websocketHostPort}` : `ws://localhost:${PORT}`;
    try {
      this.ws = new WebSocket(wsHostPort);
      globalWs = this; // eslint-disable-line
      this.start();
      console.log("WS Client started");
    } catch (err) {
      this.isDead = true;
      uxLog(
        "warning",
        this,
        c.yellow('Unable to start WebSocket client on ' + wsHostPort + '. ' + (err as Error).message)
      );
    }
  }

  static async isInitialized(): Promise<boolean> {
    const instance = WebSocketClient.activeInstance;
    if (instance) {
      let retries = 40; // Wait up to 10 seconds
      while (!instance.isInitialized && retries > 0 && !instance.isDead) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        retries--;
      }
      return instance.isInitialized;
    }
    return false;
  }

  static isAlive(): boolean {
    const instance = WebSocketClient.activeInstance;
    // readyState 1 === WebSocket.OPEN
    return !isCI && instance != null && instance.ws?.readyState === 1;
  }

  static isAliveWithLwcUI(): boolean {
    return WebSocketClient.isAlive() && WebSocketClient.activeInstance?.userInput === 'ui-lwc';
  }

  static sendMessage(data: any) {
    const instance = WebSocketClient.activeInstance;
    if (instance) {
      instance.sendMessageToServer(data);
    }
  }

  // Requests open file within VS Code if linked
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

  // Send progress start message
  static sendProgressStartMessage(title: string, totalSteps?: number) {
    WebSocketClient.sendMessage({
      event: 'progressStart',
      title: title || 'Progress',
      totalSteps: totalSteps || 0
    });
  }

  // Send progress step message
  static sendProgressStepMessage(step: number, totalSteps?: number) {
    WebSocketClient.sendMessage({
      event: 'progressStep',
      step: step,
      totalSteps: totalSteps
    });
  }

  // Send progress end message
  static sendProgressEndMessage(totalSteps?: number) {
    WebSocketClient.sendMessage({
      event: 'progressEnd',
      totalSteps: totalSteps
    });
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
  static sendCommandLogLineMessage(message: string, logType?: LogType, isQuestion?: boolean) {
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

  static sendRefreshDataWorkbenchMessage() {
    WebSocketClient.sendMessage({ event: 'refreshDataWorkbench' });
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
    const instance = WebSocketClient.activeInstance;
    if (instance) {
      return instance.promptServer(prompts);
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
    const instance = WebSocketClient.activeInstance;
    if (instance) {
      instance.dispose(status);
    }
  }

  private getCommandDocUrl(): string | undefined {
    // Extract command from context to build documentation URL
    if (this.wsContext?.command) {
      const command = this.wsContext.command;
      // Convert command format like "hardis:doc:flow2markdown" to URL path
      const urlPath = command.replace(/:/g, '/');
      return `${CONSTANTS.DOC_URL_ROOT}/${urlPath}/`;
    }
    // Return undefined if no specific command
    return undefined;
  }

  async start() {
    this.ws.on('open', async () => {
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
          const commandParts = this.wsContext.command.split(':');
          // Use the plugin root provided by the init hook when available (works for
          // third-party plugins), otherwise fall back to sfdx-hardis's own lib/commands.
          const pluginRoot = (this.wsContext as any).commandPluginRoot as string | undefined;
          const commandsBase = pluginRoot
            ? path.resolve(pluginRoot, 'lib/commands')
            : path.resolve(__dirname, '../../lib/commands');
          const commandPath = path.resolve(commandsBase, ...commandParts) + '.js';
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
          // Only warn for sfdx-hardis own commands – external plugins are not
          // expected to expose a command class file at the resolved path.
          if (this.wsContext.command.startsWith('hardis:')) {
            uxLog("warning", this, c.yellow(t('unableToImportCommandClassFor', { wsContext: this.wsContext.command, instanceof: e instanceof Error ? e.message : String(e) })));
          }
        }
      }
      // Add link to command log file
      if (globalThis?.hardisLogFileStream?.path) {
        const logFilePath = String(globalThis.hardisLogFileStream.path).replace(/\\/g, '/');
        message.commandLogFile = logFilePath;
      }
      this.ws.send(JSON.stringify(message));
      // uxLog("other", this, c.grey('Initialized WebSocket connection with VS Code SFDX Hardis.'));
    });

    this.ws.on('message', (data: any) => {
      this.receiveMessage(JSON.parse(data));
    });

    this.ws.on('error', (err) => {
      this.ws.terminate();
      globalWs = null;
      if ((globalThis as any).webSocketClient === this) {
        (globalThis as any).webSocketClient = null;
      }
      this.isDead = true;
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
      this.userInput = data.userInput;
      this.isInitialized = true;
    }
    else if (data.event === 'cancelCommand') {
      if (this.wsContext?.command === data?.context?.command && this.wsContext.id === data?.context?.id) {
        uxLog("error", this, c.red(t('commandCancelledByUser')));
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
    this.isDead = true;
    globalWs = null;
    if ((globalThis as any).webSocketClient === this) {
      (globalThis as any).webSocketClient = null;
    }
    // uxLog("other", this,c.grey('Closed WebSocket connection with VS Code SFDX Hardis'));
  }
}

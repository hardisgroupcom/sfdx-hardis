// PERF: this module must stay a "leaf": it is loaded by the init hook before
// the command boots so the VS Code extension gets feedback as early as
// possible. Do NOT import the common/utils barrel (or config/index.js) here:
// that would eagerly load 1000+ modules (langchain, puppeteer, jira, ...)
// before the WebSocket can even connect. Heavy helpers are dynamically
// imported in the rare code paths that need them.
import c from 'chalk';
import * as util from 'util';
import WebSocket from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONSTANTS } from '../config/constants.js';
import { t } from './utils/i18n.js';
import { isCI } from './utils/envUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let globalWs: WebSocketClient | null;
// isWsOpen and userInput are now stored on the instance to avoid module-instance isolation issues.
// See activeInstance getter below.

const PORT = process.env.SFDX_HARDIS_WEBSOCKET_PORT || 2702;
// Max wait for the extension to answer the initClient message
const INIT_TIMEOUT_MS = 10000;

// sfdx-hardis commands whose class declares `public static uiConfig = { hide: true }`.
// Keep in sync with those classes (a unit test enforces it). Listing them here
// lets initClient be sent without importing any command class: importing a
// heavy one used to delay the VS Code "Running" status by several seconds.
export const HIDDEN_PANEL_COMMANDS = new Set([
  'hardis:cache:clear',
  'hardis:work:ws',
]);

// Define allowed log types and type alias outside the class
export const LOG_TYPES = ['log', 'action', 'warning', 'error', 'success', 'table', "other"] as const;
export type LogType = typeof LOG_TYPES[number];

/**
 * Structured description of a query attached to a command log line, so the VS Code extension can
 * follow the query state (running, completed with its number of records, failed) without parsing
 * the log text. The same `id` links the start line to the completion (or failure) line.
 */
export interface CommandLogLineQuery {
  id: string;
  type: 'soql' | 'tooling' | 'bulk' | 'datacloud';
  status: 'running' | 'completed' | 'error';
  recordCount?: number;
  batchCount?: number;
}

/** One entry in a vscodeDiff message - describes a single file pair to open in a side-by-side diff editor. */
export interface OrgDiffItem {
  leftPath: string;
  rightPath: string;
  title: string;
  metadataType: string;
  metadataName: string;
  status: 'added' | 'modified' | 'deleted';
}

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
  // Resolved as soon as the extension answers the initClient message (or the
  // connection dies), so callers do not have to poll on a timer
  private initializedPromise: Promise<boolean> | null = null;
  private initializedResolve: ((value: boolean) => void) | null = null;
  private userInput: string | null = null;
  private extensionVersionResponse: string | null = null;

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
    this.initializedPromise = new Promise((resolve) => {
      this.initializedResolve = resolve;
    });
    const wsHostPort = context.websocketHostPort ? `ws://${context.websocketHostPort}` : `ws://localhost:${PORT}`;
    try {
      this.ws = new WebSocket(wsHostPort);
      globalWs = this; // eslint-disable-line
      this.start();
      console.log("WS Client started");
    } catch (err) {
      this.isDead = true;
      this.markInitialized(false);
      // Synchronous warning: the process may exit before a deferred log flushes
      console.warn(c.yellow('Unable to start WebSocket client on ' + wsHostPort + '. ' + (err as Error).message));
    }
  }

  private markInitialized(success: boolean): void {
    if (success) {
      this.isInitialized = true;
    }
    if (this.initializedResolve) {
      this.initializedResolve(success);
      this.initializedResolve = null;
    }
  }


  static async isInitialized(): Promise<boolean> {
    const instance = WebSocketClient.activeInstance;
    if (instance) {
      if (instance.isInitialized || instance.isDead) {
        return instance.isInitialized;
      }
      // Event-driven wait (resolved as soon as the extension answers) with a
      // 10s safety timeout. Fall back to polling when the active instance
      // comes from another module copy without initializedPromise.
      if (instance.initializedPromise) {
        let safetyTimer: NodeJS.Timeout | undefined;
        await Promise.race([
          instance.initializedPromise,
          new Promise((resolve) => {
            safetyTimer = setTimeout(resolve, INIT_TIMEOUT_MS);
          }),
        ]);
        // Clear the losing timer: a pending timeout would keep the process
        // alive up to 10s after fast commands complete
        if (safetyTimer) {
          clearTimeout(safetyTimer);
        }
        return instance.isInitialized;
      }
      let retries = INIT_TIMEOUT_MS / 250; // Wait up to 10 seconds
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

  // Best-effort request of the connected VS Code extension version.
  // Returns null when no VS Code extension is linked or when it does not answer in time.
  static async getExtensionVersion(): Promise<string | null> {
    const instance = WebSocketClient.activeInstance;
    if (!WebSocketClient.isAlive() || !instance) {
      return null;
    }
    return instance.requestExtensionVersion();
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

  // Requests VS Code to open one or more side-by-side diff editors via vscode.diff command
  static sendVscodeDiffMessage(diffs: OrgDiffItem[]) {
    WebSocketClient.sendMessage({
      event: 'vscodeDiff',
      diffs: diffs.map((d) => ({
        leftPath: d.leftPath.replace(/\\/g, '/'),
        rightPath: d.rightPath.replace(/\\/g, '/'),
        title: d.title,
        metadataType: d.metadataType,
        metadataName: d.metadataName,
        status: d.status,
      })),
    });
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
  static sendCommandLogLineMessage(message: string, logType?: LogType, isQuestion?: boolean, alwaysVisible?: boolean, query?: CommandLogLineQuery) {
    WebSocketClient.sendMessage({
      event: 'commandLogLine',
      logType: logType,
      message: message,
      isQuestion: isQuestion,
      alwaysVisible: alwaysVisible,
      // Only present on the log lines that describe a query start / completion / failure
      ...(query ? { query } : {}),
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
  // commandArgs is only used by the "actionCommand" type: it carries the arguments passed
  // to the VS Code command, so a button can deep-link into a specific panel section.
  static sendReportFileMessage(
    file: string,
    title: string,
    type: "actionCommand" | "actionUrl" | "report" | "docUrl",
    commandArgs?: any[]
  ) {
    const message: any = {
      event: 'reportFile',
      file: file.replace(/\\/g, '/'),
      title: title,
      type: type
    };
    if (type === 'actionCommand' && Array.isArray(commandArgs) && commandArgs.length > 0) {
      message.commandArgs = commandArgs;
    }
    WebSocketClient.sendMessage(message);
  }

  static sendPrompts(prompts: any): Promise<any> {
    const instance = WebSocketClient.activeInstance;
    if (instance) {
      return instance.promptServer(prompts);
    }
    throw new Error('globalWs should be set in sendPrompts');
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
      // Attach the command's static uiConfig when it has one.
      // PERF: never import an sfdx-hardis command class here. The initClient
      // message is what flips the VS Code panel from "Starting" to "Running",
      // and importing a heavy command class (hardis:work:new pulls the whole
      // utils tree) used to delay it by several seconds. sfdx-hardis's own
      // uiConfig values are known statically (HIDDEN_PANEL_COMMANDS below);
      // only third-party plugin commands still load their class to read it.
      if (this.wsContext?.command) {
        if (process.env.NO_NEW_COMMAND_TAB === "true") {
          message.uiConfig = { hide: true };
        }
        else if (HIDDEN_PANEL_COMMANDS.has(this.wsContext.command)) {
          message.uiConfig = { hide: true };
        }
        else if (!this.wsContext.command.startsWith('hardis:')) {
          try {
            const commandParts = this.wsContext.command.split(':');
            // Plugin root provided by the init hook (third-party plugins).
            const pluginRoot = (this.wsContext as any).commandPluginRoot as string | undefined;
            const commandsBase = pluginRoot
              ? path.resolve(pluginRoot, 'lib/commands')
              : path.resolve(__dirname, '../../lib/commands');
            const commandPath = path.resolve(commandsBase, ...commandParts) + '.js';
            const fileUrl = 'file://' + commandPath.replace(/\\/g, '/');
            const imported = await import(fileUrl);
            const CommandClass = imported.default;
            if (CommandClass && CommandClass.uiConfig) {
              message.uiConfig = CommandClass.uiConfig;
            }
          } catch {
            // External plugins are not expected to expose a command class
            // file at the resolved path: uiConfig is best-effort for them.
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
      this.markInitialized(false);
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
      this.markInitialized(true);
    }
    else if (data.event === 'extensionVersionResponse') {
      this.extensionVersionResponse = data.extensionVersion ?? 'unknown';
    }
    else if (data.event === 'cancelCommand') {
      if (this.wsContext?.command === data?.context?.command && this.wsContext.id === data?.context?.id) {
        // Synchronous logs: the process exits immediately, a deferred uxLog would never flush
        const cancelMsg = t('commandCancelledByUser');
        console.error(c.red(cancelMsg));
        try {
          (globalThis as any).hardisLogFileStream?.write(cancelMsg + "\n");
        } catch {
          // Log file stream is best-effort
        }
        process.exit(1);
      }
    }
  }

  sendMessageToServer(data: any) {
    data.context = this.wsContext;
    this.ws.send(JSON.stringify(data));
  }

  // Sends a getExtensionVersion request and waits (with a short timeout) for the response.
  // Resolves null on timeout so the caller never blocks on a missing/older extension.
  requestExtensionVersion(): Promise<string | null> {
    this.extensionVersionResponse = null;
    this.sendMessageToServer({ event: 'getExtensionVersion' });
    return new Promise((resolve) => {
      let interval: any = null;
      const timeout = setTimeout(() => {
        clearInterval(interval as NodeJS.Timeout);
        resolve(this.extensionVersionResponse);
      }, 5000);
      interval = setInterval(() => {
        if (this.extensionVersionResponse != null) {
          clearInterval(interval as NodeJS.Timeout);
          clearTimeout(timeout as NodeJS.Timeout);
          resolve(this.extensionVersionResponse);
        }
      }, 200);
    });
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
    // Only send closeClient on an OPEN socket: initClient is sent on 'open',
    // so a CONNECTING socket has nothing to close on the extension side, and
    // ws.send() would throw and abort the disposal
    try {
      if (this.ws?.readyState === 1) {
        WebSocketClient.sendCloseClientMessage(status, error);
      }
    } catch {
      // Disposal must never throw
    }
    try {
      this.ws?.terminate();
    } catch {
      // Socket may never have been created
    }
    this.isDead = true;
    this.markInitialized(false);
    globalWs = null;
    if ((globalThis as any).webSocketClient === this) {
      (globalThis as any).webSocketClient = null;
    }
    // uxLog("other", this,c.grey('Closed WebSocket connection with VS Code SFDX Hardis'));
  }
}

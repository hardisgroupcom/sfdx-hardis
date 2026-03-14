/**
 * sfdx-hardis Plugin API
 *
 * This module exposes the public API for sfdx-hardis plugins.
 * Plugins can import these utilities to integrate with the sfdx-hardis VS Code extension
 * via the shared WebSocket connection.
 *
 * Usage from a plugin:
 *   import { uxLog, prompts, WebSocketClient } from 'sfdx-hardis/plugin-api';
 *
 * The main sfdx-hardis CLI initializes the WebSocket connection.
 * Plugins reuse that connection automatically through the shared process globals.
 */

// WebSocket client for VS Code extension communication
export { WebSocketClient, LOG_TYPES } from './common/websocketClient.js';
export type { LogType, WebSocketClientContext } from './common/websocketClient.js';

// Prompt utilities (automatically routes through WebSocket when available)
export { prompts } from './common/utils/prompts.js';
export type { PromptsQuestion, PromptChoice } from './common/utils/prompts.js';

// Notification provider for sending notifications to Slack, MS Teams, Email, etc.
export { NotifProvider, UtilsNotifs } from './common/notifProvider/index.js';
export type { NotifMessage, NotifButton, NotifSeverity } from './common/notifProvider/types.js';

// Logging utilities
export { uxLog, uxLogTable } from './common/utils/index.js';

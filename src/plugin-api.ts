/**
 * sfdx-hardis Plugin API
 *
 * This module exposes the public API for sfdx-hardis plugins.
 * Plugins can import these utilities to integrate with the sfdx-hardis VS Code extension
 * via the shared WebSocket connection, to react to the events sfdx-hardis sends (a validation,
 * a deployment or an Apex test run is done), and to post their own Pull Request comments.
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

// CLI and Salesforce API helpers
export { execCommand, execSfdxJson } from './common/utils/index.js';
export {
  soqlQuery,
  soqlQueryTooling,
  bulkQuery,
  bulkQueryChunksIn,
  bulkQueryByChunks,
  bulkUpdate,
  bulkDelete,
  bulkDeleteTooling,
} from './common/utils/apiUtils.js';
export { generateCsvFile } from './common/utils/filesUtils.js';

// Events sent by sfdx-hardis to the plugins that declare them under oclif.hooks in their package.json
export type {
  SfdxHardisEvent,
  SfdxHardisEventName,
  SfdxHardisEventDataMap,
  SfdxHardisEventHookOptions,
  SfdxHardisEventPullRequest,
  SfdxHardisRunEvent,
  SfdxHardisRunEventName,
  SalesforceRunEventData,
} from './common/utils/pluginEventUtils.js';

// Pull Request comment of a plugin, posted through the git provider sfdx-hardis already set up
export { postPullRequestComment } from './common/gitProvider/pluginPullRequestComment.js';
export type { PluginPullRequestCommentRequest, PluginPullRequestCommentResult } from './common/gitProvider/pluginPullRequestComment.js';

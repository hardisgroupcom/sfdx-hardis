// Re-export plugin API for consumers using sfdx-hardis as a dependency
export { WebSocketClient, LOG_TYPES } from './common/websocketClient.js';
export type { LogType } from './common/websocketClient.js';
export { prompts } from './common/utils/prompts.js';
export type { PromptsQuestion } from './common/utils/prompts.js';
export { NotifProvider, UtilsNotifs } from './common/notifProvider/index.js';
export type { NotifMessage, NotifButton, NotifSeverity } from './common/notifProvider/types.js';
export { uxLog } from './common/utils/index.js';

import fs from 'fs-extra';
import * as path from 'path';
import c from 'chalk';
import { uxLog } from '../utils/index.js';
import type { NotifMessage } from './types.js';
import { t } from '../utils/i18n.js';

/**
 * Write a NotifMessage to a JSON file in the monitoring notifications output directory.
 * Called by NotifProvider.postNotifications() when MONITORING_NOTIF_OUTPUT_DIR is set.
 */
export async function writeMonitoringNotifFile(outputDir: string, notifMessage: NotifMessage): Promise<void> {
  try {
    await fs.ensureDir(outputDir);
    // Strip attachedFiles (binary paths) and logElements (verbose) to keep files small
    const sanitized = {
      text: notifMessage.text,
      type: notifMessage.type,
      severity: notifMessage.severity,
      data: notifMessage.data,
      metrics: notifMessage.metrics,
    };
    const fileName = `${notifMessage.type}_${Date.now()}.json`;
    await fs.writeJson(path.join(outputDir, fileName), sanitized, { spaces: 2 });
  } catch (e) {
    uxLog("warning", null, c.yellow(t('monitoringNotifWriteError', { message: (e as Error).message })));
  }
}

/**
 * Read all notification JSON files from the monitoring notifications directory.
 * Returns an array of sanitized NotifMessage-like objects.
 */
export async function collectMonitoringNotifications(outputDir: string): Promise<any[]> {
  const notifications: any[] = [];
  if (!(await fs.pathExists(outputDir))) {
    return notifications;
  }
  const files = await fs.readdir(outputDir);
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    try {
      const content = await fs.readJson(path.join(outputDir, file));
      notifications.push(content);
    } catch (e) {
      uxLog("warning", null, c.yellow(t('monitoringNotifReadError', { file, message: (e as Error).message })));
    }
  }
  return notifications;
}

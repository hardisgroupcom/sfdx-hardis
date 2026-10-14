import { setConnectionVariables } from './orgUtils.js';
import { getNotificationButtons, getOrgMarkdown } from './notifUtils.js';

/** Sets connection globals, then loads org markdown and notification action buttons for diagnose/monitor commands. */
export async function prepareOrgNotificationContext(conn: any): Promise<{
  orgMarkdown: string;
  notifButtons: { text: string; url: string }[];
}> {
  await setConnectionVariables(conn);
  const orgMarkdown = await getOrgMarkdown(conn?.instanceUrl);
  const notifButtons = await getNotificationButtons();
  return { orgMarkdown, notifButtons };
}

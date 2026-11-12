/**
 * Pull Request comments posted by sf plugins, through the git provider sfdx-hardis already set up.
 *
 * The message key of a plugin comment always starts with plugin-<pluginName>-: a plugin can not
 * overwrite a comment of sfdx-hardis, and the navigation between the sfdx-hardis comments ignores
 * it, as it does for the Flow diff comments.
 */
import c from 'chalk';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';
import { isMajorBranchCheckMode } from '../utils/majorBranchCheckUtils.js';
import { GitProvider } from './index.js';

export type PluginPullRequestCommentRequest = {
  // npm name of the plugin, part of the message key of the comment
  pluginName: string;
  // Key of the comment for the plugin: a later call with the same key updates the same comment
  messageKey: string;
  title: string;
  markdown: string;
  status?: 'valid' | 'invalid' | 'tovalidate';
};

export type PluginPullRequestCommentResult = {
  posted: boolean;
  reason?: 'invalid-request' | 'major-branch-check' | 'no-git-provider' | 'not-posted';
};

/**
 * Create, or update when it exists, the comment of a plugin in the current Pull Request.
 * Never throws: when the comment can not be posted, posted is false and reason says why.
 */
export async function postPullRequestComment(request: PluginPullRequestCommentRequest): Promise<PluginPullRequestCommentResult> {
  const pluginSlug = toKeySlug(request?.pluginName);
  const keySlug = toKeySlug(request?.messageKey);
  if (pluginSlug === '' || keySlug === '') {
    uxLog("warning", null, c.yellow(t('pluginCommentInvalidRequest')));
    return { posted: false, reason: 'invalid-request' };
  }
  // The provider post methods look the Pull Request up by themselves: a major branch check would
  // comment the Pull Request merged last on the branch
  if (isMajorBranchCheckMode()) {
    uxLog("log", null, c.grey('[Git Provider] ' + t('majorBranchCheckSkippingPrComment')));
    return { posted: false, reason: 'major-branch-check' };
  }
  try {
    const gitProvider = await GitProvider.getInstance();
    if (gitProvider == null) {
      uxLog("log", null, c.grey(t('pluginCommentNoGitProvider', { plugin: request.pluginName })));
      return { posted: false, reason: 'no-git-provider' };
    }
    const postResult = await gitProvider.tryPostPullRequestMessage({
      title: request.title || request.pluginName,
      message: request.markdown || '',
      status: request.status || 'valid',
      messageKey: buildPluginMessageKey(request.pluginName, request.messageKey),
    });
    return postResult?.posted === true ? { posted: true } : { posted: false, reason: 'not-posted' };
  } catch (e) {
    uxLog("warning", null, c.yellow(t('pluginCommentNotPosted', { plugin: request.pluginName, message: (e as Error).message })));
    return { posted: false, reason: 'not-posted' };
  }
}

export function buildPluginMessageKey(pluginName: string, messageKey: string): string {
  return `plugin-${toKeySlug(pluginName)}-${toKeySlug(messageKey)}`;
}

// Lower case letters, digits and hyphens only: @scope/my_plugin gives scope-my-plugin
function toKeySlug(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

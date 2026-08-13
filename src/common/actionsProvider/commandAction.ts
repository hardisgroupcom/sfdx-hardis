import { ActionsProvider, ActionResult, PrePostCommand, buildActionOutput } from './actionsProvider.js';
import { execCommand, getCurrentGitBranch, isCI, uxLog } from '../utils/index.js';
import { AuthOrgOptions, authOrg, safeDeleteAuthTempFile } from '../utils/authUtils.js';
import { GitProvider } from '../gitProvider/index.js';
import { t } from '../utils/i18n.js';
import c from 'chalk';

// Commands that refresh their Salesforce session mid-run using the JWT bearer flow, which
// re-reads the certificate key file whose path the SF CLI stored at login. For these we must
// re-authenticate keeping the certificate file available during execution, then delete it.
// Matched with a substring "contains" check so chained commands are also detected
// (for example "sf agent publish ... && sf agent activate ...").
export const COMMANDS_REQUIRING_CERT_KEEP_ALIVE = ['sf agent'];

export function commandNeedsCertKeepAlive(command: string): boolean {
  return !!command && COMMANDS_REQUIRING_CERT_KEEP_ALIVE.some((pattern) => command.includes(pattern));
}

export class CommandAction extends ActionsProvider {
  public getLabel(): string {
    return 'CommandAction';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    const command = cmd.command;
    if (!command) {
      uxLog('error', this, c.red(`[DeploymentActions] No command provided for action [${cmd.id}]: ${cmd.label}`));
      return { statusCode: 'failed', skippedReason: 'No command provided' } as ActionResult;
    }
    return null;
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;
    cmd.command = cmd.command + (this.customUsernameToUse ? ` --target-org ${this.customUsernameToUse}` : '');

    // For cert-dependent commands in CI, re-authenticate keeping the JWT certificate file
    // available during execution, then delete it whatever the command outcome.
    const keptCertFilePath =
      isCI && commandNeedsCertKeepAlive(cmd.command) ? await this.reauthKeepingCertFile() : null;
    try {
      const res = await execCommand(cmd.command, null, { fail: false, output: true });
      return { statusCode: res.status === 0 ? 'success' : 'failed', output: buildActionOutput(res) };
    } finally {
      if (keptCertFilePath) {
        await safeDeleteAuthTempFile(keptCertFilePath);
        uxLog('other', this, c.grey(`[DeploymentActions] Deleted temporary certificate file ${keptCertFilePath}`));
      }
    }
  }

  private async resolveReauthOrgAlias(): Promise<string> {
    const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
    return prInfo?.targetBranch || (await getCurrentGitBranch({ formatted: true })) || '';
  }

  // Best-effort re-authentication that keeps the certificate file. Returns the kept certificate
  // file path (even if login threw, so a partially created file is still cleaned up), or null.
  private async reauthKeepingCertFile(): Promise<string | null> {
    const authOptions: AuthOrgOptions = { checkAuth: true, keepCertFile: true };
    if (this.customUsernameToUse) {
      // The command already targets this user via an explicit --target-org, so keep the
      // existing default org untouched.
      authOptions.forceUsername = this.customUsernameToUse;
      authOptions.setDefault = false;
    } else {
      // No explicit target org on the command: re-authenticate as the default org so the
      // command (for example "sf agent ...") finds it.
      authOptions.setDefault = true;
    }
    try {
      const orgAlias = await this.resolveReauthOrgAlias();
      uxLog('log', this, c.grey('[DeploymentActions] ' + t('reauthenticatingBeforeCommandAction')));
      await authOrg(orgAlias, authOptions);
    } catch (e) {
      uxLog(
        'warning',
        this,
        c.yellow('[DeploymentActions] ' + t('reauthBeforeCommandActionFailed', { error: (e as Error).message }))
      );
    }
    return authOptions.keptCertFilePath || null;
  }
}

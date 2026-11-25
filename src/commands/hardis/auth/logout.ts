/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { AuthRemover, Connection, Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import { t } from '../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class Logout extends SfCommand<any> {
  public static title = 'Logout';

  public static description = `
## Command Behavior

**Revokes, in the Salesforce org, the session that the CI/CD job opened with \`hardis:auth:login\`.**

Each JWT login (External Client App or Connected App) opens a new OAuth session for the integration user. Salesforce keeps it alive until it times out, so a pipeline that runs often can reach a concurrent sessions limit (for example a login flow that blocks a user above 10 sessions).

Run this command as the last step of the job to end the session right away:

- Only the access token stored for \`--target-org\` is revoked. Other sessions of the same user (other jobs, other pipelines) are not touched.
- By default the local SF CLI auth of the org is removed too. Use \`--no-remove-local\` to keep it.
- By default a failure only prints a warning so it never breaks a successful deployment. Use \`--fail-on-error\` to make it fail the job.

Run it even when the deployment fails, since a failed job still holds a session: in GitLab put it in \`after_script\`, in GitHub Actions use \`if: always()\`. A later job that logs in again opens a new session and needs its own logout step.

<details markdown="1">
<summary>Technical explanations</summary>

- The sfdx-hardis prerun authentication hook is skipped for this command: logging in again would open a new session. Without \`--target-org\`, the default org set by \`hardis:auth:login\` is used.
- Reads the access token stored by the login step for the target org.
- Calls \`POST <instanceUrl>/services/oauth2/revoke\` with \`token=<accessToken>\`, which ends the matching session in the org.
- Calls \`AuthRemover.removeAuth(username)\` from \`@salesforce/core\` to remove the local auth file.

</details>
`;

  public static examples = [
    '$ sf hardis:auth:logout',
    '$ sf hardis:auth:logout --target-org my-org-alias',
    '$ sf hardis:auth:logout --target-org my-org-alias --no-remove-local --fail-on-error',
  ];

  public static flags: any = {
    'remove-local': Flags.boolean({
      default: true,
      allowNo: true,
      description: 'Also remove the local SF CLI auth of the org after the session is revoked',
    }),
    'fail-on-error': Flags.boolean({
      default: false,
      description: 'Fail the command if the session cannot be revoked (by default only a warning is shown)',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(Logout);
    const org = flags['target-org'];
    const conn: Connection = org.getConnection();
    const username = org.getUsername() as string;
    const accessToken = conn.accessToken;

    if (!accessToken) {
      return this.handleError(flags['fail-on-error'], t('authLogoutNoAccessToken', { username }));
    }

    uxLog("action", this, c.cyan(t('authLogoutRevokingSession', { username: c.bold(username), instanceUrl: conn.instanceUrl })));
    try {
      const response = await fetch(`${conn.instanceUrl}/services/oauth2/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: accessToken }).toString(),
      });
      if (!response.ok) {
        const body = await response.text();
        return this.handleError(flags['fail-on-error'], t('authLogoutRevokeHttpError', { status: response.status, body }));
      }
    } catch (e) {
      return this.handleError(flags['fail-on-error'], t('authLogoutRevokeError', { message: (e as Error).message }));
    }
    uxLog("success", this, c.green(t('authLogoutSessionRevoked', { username })));

    if (flags['remove-local']) {
      const remover = await AuthRemover.create();
      await remover.removeAuth(username);
      uxLog("log", this, c.grey(t('authLogoutLocalAuthRemoved', { username })));
    }

    return { status: 0, revoked: true, username };
  }

  private handleError(failOnError: boolean, message: string): AnyJson {
    if (failOnError) {
      throw new SfError(message);
    }
    uxLog("warning", this, c.yellow(message));
    return { status: 0, revoked: false, message };
  }
}

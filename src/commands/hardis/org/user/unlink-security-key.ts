/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { generateReports, isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { soqlQuery } from '../../../../common/utils/apiUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import {
  MFA_METHODS,
  UnlinkMethodKey,
  UnlinkMethodSpec,
  UnlinkTarget,
  unlinkUserSecurityKeys,
} from '../../../../common/utils/orgUserUnlinkUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgUserUnlinkSecurityKey extends SfCommand<any> {
  public static title = 'Unlink user security keys / MFA methods';

  public static description = `
## Command Behavior

**Disconnects MFA registrations (default: Security Key / U2F + WebAuthn) from selected Salesforce users by driving a real browser session against Salesforce Setup.**

This command automates the manual admin procedure documented at https://help.salesforce.com/s/articleView?id=xcloud.security_u2f_remove_users_security_key.htm so administrators can revoke a lost or compromised security key for multiple users at once.

Key functionalities:

- **User selection:** Provide a comma-separated list of usernames via \`--usernames\`. In interactive mode, you will be prompted if the flag is missing.
- **Method selection (opt-in):** Security Key (U2F + WebAuthn combined) is removed by default. Use \`--include-salesforce-authenticator\` or \`--include-totp\` to also disconnect those methods. Use \`--no-include-security-key\` to skip the security-key removal when combining with other methods.
- **Inactive users are skipped:** Inactive users (\`IsActive = false\`) are reported with status \`inactive\` and no browser action is attempted for them.
- **Per-user result:** Each username receives one of the following statuses: \`unlinked\`, \`notLinked\`, \`notFound\`, \`inactive\`, or \`error\`.
- **Locale-independent detection:** Disconnect links are located by the brand / spec tokens (\`U2F\`, \`WebAuthn\`, \`Salesforce Authenticator\`, \`One-Time Password Authenticator\`, \`TOTP\`) that Salesforce does not translate, plus known French section labels and removal-action words (\`Supprimer\`, \`Déconnecter\`), so English and French orgs work out of the box. For other languages, extend the matching set with \`--text-markers\`.
- **Reporting:** A console table summarises the run, and CSV / XLSX reports are generated for audit trails.
- **Notifications:** Sends a notification (Slack, Microsoft Teams, email, API/Grafana) summarising which users had MFA methods unlinked, so security admins are alerted. Routing thresholds follow the \`SECURITY_KEY_UNLINK\` notification type configuration.

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:user:unlink-security-key --agent --usernames 'a@x.com,b@x.com' --target-org my-admin@myorg.com
\`\`\`

In agent mode:

- The confirmation prompt is skipped and the unlink procedure starts immediately.
- You must provide \`--usernames\` (the interactive prompt is not available).
- Method selection flags default to Security Key only unless you opt in.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Pre-query:** Runs \`SELECT Id, Username, IsActive, Name FROM User WHERE Username IN (...)\` to resolve each username to a User Id. Missing rows produce \`notFound\`; inactive rows are short-circuited to \`inactive\` without launching the browser.
- **Puppeteer automation:** Reuses \`puppeteer-core\` with the chrome path resolved by \`getChromeExecutablePath()\` and logs in to the org via \`secur/frontdoor.jsp?sid=<accessToken>\`, identical to the existing \`hardis:org:fix:listviewmine\` flow.
- **Locale-independent row matching:** For each MFA method the command navigates to the user detail page (\`/lightning/setup/ManageUsers/page?address=%2F<USER_ID>%3Fnoredirect%3D1%26isUserEntityOverride%3D1\`), waits for the inner Classic-style iframe, scans rows for a brand / spec marker (\`U2F\`, \`WebAuthn\`, \`Salesforce Authenticator\`, \`One-Time Password Authenticator\`, \`TOTP\`, etc.) and clicks the removal link in that row only.
- **Removal vs registration:** When a method is not connected, the same row shows a registration link instead (id \`AddU2FOrWebAuthn\`, label \`Register\` / \`Inscrire\`, navigating to \`registrationInterstitial.apexp\`). The command only clicks genuine removal links (id \`DisableU2FOrWebAuthn\`, the \`deleteredirect.jsp\` URL, or label \`Remove\` / \`Retirer\`) and reports \`notLinked\` otherwise, so it never enrolls a new key by mistake.
- **Salesforce labels reference (en / fr):** \`Security Key (U2F or WebAuthn)\` / \`Clé de sécurité (U2F ou WebAuthn)\` with a \`Remove\` / \`Retirer\` link, \`App Registration: Salesforce Authenticator\` (Disconnect), \`App Registration: One-Time Password Authenticator\` (Disconnect).
- **Reporting:** Generates CSV and XLSX files (\`users-security-key-unlink-<date>\`) via \`generateReports\` and prints a console table via \`uxLogTable\`.

Reference: [Salesforce Help - Remove a user's security key](https://help.salesforce.com/s/articleView?id=xcloud.security_u2f_remove_users_security_key.htm).
</details>
`;

  public static examples = [
    "$ sf hardis:org:user:unlink-security-key",
    "$ sf hardis:org:user:unlink-security-key --usernames 'a@x.com,b@x.com'",
    "$ sf hardis:org:user:unlink-security-key --usernames 'a@x.com' --include-salesforce-authenticator --include-totp",
    "$ sf hardis:org:user:unlink-security-key --usernames 'a@x.com' --no-include-security-key --include-totp",
    "$ sf hardis:org:user:unlink-security-key --agent --usernames 'a@x.com,b@x.com'",
    "$ sf hardis:org:user:unlink-security-key --usernames 'a@x.com' --text-markers '{\"salesforceAuthenticator\":[\"Authentificateur Salesforce\"]}'",
  ];

  public static flags: any = {
    usernames: Flags.string({
      char: 'u',
      description: 'Comma-separated list of Salesforce usernames whose security keys should be unlinked',
    }),
    'include-security-key': Flags.boolean({
      default: true,
      allowNo: true,
      description:
        'Unlink the Security Key (U2F + WebAuthn combined) registration (default: true). Use --no-include-security-key to skip.',
    }),
    'include-salesforce-authenticator': Flags.boolean({
      default: false,
      description: 'Also unlink the Salesforce Authenticator mobile app registration',
    }),
    'include-totp': Flags.boolean({
      default: false,
      description: 'Also unlink the One-Time Password Authenticator (TOTP) registration',
    }),
    'text-markers': Flags.string({
      description:
        'JSON object adding text markers per method, useful on non-English orgs. Example: --text-markers \'{"salesforceAuthenticator":["Authentificateur Salesforce"]}\'',
    }),
    'dump-anchors': Flags.boolean({
      default: false,
      description: 'Diagnostic: print every anchor found on each user detail page (use with --debug to refine markers)',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  protected debugMode = false;
  protected agentMode = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgUserUnlinkSecurityKey);
    this.debugMode = flags.debug || false;
    this.agentMode = flags.agent === true;

    let usernameList: string[] = flags.usernames
      ? flags.usernames.split(',').map((u: string) => u.trim()).filter((u: string) => u)
      : [];

    if (usernameList.length === 0) {
      if (isCI || this.agentMode) {
        throw new SfError(
          c.red('In agent/CI mode, the --usernames flag is required for unlink-security-key operation.')
        );
      }
      const promptRes = await prompts({
        type: 'text',
        name: 'value',
        message: t('enterUsernamesToUnlink'),
        description: t('unlinkSecurityKeyConfirmDescription'),
      });
      usernameList = (promptRes.value || '')
        .split(',')
        .map((u: string) => u.trim())
        .filter((u: string) => u);
      if (usernameList.length === 0) {
        const outputString = 'No usernames provided. Script cancelled.';
        uxLog('warning', this, c.yellow(outputString));
        return { outputString };
      }
    }

    /* Parse optional --text-markers override (extra markers merged per method) */
    let extraMarkers: Record<string, string[]> = {};
    if (flags['text-markers']) {
      try {
        const parsed = JSON.parse(flags['text-markers']);
        if (parsed && typeof parsed === 'object') {
          extraMarkers = parsed as Record<string, string[]>;
        }
      } catch (e: any) {
        throw new SfError(c.red(`Invalid --text-markers JSON: ${e.message}`));
      }
    }

    const requestedMethodKeys: UnlinkMethodKey[] = [];
    if (flags['include-security-key']) requestedMethodKeys.push('securityKey');
    if (flags['include-salesforce-authenticator']) requestedMethodKeys.push('salesforceAuthenticator');
    if (flags['include-totp']) requestedMethodKeys.push('totp');

    if (requestedMethodKeys.length === 0) {
      throw new SfError(
        c.red('At least one MFA method must be selected (use --include-security-key or one of the --include-* flags).')
      );
    }

    const methods: UnlinkMethodSpec[] = requestedMethodKeys.map((k) => {
      const base = MFA_METHODS[k];
      const extras = extraMarkers[k] || [];
      return extras.length > 0
        ? { ...base, sectionTextMarkers: [...base.sectionTextMarkers, ...extras] }
        : base;
    });

    const conn = flags['target-org'].getConnection();
    uxLog('action', this, c.cyan(t('unlinkSecurityKeyQueryingUsers', { count: c.bold(usernameList.length) })));
    const usernamesConstraint = usernameList.map((u) => `'${u}'`).join(',');
    const userQuery = `SELECT Id,Name,Username,IsActive FROM User WHERE Username IN (${usernamesConstraint})`;
    const userQueryRes = await soqlQuery(userQuery, conn);
    const foundByUsername: Record<string, any> = {};
    for (const rec of userQueryRes.records as any[]) {
      foundByUsername[rec.Username] = rec;
    }

    const targets: UnlinkTarget[] = usernameList.map((username) => {
      const rec = foundByUsername[username];
      if (!rec) {
        return { username, userId: null, isActive: false, preStatus: 'notFound' as const };
      }
      if (rec.IsActive === false) {
        return { username, userId: rec.Id, isActive: false, name: rec.Name, preStatus: 'inactive' as const };
      }
      return { username, userId: rec.Id, isActive: true, name: rec.Name, preStatus: 'pending' as const };
    });

    uxLogTable(
      this,
      targets.map((t2) => ({
        Username: t2.username,
        UserId: t2.userId || '',
        IsActive: t2.isActive ? 'true' : 'false',
        PreStatus: t2.preStatus,
      }))
    );

    if (!isCI && !this.agentMode) {
      const confirmRes = await prompts({
        type: 'confirm',
        name: 'value',
        initial: true,
        message: c.cyanBright(
          t('confirmUnlinkSecurityKey', {
            count: targets.length,
            orgUsername: flags['target-org'].getUsername(),
          })
        ),
        description: t('unlinkSecurityKeyConfirmDescription'),
      });
      if (confirmRes.value !== true) {
        const outputString = 'Script cancelled by user.';
        uxLog('warning', this, c.yellow(outputString));
        return { outputString };
      }
    }

    uxLog('action', this, c.cyan(t('unlinkSecurityKeyLaunchingBrowser')));
    const results = await unlinkUserSecurityKeys(targets, conn, methods, {
      debug: this.debugMode,
      dumpAnchors: flags['dump-anchors'] === true,
    });

    const summary = {
      unlinked: 0,
      notLinked: 0,
      notFound: 0,
      inactive: 0,
      error: 0,
    };
    for (const r of results) {
      summary[r.status] = (summary[r.status] || 0) + 1;
    }

    const tableRows = results.map((r) => ({
      Username: r.username,
      UserId: r.userId || '',
      Status: r.status,
      Unlinked: r.methodsUnlinked.join(', '),
      NotLinked: r.methodsNotLinked.join(', '),
      Message: r.message,
    }));
    uxLogTable(this, tableRows);
    uxLog('success', this, c.green(t('unlinkSecurityKeySummary', summary)));

    const reportResult = await generateReports(tableRows, ['Username', 'UserId', 'Status', 'Unlinked', 'NotLinked', 'Message'], this, {
      logFileName: 'users-security-key-unlink',
      logLabel: 'Unlink security key report',
    });

    // Send notifications (Slack / Teams / email / API) about the MFA methods that have been unlinked
    const orgMarkdown = await getOrgMarkdown(conn.instanceUrl);
    const notifButtons = await getNotificationButtons();
    let notifSeverity: NotifSeverity = 'log';
    let notifText = t('unlinkSecurityKeyNotifNone', { orgMarkdown });
    if (summary.error > 0) {
      notifSeverity = 'error';
      notifText = t('unlinkSecurityKeyNotifErrors', { errorCount: summary.error, unlinkedCount: summary.unlinked, orgMarkdown });
    } else if (summary.unlinked > 0) {
      notifSeverity = 'warning';
      notifText = t('unlinkSecurityKeyNotifUnlinked', { unlinkedCount: summary.unlinked, orgMarkdown });
    }
    let notifDetailText = '';
    for (const r of results.filter((res) => res.status === 'unlinked' || res.status === 'error')) {
      notifDetailText += `- ${r.username}: ${r.status}${r.methodsUnlinked.length > 0 ? ` (${r.methodsUnlinked.join(', ')})` : ''}${r.message ? ` - ${r.message}` : ''}\n`;
    }
    const notifAttachments = notifDetailText ? [{ text: notifDetailText }] : [];
    const xlsxFile = (reportResult.find((res) => res.type === 'xls') || {}).file;

    await setConnectionVariables(conn); // Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'SECURITY_KEY_UNLINK',
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: xlsxFile ? [xlsxFile] : [],
      logElements: tableRows,
      data: { metric: summary.unlinked },
      metrics: {
        SecurityKeyUnlinkUnlinked: summary.unlinked,
        SecurityKeyUnlinkErrors: summary.error,
      },
    });

    return {
      orgId: flags['target-org'].getOrgId(),
      results: results as any,
      summary,
      outputString: t('unlinkSecurityKeySummary', summary),
    } as any;
  }
}

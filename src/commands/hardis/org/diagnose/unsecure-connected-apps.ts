/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { buildConnectedAppsUsage, collectOAuthTokensWithStatus } from '../../../../common/utils/connectedAppsUsageUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { CONSTANTS, getConfig, getEnvVarList, setConfig } from '../../../../config/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import sortArray from '../../../../common/utils/sortArray.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { t } from '../../../../common/utils/i18n.js';
import { stripSensitiveValues } from '../../../../common/utils/anonymizeUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class UnsecuredConnectedApps extends SfCommand<any> {
  public static title = 'Detect Unsecured Connected Apps';

  public static description = `
## Command Behavior

**Detects unsecured Connected Apps and External Client Apps in a Salesforce org and generates detailed reports for security analysis.**

This command is a critical security diagnostic tool that helps administrators identify Connected Apps and External Client Apps that may pose security risks due to improper OAuth authorization configuration. It provides comprehensive analysis of OAuth tokens and app security settings to ensure proper access control.

Key functionalities:

- **OAuth Token Analysis:** Queries all OAuth tokens in the org using SOQL to retrieve comprehensive token information including app names, users, authorization status, and usage statistics.
- **Connected App and External Client App Coverage:** Checks both Connected Apps (via \`AppMenuItem.IsUsingAdminAuthorization\`) and External Client Apps (via \`ExtlClntAppOauthPlcyCnfg.PermittedUsersPolicyType\`) for proper admin pre-approval settings.
- **App Type Column:** Each report row includes an \`App Type\` column indicating whether the app is a \`Connected App\`, an \`Ext Client App\`, or an \`Ext Client App (converted)\`.
- **Converted Connected Apps:** A Connected App migrated to an External Client App stays in the org as a read-only copy that Salesforce no longer uses for authentication, while its existing OAuth tokens still point to it. When an External Client App with the same name exists, the tokens are evaluated against the External Client App OAuth policy instead of the stale Connected App settings, so a properly secured migration is not reported as unsecured. If that External Client App has no OAuth policy record (or the org does not expose \`ExtlClntAppOauthPlcyCnfg\`), the Connected App settings are kept and the app is listed in a warning, so a secured Connected App is never reported as unsecured because of a missing policy.
- **AppName-based Fallback Matching:** When an OAuth token has no \`AppMenuItem\` link (common for External Client App tokens, and for Connected App tokens issued before the app was reinstalled), the command falls back to matching by \`AppName\` against \`ExternalClientApplication.MasterLabel\` or \`DeveloperName\`, then against \`ConnectedApplication.Name\`. The Connected App setting \`OptionsAllowAdminApprovedUsersOnly\` ("Admin approved users are pre-authorized") then decides the status.
- **Ignore List Support:** Skips warning/escalation for apps configured in \`monitoringUnsecureConnectedAppsIgnore\` (project config) or \`MONITORING_UNSECURE_CONNECTED_APPS_IGNORE\` (environment variable). Matching OAuth tokens are marked as *Ignored*.
- **Unsecured App Detection:** Identifies apps that allow users to authorize themselves without admin approval, which can pose security risks.
- **Phantom App Cleanup (Optional):** Detects unsecured apps not present in the installed Connected Apps or External Client Apps list and offers an interactive option to revoke their OAuth tokens (forces re-authentication if still needed).
- **Stale Token Cleanup (Optional):** Detects secured apps that still have old unsecured OAuth tokens (authorized before proper hardening) and offers an interactive option to delete them.
- **Detailed Reporting:** Generates several CSV reports:
  - **OAuth Tokens Report:** Lists all OAuth tokens with security status, app type, user information, and usage data
  - **Unsecured Connected Apps Summary:** Aggregates unsecured apps with counts of associated OAuth tokens and app type
  - **OAuth Tokens by User:** Lists each user with the apps they hold a token for and the last usage date
  - **Connected Apps Usage:** Lists every Connected App and External Client App that has OAuth tokens (secured or not), with its last usage date, the usernames who use it, and whether it must be moved to an External Client App
- **Move to External Client Apps:** Salesforce ends the support of Connected Apps in Summer '27 (they keep working, without fixes or support). The usage report tells, for each app, whether the move is \`Required\` (a Connected App of the org used in the last 90 days), done by its \`Vendor\` (an app of Salesforce or of a package, used in the last 90 days), \`Done (converted)\`, \`Not needed\` (already an External Client App) or not worth it (\`Not used\` for 90 days: delete it instead). The apps to move are also reported by [hardis:org:diagnose:what-will-break](${CONSTANTS.DOC_URL_ROOT}/hardis/org/diagnose/what-will-break/), with the date.
- **Visual Indicators:** Uses status icons (❌ for unsecured, ✅ for secured, ⚪ for ignored) to provide immediate visual feedback on security status.
- **Security Recommendations:** Provides actionable guidance on how to secure Connected Apps and External Client Apps through proper configuration.
- **Notifications:** Sends alerts to configured channels (Grafana, Slack, MS Teams) with security findings and attached reports.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-org-security/) and can output Grafana, Slack and MsTeams Notifications.

<iframe width="560" height="315" src="https://www.youtube.com/embed/jHv8yrSK8Dg" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Query Execution:** Executes a comprehensive SOQL query on the \`OauthToken\` object, joining with \`AppMenuItem\` and \`User\` objects to gather complete security context. A Bulk query returns at most 2500 tokens, so the next ones are read page by page on \`CreatedDate\`.
- **External Client App Migration Logic:** the apps the org owns are its \`ConnectedApp\` metadata (\`listMetadata\`), compared with the app label turned into an API name (\`ClickDeploy.io\` becomes \`ClickDeploy_io\`). \`AppMenuItem.NamespacePrefix\` marks packaged apps, and the most recent \`LastUsedDate\` of the app's tokens tells if it is still used.
- **Connected App Security Logic:** Analyzes the \`ConnectedApplication.OptionsAllowAdminApprovedUsersOnly\` field (falling back to \`AppMenuItem.IsUsingAdminAuthorization\`) to determine if a Connected App requires admin pre-approval for user authorization. Booleans returned as strings by the Bulk API are normalized, so a \`"false"\` value is never read as secured.
- **External Client App Security Logic:** Queries \`ExtlClntAppOauthPlcyCnfg\` for each External Client App and checks \`PermittedUsersPolicyType === 'AdminApprovedPreAuthorized'\` to determine if admin pre-approval is required. Falls back to AppName-based matching when \`AppMenuItem.ApplicationId\` is not populated.
- **Converted Connected App Logic:** When a token points to a Connected App whose name matches an \`ExternalClientApplication\` \`MasterLabel\` or \`DeveloperName\`, the Connected App is considered migrated: the External Client App OAuth policy decides the status and the app type is reported as \`Ext Client App (converted)\`. The match is made on the name only, so every app whose status comes from an External Client App policy is logged, as well as every name match without an available policy.
- **Ignore Handling:** Normalizes app names and marks matching OAuth tokens as *Ignored* so they do not contribute to unsecured app counts and notifications.
- **Data Transformation:** Processes raw SOQL results to add security status indicators, app type, and reorganizes data for optimal reporting and analysis.
- **Aggregation Processing:** Groups OAuth tokens by app name to provide summary statistics and identify the most problematic applications.
- **Token Revocation:** Optionally calls Salesforce OAuth revoke endpoint using each token's \`DeleteToken\` value to revoke OAuth tokens for selected phantom apps or stale unsecured tokens on secured apps.
- **Report Generation:** Uses \`generateCsvFile\` to create structured CSV reports with proper formatting and metadata for easy analysis and sharing.
- **Notification Integration:** Integrates with the \`NotifProvider\` to send security alerts with detailed metrics, including the number of unsecured apps and associated OAuth tokens.
- **File Management:** Generates multiple output formats (CSV, XLSX) and manages file paths using \`generateReportPath\` for consistent report organization.
- **Connection Management:** Uses \`setConnectionVariables\` to ensure proper authentication context for notification providers that require org connection details.
</details>


### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:unsecure-connected-apps --agent --target-org myorg@example.com
\`\`\`

In agent mode:

- Phantom app OAuth token revocation prompt is skipped (no tokens are revoked automatically).
- Stale token deletion prompt is skipped (no tokens are deleted automatically).
- All other interactive prompts are skipped.`;

  public static examples = [
    '$ sf hardis:org:diagnose:unsecure-connected-apps',
    '$ sf hardis:org:diagnose:unsecure-connected-apps --agent',
  ];

  public static flags: any = {
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
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
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  protected debugMode = false;
  protected unsecuredConnectedAppsToIgnore: string[] = [];

  protected connectedAppResults: any[] = [];
  protected outputFile;
  protected outputFilesRes: any = {};
  protected outputFileConnectedApps;
  protected outputFilesResConnectedApps: any = {};

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(UnsecuredConnectedApps);
    const agentMode = flags.agent === true;
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    const conn: Connection = flags['target-org'].getConnection();

    // Read config to get list of connected apps to ignore
    const config = await getConfig("project");
    this.unsecuredConnectedAppsToIgnore = getEnvVarList("MONITORING_UNSECURE_CONNECTED_APPS_IGNORE") || config.monitoringUnsecureConnectedAppsIgnore || [];
    if (this.unsecuredConnectedAppsToIgnore.length > 0) {
      uxLog("action", this, c.yellow(t('connectedAppsWillBeIgnored', { count: this.unsecuredConnectedAppsToIgnore.length })));
      this.unsecuredConnectedAppsToIgnore.forEach(appName => {
        uxLog("log", this, `• ${appName}`);
      });
    }

    // Collect Connected Apps, External Client Apps and OAuth tokens, with the security status of each token
    const {
      allOAuthTokens,
      allOAuthTokensWithStatus,
      allConnectedApps,
      allExternalClientApps,
      convertedExtClientAppNames,
      convertedExtClientAppsWithoutPolicy,
    } = await collectOAuthTokensWithStatus(conn, {
      ignoredAppNames: this.unsecuredConnectedAppsToIgnore,
      commandThis: this,
      logActions: true,
    });

    // The status of these apps comes from an External Client App with the same name, not from the Connected App itself
    if (convertedExtClientAppNames.length > 0) {
      uxLog("log", this, t('connectedAppsStatusFromExtClientApp', { count: convertedExtClientAppNames.length }));
      convertedExtClientAppNames.forEach(name => uxLog("log", this, `• ${name}`));
    }
    if (convertedExtClientAppsWithoutPolicy.length > 0) {
      uxLog("warning", this, c.yellow(t('externalClientAppOauthPolicyNotFound', { count: convertedExtClientAppsWithoutPolicy.length })));
      convertedExtClientAppsWithoutPolicy.forEach(name => uxLog("warning", this, c.yellow(`• ${name}`)));
    }

    // Generate output CSV file
    this.outputFile = await generateReportPath('unsecured-oauth-tokens', this.outputFile);
    this.outputFilesRes = await generateCsvFile(allOAuthTokensWithStatus, this.outputFile, { fileTitle: t('unsecuredOAuthTokensFiletitle') });

    const unsecuredOAuthTokens = allOAuthTokensWithStatus.filter(app => app.Status === '❌ Unsecured');

    // Display results
    uxLog("action", this, t('unsecuredOAuthTokensFound', { count: unsecuredOAuthTokens.length }));
    uxLogTable(this, unsecuredOAuthTokens);

    const uniqueUnsecuredAppNamesAndTokenNumber: { [key: string]: number } = {};
    const uniqueUnsecuredAppNamesAndProfiles: { [key: string]: Set<string> } = {};
    const uniqueUnsecuredAppNamesAndLastUsageDate: { [key: string]: string } = {};
    const uniqueUnsecuredAppNamesAndType: { [key: string]: string } = {};
    for (const app of unsecuredOAuthTokens) {
      if (uniqueUnsecuredAppNamesAndTokenNumber[app.AppName]) {
        uniqueUnsecuredAppNamesAndTokenNumber[app.AppName]++;
      }
      else {
        uniqueUnsecuredAppNamesAndTokenNumber[app.AppName] = 1;
      }
      if (!uniqueUnsecuredAppNamesAndType[app.AppName]) {
        uniqueUnsecuredAppNamesAndType[app.AppName] = app["App Type"] || 'Connected App';
      }
      if (!uniqueUnsecuredAppNamesAndProfiles[app.AppName]) {
        uniqueUnsecuredAppNamesAndProfiles[app.AppName] = new Set<string>();
      }
      if (app["User Profile"] && app["User Profile"] !== 'N/A') {
        uniqueUnsecuredAppNamesAndProfiles[app.AppName].add(app["User Profile"]);
      }
      if (app["Last Used Date"] && app["Last Used Date"] !== 'N/A') {
        const latestUsageDate = uniqueUnsecuredAppNamesAndLastUsageDate[app.AppName];
        if (!latestUsageDate || new Date(app["Last Used Date"]) > new Date(latestUsageDate)) {
          uniqueUnsecuredAppNamesAndLastUsageDate[app.AppName] = app["Last Used Date"];
        }
      }
    }
    const uniqueUnsecuredAppNames = Object.keys(uniqueUnsecuredAppNamesAndTokenNumber);
    const uniqueUnsecureConnectedAppsWithTokens = uniqueUnsecuredAppNames.map(appName => {
      return {
        AppName: appName,
        "App Type": uniqueUnsecuredAppNamesAndType[appName] || 'Connected App',
        NumberOfUnsecuredOAuthTokens: uniqueUnsecuredAppNamesAndTokenNumber[appName],
        LatestUsageDate: uniqueUnsecuredAppNamesAndLastUsageDate[appName] || "N/A",
        ProfilesOfUsersUsingIt: Array.from(uniqueUnsecuredAppNamesAndProfiles[appName] || []).sort().join(', '),
      }
    });
    this.outputFileConnectedApps = await generateReportPath('unsecured-connected-apps', this.outputFileConnectedApps);
    this.outputFilesResConnectedApps = await generateCsvFile(uniqueUnsecureConnectedAppsWithTokens, this.outputFileConnectedApps, { fileTitle: t('unsecuredConnectedAppsFiletitle'), mainReport: true });
    if (uniqueUnsecuredAppNames.length > 0) {
      uxLog("action", this, c.cyan(t('unsecuredConnectedAppsFound', { count: uniqueUnsecuredAppNames.length })));
      uxLogTable(this, uniqueUnsecureConnectedAppsWithTokens);
      uxLog("warning", this, t('howToSecureConnectedApps'));
    }

    // Aggregate OAuth tokens by user, listing all apps the user has tokens for (with last usage date) in a single cell
    const tokensByUser: { [username: string]: { username: string; lastUsageByApp: { [appName: string]: string }; } } = {};
    for (const token of allOAuthTokensWithStatus) {
      const userKey = token["Username"] && token["Username"] !== 'N/A' ? token["Username"] : token["User"];
      if (!tokensByUser[userKey]) {
        tokensByUser[userKey] = {
          username: userKey,
          lastUsageByApp: {},
        };
      }
      if (token.AppName && token.AppName !== 'N/A') {
        const lastUsedDate = token["Last Used Date"] && token["Last Used Date"] !== 'N/A' ? token["Last Used Date"] : '';
        const existing = tokensByUser[userKey].lastUsageByApp[token.AppName];
        // Keep the most recent usage date if the user has several tokens for the same app
        if (!(token.AppName in tokensByUser[userKey].lastUsageByApp) || (lastUsedDate && lastUsedDate > (existing || ''))) {
          tokensByUser[userKey].lastUsageByApp[token.AppName] = lastUsedDate;
        }
      }
    }
    const oAuthTokensByUser = Object.values(tokensByUser).map(entry => ({
      "Username": entry.username,
      "Connected Apps": Object.keys(entry.lastUsageByApp).sort().map(appName => {
        const lastUsedDate = entry.lastUsageByApp[appName];
        return lastUsedDate ? `${appName} (${lastUsedDate})` : appName;
      }).join('\n'),
    }));
    sortArray(oAuthTokensByUser, { by: 'Username' });
    const outputFileOAuthTokensByUser = await generateReportPath('oauth-tokens-by-user', '');
    await generateCsvFile(oAuthTokensByUser, outputFileOAuthTokensByUser, { fileTitle: t('oauthTokensByUserFiletitle') });
    if (oAuthTokensByUser.length > 0) {
      uxLog("action", this, c.cyan(t('usersWithOauthTokensFound', { count: oAuthTokensByUser.length })));
      uxLogTable(this, oAuthTokensByUser);
    }

    // Every app that has OAuth tokens, with its last usage date, its users and whether it must move to an External Client App
    const connectedAppsUsage = await buildConnectedAppsUsage(allOAuthTokensWithStatus, conn);
    const outputFileConnectedAppsUsage = await generateReportPath('connected-apps-usage', '');
    await generateCsvFile(connectedAppsUsage, outputFileConnectedAppsUsage, { fileTitle: t('connectedAppsUsageFiletitle') });
    if (connectedAppsUsage.length > 0) {
      uxLog("action", this, c.cyan(t('connectedAppsUsageFound', { count: connectedAppsUsage.length })));
      uxLogTable(this, connectedAppsUsage);
    }
    // Salesforce ends the support of Connected Apps in Summer '27 (they keep working, without fixes or support): the ones the org owns and still uses must move to External Client Apps
    const connectedAppsToMigrate = connectedAppsUsage.filter(app => app["Move to External Client App"] === 'Required');
    if (connectedAppsToMigrate.length > 0) {
      uxLog("warning", this, c.yellow(t('connectedAppsToMigrate', { count: connectedAppsToMigrate.length })));
    }

    // Build notification
    const numberWarnings = uniqueUnsecuredAppNames.length;
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    const notifSeverity: NotifSeverity = numberWarnings > 0 ? 'warning' : 'log';
    const notifText = t('unsecuredConnectedAppsFoundInOrg', { count: numberWarnings, orgMarkdown })
    let notifDetailText = '';
    for (const connectedApp of uniqueUnsecureConnectedAppsWithTokens) {
      notifDetailText += `- **${connectedApp.AppName}** (**${connectedApp.NumberOfUnsecuredOAuthTokens}** OAuth Tokens)\n`;
    }
    const notifAttachments = [{ text: notifDetailText }];
    // Post notif
    await setConnectionVariables(flags['target-org']?.getConnection());// Required for some notifications providers like Email
    await NotifProvider.postNotifications({
      type: 'UNSECURED_CONNECTED_APPS',
      text: notifText,
      attachments: notifAttachments,
      buttons: notifButtons,
      severity: notifSeverity,
      attachedFiles: this.outputFilesResConnectedApps.xlsxFile ? [this.outputFilesResConnectedApps.xlsxFile] : [],
      logElements: uniqueUnsecureConnectedAppsWithTokens,
      data: { metric: numberWarnings },
      metrics: {
        UnsecuredConnectedApps: numberWarnings,
      },
    });

    // Display link to Setup UI if there are issues
    if (numberWarnings > 0) {
      const OAuthUsageSetupUrl = `${conn.instanceUrl}/lightning/setup/ConnectedAppsUsage/home`;
      WebSocketClient.sendReportFileMessage(OAuthUsageSetupUrl, t('reviewOAuthConnectedApps'), "actionUrl");
    }

    // Suggest to ignore connected apps that we are not able to find in either Connected Apps, External Client Apps, either in OAuthUsage setup page
    const uniqueUnsecureConnectedAppsWithTokensNotInConnectedApps: string[] = [];
    for (const appName of uniqueUnsecuredAppNames) {
      const matchingConnectedApp = allConnectedApps.find(app => app.Name === appName);
      const matchingExtClientApp = allExternalClientApps.find(app => app.MasterLabel === appName || app.DeveloperName === appName);
      if (!matchingConnectedApp && !matchingExtClientApp) {
        uniqueUnsecureConnectedAppsWithTokensNotInConnectedApps.push(appName);
      }
    }
    if (!isCI && !agentMode) {
      if (uniqueUnsecureConnectedAppsWithTokensNotInConnectedApps.length > 0) {
        const confirmPromptRes = await prompts({
          type: 'confirm',
          message: t('thereAreUnsecuredConnectedAppsWithOauth', { uniqueUnsecureConnectedAppsWithTokensNotInConnectedApps: uniqueUnsecureConnectedAppsWithTokensNotInConnectedApps.length }),
          initial: false,
          description: t('youWillSelectAppsToIgnoreDescription'),
        });
        if (confirmPromptRes.value === true) {
          const ignorePromptRes = await prompts({
            type: 'multiselect',
            message: t('selectTheAppsForWhichYouWant2'),
            choices: uniqueUnsecureConnectedAppsWithTokensNotInConnectedApps.map(appName => ({ title: appName, value: appName })),
            description: t('appsAddedToIgnoreListDescription'),
          });
          if (ignorePromptRes?.value.length > 0) {
            uxLog("action", this, c.cyan(t('updatingUnsecureConnectedAppsIgnoreList')));
            const config = await getConfig("project");
            const monitoringUnsecureConnectedAppsIgnore = config.monitoringUnsecureConnectedAppsIgnore || [];
            for (const appName of ignorePromptRes.value) {
              if (!monitoringUnsecureConnectedAppsIgnore.includes(appName)) {
                monitoringUnsecureConnectedAppsIgnore.push(appName);
                uxLog("log", this, c.green(`• ${t('appAddedToIgnoreList', { appName })}`));
              }
            }
            config.monitoringUnsecureConnectedAppsIgnore = monitoringUnsecureConnectedAppsIgnore;
            await setConfig("project", config);
            uxLog("log", this, c.green(t('ignoreListUpdated')));
          }
        }
      }
    }

    // Suggest to delete tokens for some connected apps using https://MyDomainName.my.salesforce.com/services/oauth2/revoke?token=(the Delete Token)
    if (!isCI && !agentMode && unsecuredOAuthTokens.length > 0) {
      const deletableOAuthTokens = unsecuredOAuthTokens.filter(token => uniqueUnsecureConnectedAppsWithTokensNotInConnectedApps.includes(token.AppName));

      if (deletableOAuthTokens.length > 0) {
        uxLog("action", this, c.cyan(t('reviewingDeletableAuthTokens', { count: deletableOAuthTokens.length })));
        uxLogTable(this, deletableOAuthTokens);

        const outputFileDeletableAuthTokens = await generateReportPath('deletable-auth-tokens', '');
        await generateCsvFile(deletableOAuthTokens, outputFileDeletableAuthTokens, { fileTitle: t('deletableAuthTokensFiletitle') });

        const confirmDeleteRes = await prompts({
          type: 'confirm',
          message: t('doYouWantToDeleteAuthTokens'),
          description: t('deletePhantomAppsTokensDescription'),
          initial: false,
        });

        if (confirmDeleteRes.value === true) {
          // Prompt user to select the apps
          const deleteTokensPromptRes = await prompts({
            type: 'multiselect',
            message: t('selectTheAppsForWhichYouWant'),
            choices: uniqueUnsecureConnectedAppsWithTokensNotInConnectedApps.map(appName => {
              const tokenCount = uniqueUnsecuredAppNamesAndTokenNumber[appName] || 0;
              return {
                title: `${appName} (${tokenCount} token${tokenCount > 1 ? 's' : ''})`,
                value: appName,
              };
            }),
            description: t('oauthTokensForSelectedAppsWillBeDeleted'),
          });
          if (deleteTokensPromptRes?.value.length > 0) {
            const tokensToDelete = unsecuredOAuthTokens.filter(token => deleteTokensPromptRes.value.includes(token.AppName));
            const deletedOAuthTokens = await this.revokeOAuthTokens(tokensToDelete, allOAuthTokens, conn);
            if (deletedOAuthTokens.length > 0) {
              const outputFileDeletedAuthTokens = await generateReportPath('deleted-auth-tokens', '');
              await generateCsvFile(deletedOAuthTokens, outputFileDeletedAuthTokens, { fileTitle: t('deletedAuthTokensFiletitle') });
            }
          }
        }
      }
    }

    if ((this.argv || []).includes('unsecure-connected-apps')) {
      process.exitCode = numberWarnings > 0 ? 1 : 0;
    }

    // Handle secured apps that also have stale unsecured tokens (mixed-status apps)
    if (!isCI && !agentMode && unsecuredOAuthTokens.length > 0) {
      const securedAppsWithUnsecuredTokensMap = new Map<string, any[]>();
      for (const token of unsecuredOAuthTokens) {
        const hasSecuredToken = allOAuthTokensWithStatus.some(
          t => t.AppName === token.AppName && t.Status === '✅ Secured'
        );
        if (hasSecuredToken) {
          const existing = securedAppsWithUnsecuredTokensMap.get(token.AppName) ?? [];
          existing.push(token);
          securedAppsWithUnsecuredTokensMap.set(token.AppName, existing);
        }
      }

      for (const [appName, staleTokens] of securedAppsWithUnsecuredTokensMap) {
        uxLog("action", this, c.yellow(t('securedAppHasUnsecuredTokens', { appName, count: staleTokens.length })));
        uxLogTable(this, staleTokens);

        const safeAppName = appName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const outputFileStaleTokens = await generateReportPath(`unsecured-tokens-secured-app-${safeAppName}`, '');
        await generateCsvFile(staleTokens, outputFileStaleTokens, { fileTitle: t('unsecuredTokensForSecuredAppFiletitle', { appName }) });

        const confirmDeleteStaleRes = await prompts({
          type: 'confirm',
          message: t('doYouWantToDeleteStaleTokensForApp', { appName, count: staleTokens.length, total: allOAuthTokensWithStatus.filter(t => t.AppName === appName).length }),
          description: t('deletePhantomAppsTokensDescription'),
          initial: false,
        });

        if (confirmDeleteStaleRes.value === true) {
          await this.revokeOAuthTokens(staleTokens, allOAuthTokens, conn);
        }
      }
    }

    return {
      status: numberWarnings === 0 ? 'success' : 'warning',
      allOAuthTokensWithStatus: allOAuthTokensWithStatus,
      unsecuredOAuthTokens: unsecuredOAuthTokens,
      unsecuredConnectedApps: uniqueUnsecuredAppNames as AnyJson[],
      oAuthTokensByUser: oAuthTokensByUser,
      connectedAppsUsage: stripSensitiveValues(connectedAppsUsage) as unknown as AnyJson[],
    }
  }

  private async revokeOAuthTokens(tokensToRevoke: any[], allOAuthTokens: any[], conn: Connection): Promise<any[]> {
    uxLog("action", this, c.cyan(t('deletingOAuthTokens', { count: tokensToRevoke.length })));
    WebSocketClient.sendProgressStartMessage(t('deletingOAuthTokens', { count: tokensToRevoke.length }), tokensToRevoke.length);
    const revokedTokens: any[] = [];
    let counter = 0;
    for (const tokenToDelete of tokensToRevoke) {
      const deleteTokenRecord = allOAuthTokens.find(tok => tok.Id === tokenToDelete["x-Token-Id"]);
      if (!deleteTokenRecord) {
        uxLog("error", this, c.red(t('oauthTokenNotFoundSkipping', { tokenId: tokenToDelete["x-Token-Id"], appName: tokenToDelete.AppName })));
        counter++;
        continue;
      }
      const deleteTokenUrl = `${conn.instanceUrl}/services/oauth2/revoke?token=${encodeURIComponent(deleteTokenRecord.DeleteToken)}`;
      uxLog("log", this, t('deletingOAuthTokenForApp', { tokenId: tokenToDelete["x-Token-Id"], appName: tokenToDelete.AppName }));
      try {
        await conn.requestPost(deleteTokenUrl, {});
        uxLog("success", this, c.green(t('oauthTokenDeleted', { tokenId: tokenToDelete["x-Token-Id"], appName: tokenToDelete.AppName })));
        revokedTokens.push(tokenToDelete);
      } catch (error) {
        uxLog("error", this, c.red(t('failedToDeleteOAuthToken', { tokenId: tokenToDelete["x-Token-Id"], appName: tokenToDelete.AppName, error: error })));
      }
      counter++;
      WebSocketClient.sendProgressStepMessage(counter, tokensToRevoke.length);
    }
    WebSocketClient.sendProgressEndMessage(tokensToRevoke.length);
    uxLog("action", this, c.green(t('oauthTokenDeletionCompleted')));
    return revokedTokens;
  }
}
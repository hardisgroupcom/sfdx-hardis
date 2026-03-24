/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { bulkQuery, soqlQuery } from '../../../../common/utils/apiUtils.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { getNotificationButtons, getOrgMarkdown } from '../../../../common/utils/notifUtils.js';
import { NotifProvider, NotifSeverity } from '../../../../common/notifProvider/index.js';
import { setConnectionVariables } from '../../../../common/utils/orgUtils.js';
import { CONSTANTS, getConfig, getEnvVarList, setConfig } from '../../../../config/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import sortArray from 'sort-array';
import { prompts } from '../../../../common/utils/prompts.js';
import { t } from '../../../../common/utils/i18n.js';

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
- **App Type Column:** Each report row includes an \`App Type\` column indicating whether the app is a \`Connected App\` or \`Ext Client App\`.
- **AppName-based Fallback Matching:** When an OAuth token has no \`AppMenuItem\` link (common for External Client App tokens), the command falls back to matching by \`AppName\` against \`ExternalClientApplication.MasterLabel\` or \`DeveloperName\`.
- **Ignore List Support:** Skips warning/escalation for apps configured in \`monitoringUnsecureConnectedAppsIgnore\` (project config) or \`MONITORING_UNSECURE_CONNECTED_APPS_IGNORE\` (environment variable). Matching OAuth tokens are marked as *Ignored*.
- **Unsecured App Detection:** Identifies apps that allow users to authorize themselves without admin approval, which can pose security risks.
- **Phantom App Cleanup (Optional):** Detects unsecured apps not present in the installed Connected Apps or External Client Apps list and offers an interactive option to revoke their OAuth tokens (forces re-authentication if still needed).
- **Stale Token Cleanup (Optional):** Detects secured apps that still have old unsecured OAuth tokens (authorized before proper hardening) and offers an interactive option to delete them.
- **Detailed Reporting:** Generates two comprehensive CSV reports:
  - **OAuth Tokens Report:** Lists all OAuth tokens with security status, app type, user information, and usage data
  - **Connected Apps Summary:** Aggregates unsecured apps with counts of associated OAuth tokens and app type
- **Visual Indicators:** Uses status icons (❌ for unsecured, ✅ for secured, ⚪ for ignored) to provide immediate visual feedback on security status.
- **Security Recommendations:** Provides actionable guidance on how to secure Connected Apps and External Client Apps through proper configuration.
- **Notifications:** Sends alerts to configured channels (Grafana, Slack, MS Teams) with security findings and attached reports.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-org-security/) and can output Grafana, Slack and MsTeams Notifications.

<iframe width="560" height="315" src="https://www.youtube.com/embed/jHv8yrSK8Dg" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Query Execution:** Executes a comprehensive SOQL query on the \`OauthToken\` object, joining with \`AppMenuItem\` and \`User\` objects to gather complete security context.
- **Connected App Security Logic:** Analyzes the \`AppMenuItem.IsUsingAdminAuthorization\` field to determine if a Connected App requires admin pre-approval for user authorization.
- **External Client App Security Logic:** Queries \`ExtlClntAppOauthPlcyCnfg\` for each External Client App and checks \`PermittedUsersPolicyType === 'AdminApprovedPreAuthorized'\` to determine if admin pre-approval is required. Falls back to AppName-based matching when \`AppMenuItem.ApplicationId\` is not populated.
- **Ignore Handling:** Normalizes app names and marks matching OAuth tokens as *Ignored* so they do not contribute to unsecured app counts and notifications.
- **Data Transformation:** Processes raw SOQL results to add security status indicators, app type, and reorganizes data for optimal reporting and analysis.
- **Aggregation Processing:** Groups OAuth tokens by app name to provide summary statistics and identify the most problematic applications.
- **Token Revocation:** Optionally calls Salesforce OAuth revoke endpoint using each token's \`DeleteToken\` value to revoke OAuth tokens for selected phantom apps or stale unsecured tokens on secured apps.
- **Report Generation:** Uses \`generateCsvFile\` to create structured CSV reports with proper formatting and metadata for easy analysis and sharing.
- **Notification Integration:** Integrates with the \`NotifProvider\` to send security alerts with detailed metrics, including the number of unsecured apps and associated OAuth tokens.
- **File Management:** Generates multiple output formats (CSV, XLSX) and manages file paths using \`generateReportPath\` for consistent report organization.
- **Connection Management:** Uses \`setConnectionVariables\` to ensure proper authentication context for notification providers that require org connection details.
</details>
`;

  public static examples = [
    '$ sf hardis:org:diagnose:unsecure-connected-apps',
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
    this.debugMode = flags.debug || false;
    this.outputFile = flags.outputfile || null;
    const conn: Connection = flags['target-org'].getConnection();

    const normalizeAppName = (appName: string): string => (appName || '').trim().toLowerCase();

    // Read config to get list of connected apps to ignore
    const config = await getConfig("project");
    this.unsecuredConnectedAppsToIgnore = getEnvVarList("MONITORING_UNSECURE_CONNECTED_APPS_IGNORE") || config.monitoringUnsecureConnectedAppsIgnore || [];
    const unsecuredConnectedAppsToIgnoreSet = new Set(this.unsecuredConnectedAppsToIgnore.map(normalizeAppName));
    if (this.unsecuredConnectedAppsToIgnore.length > 0) {
      uxLog("action", this, c.yellow(t('connectedAppsWillBeIgnored', { count: this.unsecuredConnectedAppsToIgnore.length })));
      this.unsecuredConnectedAppsToIgnore.forEach(appName => {
        uxLog("log", this, `• ${appName}`);
      });
    }

    // List available connected apps
    uxLog("action", this, c.cyan(t('listingAllInstalledConnectedAppsFrom', { conn: conn.instanceUrl })));
    const connectedAppQuery = `SELECT Id, Name FROM ConnectedApplication ORDER BY Name ASC`;
    const connectedAppQueryRes = await bulkQuery(connectedAppQuery, conn);
    const allConnectedApps = connectedAppQueryRes.records;
    uxLog("log", this, t('connectedAppsFound', { count: allConnectedApps.length }));

    // List available External Client Apps
    uxLog("action", this, c.cyan(t('listingAllExternalClientAppsFrom', { conn: conn.instanceUrl })));
    const externalClientAppQuery = `SELECT Id, MasterLabel, DeveloperName FROM ExternalClientApplication ORDER BY MasterLabel ASC`;
    let allExternalClientApps: any[] = [];
    try {
      const externalClientAppQueryRes = await soqlQuery(externalClientAppQuery, conn);
      allExternalClientApps = externalClientAppQueryRes.records;
    } catch (_e) {
      // ExternalClientApplication may not be available in all orgs or API versions
    }
    uxLog("log", this, t('externalClientAppsFound', { count: allExternalClientApps.length }));
    const allExternalClientAppsById = new Map<string, any>(allExternalClientApps.map(app => [app.Id, app]));
    // Also index by MasterLabel and DeveloperName for AppName-based matching (tokens without AppMenuItem link)
    const allExternalClientAppsByName = new Map<string, any>();
    for (const app of allExternalClientApps) {
      if (app.MasterLabel) allExternalClientAppsByName.set(app.MasterLabel.toLowerCase(), app);
      if (app.DeveloperName) allExternalClientAppsByName.set(app.DeveloperName.toLowerCase(), app);
    }

    // Query External Client App OAuth Policies to check admin pre-approval setting
    // PermittedUsersPolicyType === 'AdminApprovedPreAuthorized' means admin pre-approved
    const ecaOauthPoliciesQuery = `SELECT Id, ExternalClientApplicationId, PermittedUsersPolicyType FROM ExtlClntAppOauthPlcyCnfg`;
    let allEcaOauthPolicies: any[] = [];
    try {
      const ecaOauthPoliciesQueryRes = await soqlQuery(ecaOauthPoliciesQuery, conn);
      allEcaOauthPolicies = ecaOauthPoliciesQueryRes.records;
    } catch (_e) {
      // ExtlClntAppOauthConfigurablePolicies may not be available in all orgs or API versions
    }
    const ecaOauthPoliciesByAppId = new Map<string, any>(allEcaOauthPolicies.map(policy => [policy.ExternalClientApplicationId, policy]));

    // Collect all OAuth Tokens
    uxLog("action", this, c.cyan(t('extractingAllOauthTokensFrom', { conn: conn.instanceUrl })));
    const tokensCountQuery = `SELECT count() FROM OauthToken`;
    const tokensCountQueryRes = await soqlQuery(tokensCountQuery, conn);
    const totalTokens = tokensCountQueryRes.totalSize;
    uxLog("log", this, t('oauthTokensFound', { count: totalTokens }));

    const baseOAuthTokenQuery = "SELECT AppName, AppMenuItem.IsUsingAdminAuthorization, LastUsedDate, CreatedDate, User.Name , User.Profile.Name, UseCount, AppMenuItem.Id, AppMenuItem.Label, AppMenuItem.Name, AppMenuItem.ApplicationId, Id, DeleteToken FROM OAuthToken";
    const allOAuthTokenQuery = baseOAuthTokenQuery + " ORDER BY CreatedDate ASC";
    const allOAuthTokenQueryRes = await bulkQuery(allOAuthTokenQuery, conn);
    const allOAuthTokens = allOAuthTokenQueryRes.records;

    // If not all OAuth token has been found, it means SF hard limit of 2500 OAuth Tokens has been reached
    // Recursively get remaining tokens using latest found Id as constraint
    if (allOAuthTokens.length < totalTokens) {
      uxLog("warning", this, c.yellow(t('salesforceApiLimitOAuthTokensReached')));
      let lastCreatedDate = allOAuthTokens.length > 0 ? allOAuthTokens[allOAuthTokens.length - 1].CreatedDate : null;
      while (lastCreatedDate != null) {
        const remainingTokensQuery = `${baseOAuthTokenQuery} WHERE CreatedDate > ${lastCreatedDate} ORDER BY CreatedDate ASC`;
        const remainingTokensQueryRes = await bulkQuery(remainingTokensQuery, conn);
        const remainingTokens = remainingTokensQueryRes.records;
        if (remainingTokens.length > 0) {
          allOAuthTokens.push(...remainingTokens);
          lastCreatedDate = remainingTokens[remainingTokens.length - 1].CreatedDate;
          uxLog("log", this, t('oauthTokensRetrievedProgress', { count: allOAuthTokens.length, total: totalTokens }));
          if (allOAuthTokens.length >= totalTokens) {
            lastCreatedDate = null;
          }
        } else {
          lastCreatedDate = null;
        }
      }
    }
    uxLog("log", this, t('oauthTokensRetrieved', { count: allOAuthTokens.length }));
    sortArray(allOAuthTokens, { by: 'AppName' });

    const allOAuthTokensWithStatus = allOAuthTokens.map(oAuthToken => {
      let adminPreApproved = oAuthToken["AppMenuItem.IsUsingAdminAuthorization"] ?? false;
      let appName = oAuthToken.AppName ? oAuthToken.AppName : 'N/A';
      let appType = 'Connected App';
      const applicationId = oAuthToken["AppMenuItem.ApplicationId"];
      if (applicationId) {
        if (applicationId.startsWith("0xI")) {
          // External Client App (matched via AppMenuItem.ApplicationId)
          appType = 'Ext Client App';
          const matchingExtClientApp = allExternalClientAppsById.get(applicationId);
          if (matchingExtClientApp) {
            appName = matchingExtClientApp.MasterLabel || matchingExtClientApp.DeveloperName;
          }
          // Use the actual ECA OAuth policy to determine admin pre-approval
          const ecaPolicy = ecaOauthPoliciesByAppId.get(applicationId);
          adminPreApproved = ecaPolicy?.PermittedUsersPolicyType === 'AdminApprovedPreAuthorized';
        } else {
          // Connected App
          const matchingConnectedApp = allConnectedApps.find(app => app.Id === applicationId);
          if (matchingConnectedApp) {
            appName = matchingConnectedApp.Name;
          } else {
            throw new SfError(`Connected App with Id ${applicationId} not found among installed Connected Apps.`);
          }
        }
      } else if (appName !== 'N/A') {
        // No AppMenuItem link — try to match by AppName against External Client Apps
        const matchingExtClientApp = allExternalClientAppsByName.get(appName.toLowerCase());
        if (matchingExtClientApp) {
          appType = 'Ext Client App';
          appName = matchingExtClientApp.MasterLabel || matchingExtClientApp.DeveloperName;
          const ecaPolicy = ecaOauthPoliciesByAppId.get(matchingExtClientApp.Id);
          adminPreApproved = ecaPolicy?.PermittedUsersPolicyType === 'AdminApprovedPreAuthorized';
        }
      }

      const isIgnored = unsecuredConnectedAppsToIgnoreSet.has(normalizeAppName(appName));
      const appResult = {
        AppName: appName,
        "App Type": appType,
        "Status": isIgnored ? '⚪ Ignored' : (adminPreApproved ? '✅ Secured' : '❌ Unsecured'),
        "Admin Pre-Approved": adminPreApproved ? 'Yes' : 'No',
        "User": oAuthToken["User.Name"] ? oAuthToken["User.Name"] : 'N/A',
        "User Profile": oAuthToken["User.Profile.Name"] ? oAuthToken["User.Profile.Name"] : 'N/A',
        "Last Used Date": oAuthToken.LastUsedDate ? new Date(oAuthToken.LastUsedDate).toISOString().split('T')[0] : 'N/A',
        "Created Date": oAuthToken.CreatedDate ? new Date(oAuthToken.CreatedDate).toISOString().split('T')[0] : 'N/A',
        "Use Count": oAuthToken.UseCount ? oAuthToken.UseCount : 0,
        "x-Token-Id": oAuthToken.Id ? oAuthToken.Id : 'N/A',
        "x-Token-AppName": oAuthToken.AppName ? oAuthToken.AppName : 'N/A',
        "x-Token-AppMenuItemLabel": oAuthToken["AppMenuItem.Label"] ? oAuthToken["AppMenuItem.Label"] : 'N/A',
        "x-Token-AppMenuItemId": oAuthToken["AppMenuItem.Id"] ? oAuthToken["AppMenuItem.Id"] : 'N/A',
        "x-AppName-Different-From-Label": (oAuthToken.AppName && oAuthToken["AppMenuItem.Label"] && oAuthToken.AppName !== oAuthToken["AppMenuItem.Label"]) ? 'Yes' : 'No',
      }
      return appResult;
    });

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
    this.outputFilesResConnectedApps = await generateCsvFile(uniqueUnsecureConnectedAppsWithTokens, this.outputFileConnectedApps, { fileTitle: t('unsecuredConnectedAppsFiletitle') });
    if (uniqueUnsecuredAppNames.length > 0) {
      uxLog("action", this, c.cyan(t('unsecuredConnectedAppsFound', { count: uniqueUnsecuredAppNames.length })));
      uxLogTable(this, uniqueUnsecureConnectedAppsWithTokens);
      uxLog("warning", this, t('howToSecureConnectedApps'));
    }

    // Build notification
    const numberWarnings = uniqueUnsecuredAppNames.length;
    const orgMarkdown = await getOrgMarkdown(flags['target-org']?.getConnection()?.instanceUrl);
    const notifButtons = await getNotificationButtons();
    const notifSeverity: NotifSeverity = numberWarnings > 0 ? 'warning' : 'log';
    const notifText = t('unsecuredConnectedAppsFoundInOrg', { count: numberWarnings, orgMarkdown })
    let notifDetailText = '';
    for (const connectedApp of uniqueUnsecureConnectedAppsWithTokens) {
      notifDetailText += `• *${connectedApp.AppName}* (${connectedApp.NumberOfUnsecuredOAuthTokens} OAuth Tokens)\n`;
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
      attachedFiles: this.outputFileConnectedApps.xlsxFile ? [this.outputFileConnectedApps.xlsxFile] : [],
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
    if (!isCI) {
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
    if (!isCI && unsecuredOAuthTokens.length > 0) {
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
    if (!isCI && unsecuredOAuthTokens.length > 0) {
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
    }
  }

  private async revokeOAuthTokens(tokensToRevoke: any[], allOAuthTokens: any[], conn: Connection): Promise<any[]> {
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
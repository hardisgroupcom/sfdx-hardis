---
title: "hardis:org:diagnose:what-will-break - What will break after dated Salesforce changes"
description: "Tells what will break in an org because of a dated Salesforce change, when, and what to do before it breaks."
---
<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:what-will-break

## Description


## Command Behavior

**Tells what will break in an org because of a dated Salesforce change, when, and what to do before it breaks.**

The command starts with a list of every check, all selected: keep the ones to run. It then writes a main report with one row per thing that will break (an integration and its user, a Connected App, a data source, a range of API versions, a release update), and one row per check that found nothing, so a clean org gets a report that says so. A check with more than 20 findings lists the first 20, and a last row points to its detail report.

| Main report column      | Content                                                                                                                                   |
|-------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| Status                  | Error (the date has passed or is less than 60 days away), Warning, Info, Not checked (with the reason) or OK                              |
| What will break         | What fails, for which app, user or data source, and when. On an OK row, what was checked.                                                 |
| Date                    | When it breaks: a day, "Enforced since", or a Salesforce release such as "Summer '28 (2028-06)"                                           |
| What to do              | The steps that fix this item and keep it from breaking again, or the report file that lists them                                          |
| Salesforce announcement | The official Salesforce page of the change                                                                                                |
| How to fix              | The [How to fix](https://sfdx-hardis.cloudity.com/salesforce-monitoring-what-will-break/#how-to-fix) section of the check, with the steps |
| Detail report           | The report of the check, with every item it found                                                                                         |

| Check                                                          | Salesforce change                                                                         | Production date                                      | Salesforce announcement                                                                                                                                              |
|----------------------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Refresh tokens idle for 30 days                                | Refresh tokens unused for 30 days expire (`invalid_grant`)                                | Since November 4, 2026 (sandboxes: October 21, 2026) | [Article 005461275](https://help.salesforce.com/s/articleView?id=005461275&type=1)                                                                                   |
| Integrations using their refresh token less than every 30 days | A monthly or quarterly sync loses its token between two runs                              | Since November 4, 2026 (sandboxes: October 21, 2026) | [Article 005461275](https://help.salesforce.com/s/articleView?id=005461275&type=1)                                                                                   |
| OAuth device flow                                              | Only allowed on local External Client Apps with a localhost callback                      | November 30, 2026                                    | [Article 005461280](https://help.salesforce.com/s/articleView?id=005461280&type=1)                                                                                   |
| Use Any API Auth permission for SOAP login()                   | Every SOAP `login()` caller needs the permission (`INSUFFICIENT_ACCESS` otherwise)        | December 1, 2026                                     | [Article 005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                                   |
| Security token for SOAP login() from wide IP ranges            | A trusted IP range wider than /8 (IPv4) or /29 (IPv6) no longer spares the security token | January 31, 2027 (sandboxes: December 15, 2026)      | [Article 005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                                   |
| SOAP login() turned off after 6 months without use             | Salesforce turns `login()` off in orgs where nobody called it in 6 months                 | January 31, 2027 (sandboxes: December 15, 2026)      | [Article 005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                                   |
| OAuth username-password and user-agent flows                   | Both flows are retired                                                                    | February 20, 2027                                    | [Release update](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_unpw.htm&release=264&type=5)                                           |
| Salesforce Connect cross-org legacy authentication             | Cross-org data sources must use a Named Credential                                        | Spring '27                                           | [Release update](https://help.salesforce.com/s/articleView?id=release-notes.rn_sf_connect_xorg_legacy_auth_retiring_ru.htm&release=264&type=5)                       |
| SOAP login() retirement                                        | SOAP `login()` is retired in API versions 31.0 to 64.0                                    | Summer '27                                           | [Article 005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                                   |
| Connected Apps to move to External Client Apps                 | Connected Apps are no longer supported                                                    | Summer '27                                           | [Migrate a Connected App to an External Client App](https://help.salesforce.com/s/articleView?id=xcloud.migrate_connected_app_to_external_client_app.htm&type=5)     |
| Calls to retired API versions                                  | API versions 30.0 and older are retired, 31.0 to 40.0 are retired in Summer '28           | Summer '25 and Summer '28                            | [API 21.0 to 30.0](https://help.salesforce.com/s/articleView?id=000389618&type=1), [API 31.0 to 40.0](https://help.salesforce.com/s/articleView?id=005321531&type=1) |
| Release updates due                                            | Each release update is enforced on its due date                                           | The due date of each release update                  | [Release Updates](https://help.salesforce.com/s/articleView?id=sf.release_updates.htm&type=5) (each release update links to its own article in Setup)                |

Each check that found something also writes its own report. The legacy API check keeps the files of [hardis:org:diagnose:legacyapi](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/), including one file of API clients (IP addresses) per range of API versions.

Idle refresh tokens are only reported one by one for **API only users**, which run the integrations: the tokens of other users are counted per app. The refresh token use check covers every user, except in Salesforce's own end-user apps (mobile, Outlook, Authenticator...).

Users listed in the project config key `monitoringWhatWillBreakIgnoreUsers` or the env var `MONITORING_WHAT_WILL_BREAK_IGNORE_USERS` (comma-separated) are skipped, for example an integration already being fixed.

This command replaces [hardis:org:diagnose:legacyapi](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/) and [hardis:org:diagnose:releaseupdates](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/releaseupdates/), which are deprecated. It is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-what-will-break/) and can output Grafana, Slack and MsTeams Notifications. When `LEGACY_API` or `RELEASE_UPDATES` is turned off in the monitoring config (`monitoringDisable`, or frequency `off`), the matching check is not run by default.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:diagnose:what-will-break --agent --target-org myorg@example.com
sf hardis:org:diagnose:what-will-break --agent --checks idleRefreshTokens,refreshTokenCadence,legacyApiVersions
```

In agent mode, and in CI, the list of checks is not shown: `--checks` picks them (comma-separated keys: idleRefreshTokens, refreshTokenCadence, deviceFlow, soapLoginPermission, soapLoginIpRange, soapLoginInactivity, usernamePasswordFlow, sfConnectLegacyAuth, soapLoginRetirement, connectedAppsToEca, legacyApiVersions, releaseUpdates), and all of them run when it is not given.

<details markdown="1">
<summary>Technical explanations</summary>

The command's implementation:

- **LoginHistory:** a single aggregate SOQL query (grouped by user, login type, app, API version, IP address and status) reads the logins of the last `--lookback-days` days (default and maximum 180, the LoginHistory retention) whose `LoginSubType` is a SOAP API login, `OAuth Device`, `OAuth Username-Password` or an `OAuth User-Agent` flow. `Application`, `ApiVersion` and `Status` cannot be filtered in SOQL but can be grouped. The Bulk API does not support `LoginHistory`. When the aggregate query fails or returns 2000 groups, the raw logins are read instead.
- **Refresh token use:** the `OAuth Refresh Token` logins are grouped by user, app, status and day (`DAY_ONLY(LoginTime)`), 20 users per query, a chunk being split in two when it reaches the 2000 groups limit. A user and app whose longest gap between two days of use is 30 days or more is reported, and so is one used on a single day (as information while that day is less than 30 days ago). Past 2000 user and app pairs, the users are grouped alone, then every active user is read.
- **Use Any API Auth:** a describe confirms `PermissionSet.PermissionsUseAnyApiAuth` exists, then `PermissionSetAssignment` is queried in chunks of 200 users, which covers profiles, permission sets and permission set groups.
- **OAuthToken:** every token is read (Bulk, page by page past the 2500 tokens limit). The idle time is the time since `LastUsedDate` (`CreatedDate` when never used). API only users come from `PermissionSetAssignment` on `PermissionsApiUserOnly`.
- **Trusted IP ranges:** `SecuritySettings.Metadata.networkAccess.ipRanges` (Tooling API). Profile login IP ranges cannot be read with SOQL and are not taken into account.
- **Username-password and user-agent flows:** `OauthOidcSettings.Metadata` (Tooling API) tells if both flows are already blocked in the org.
- **Salesforce Connect:** `ExternalDataSource` records of type `SfdcOrg` without `NamedCredentialId`.
- **Connected Apps:** the same usage list as [hardis:org:diagnose:unsecure-connected-apps](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unsecure-connected-apps/). A Connected App the org owns (its `ConnectedApp` metadata), used in the last 90 days, must be moved.
- **API versions:** the `ApiTotalUsage` event log files, analyzed like [hardis:org:diagnose:legacyapi](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/). SOAP `login()` calls stay in its detail report: the SOAP login() retirement check covers them.
- **Release updates:** Tooling API `ReleaseUpdate` records in stage `Upcoming` or `OverDue`. Each one links to the Release Updates Setup page of the org, where its Salesforce article opens. A release update that enforces the change another check looks at (matched on its `DeveloperName`) is merged into the rows of that check, unless that check did not run: the rows take its due date when it comes first, and the step to enable it.
- **Dates:** all the Salesforce dates are in one table of `whatWillBreakDeadlines.ts`. `Organization.IsSandbox` picks the sandbox date when Salesforce gives one. When the org cannot be reached, the command fails instead of reporting the checks as not run.
- **Reports:** the main CSV / XLSX (`what-will-break-<date>`), then one report per check that found something (`what-will-break-<check>-<date>`). Usernames and IP addresses follow the anonymization settings.
- **Metrics:** `IdleRefreshTokensExpiringSoon`, `IntegrationsRefreshingTooRarely`, `DeviceFlowUsers`, `SoapLoginUsersMissingPermission`, `SoapLoginUsersNeedingToken`, `UsernamePasswordFlowUsers`, `SfConnectLegacyDataSources`, `SoapLoginUsers`, `ConnectedAppsToMigrate`, `LegacyApiCalls`, `ReleaseUpdates`. A check that is not selected, or cannot run on the org, sends no metric.
</details>


## Parameters

| Name              |  Type   | Description                                                                                                                                                                                                                                                                                                                          | Default | Required | Options |
|:------------------|:-------:|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                                                                                                                                                                                                                                                |         |          |         |
| checks            | option  | Comma-separated keys of the checks to run, without the list of checks being shown. Available: idleRefreshTokens, refreshTokenCadence, deviceFlow, soapLoginPermission, soapLoginIpRange, soapLoginInactivity, usernamePasswordFlow, sfConnectLegacyAuth, soapLoginRetirement, connectedAppsToEca, legacyApiVersions, releaseUpdates. |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                                                                                                                                                                                                                                                      |         |          |         |
| flags-dir         | option  | Import flag values from a directory.                                                                                                                                                                                                                                                                                                 |         |          |         |
| idle-warning-days | option  | Number of idle days from which the refresh token of an API only user is reported as about to expire (they expire after 30 days).                                                                                                                                                                                                     |   20    |          |         |
| ignore-users      | option  | Comma-separated list of usernames to skip (merged with monitoringWhatWillBreakIgnoreUsers config and MONITORING_WHAT_WILL_BREAK_IGNORE_USERS env var).                                                                                                                                                                               |         |          |         |
| json              | boolean | Format output as json.                                                                                                                                                                                                                                                                                                               |         |          |         |
| lookback-days     | option  | Number of days of LoginHistory to scan for SOAP login() and OAuth logins (maximum 180, the LoginHistory retention).                                                                                                                                                                                                                  |   180   |          |         |
| outputfile<br/>-f | option  | Force the path and name of the main report file. Must end with .csv                                                                                                                                                                                                                                                                  |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                                                                                                                                                                                                                        |         |          |         |
| target-org<br/>-o | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set.                                                                                                                                                                                                                         |         |   true   |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                                                                                                                                                            |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:what-will-break
```

```shell
$ sf hardis:org:diagnose:what-will-break --target-org myorg@example.com
```

```shell
$ sf hardis:org:diagnose:what-will-break --checks legacyApiVersions,releaseUpdates
```

```shell
$ sf hardis:org:diagnose:what-will-break --lookback-days 90 --idle-warning-days 15
```

```shell
$ sf hardis:org:diagnose:what-will-break --ignore-users 'integration@x.com'
```

```shell
$ sf hardis:org:diagnose:what-will-break --agent
```



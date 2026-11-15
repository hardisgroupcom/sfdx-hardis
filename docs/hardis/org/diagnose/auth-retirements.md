---
title: "hardis:org:diagnose:auth-retirements - Diagnose Salesforce authentication retirements"
description: "Finds the integrations of an org that a Salesforce authentication change will break, before Salesforce turns the old method off."
---
<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:auth-retirements

## Description


## Command Behavior

**Finds the integrations of an org that a Salesforce authentication change will break, before Salesforce turns the old method off.**

Salesforce retires several authentication methods between November 2026 and Summer '27. This monitoring command runs one check per change and sends a single `AUTH_RETIREMENTS` notification. Each finding gives the deadline, the user or app concerned, the last time it was seen, and what to do.

| Check                                               | Salesforce change                                                                         | Production date                                      |
|-----------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------|
| Refresh tokens idle for 30 days                     | Refresh tokens unused for 30 days expire (`invalid_grant`)                                | Since November 4, 2026 (sandboxes: October 21, 2026) |
| OAuth device flow                                   | Only allowed on local External Client Apps with a localhost callback                      | November 30, 2026                                    |
| Use Any API Auth permission for SOAP login()        | Every SOAP `login()` caller needs the permission (`INSUFFICIENT_ACCESS` otherwise)        | December 1, 2026                                     |
| Security token for SOAP login() from wide IP ranges | A trusted IP range wider than /8 (IPv4) or /29 (IPv6) no longer spares the security token | January 31, 2027 (sandboxes: December 15, 2026)      |
| SOAP login() turned off after 6 months without use  | Salesforce turns `login()` off in orgs where nobody called it in 6 months                 | January 31, 2027 (sandboxes: December 15, 2026)      |
| OAuth username-password and user-agent flows        | Both flows are retired                                                                    | February 20, 2027                                    |
| Salesforce Connect cross-org legacy authentication  | Cross-org data sources must use a Named Credential                                        | Spring '27                                           |
| SOAP login() retirement                             | SOAP `login()` is retired in API versions 31.0 to 64.0                                    | Summer '27                                           |

Severity of a finding:

- **error** when the deadline has passed or is less than 60 days away
- **warning** when the deadline is further away, and for refresh tokens of API only users about to expire
- **info** for facts worth knowing that need no action, and for checks that cannot run on the org (missing object or permission)

Idle refresh tokens are only reported one by one for **API only users** (users with the API Only User permission), which run the integrations. The tokens of other users are counted per app, as people log in again anyway.

Users listed in the project config key `monitoringAuthRetirementsIgnoreUsers` or the env var `MONITORING_AUTH_RETIREMENTS_IGNORE_USERS` (comma-separated) are skipped, for example an integration already being fixed.

Calls to retired API versions are detected by [hardis:org:diagnose:legacyapi](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/), and the Connected Apps to move to External Client Apps are listed by [hardis:org:diagnose:unsecure-connected-apps](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unsecure-connected-apps/).

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-auth-retirements/) and can output Grafana, Slack and MsTeams Notifications.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:diagnose:auth-retirements --agent --target-org myorg@example.com
```

In agent mode the command is fully non-interactive (it never prompts); the flag exists for consistency with the rest of the monitoring suite.

<details markdown="1">
<summary>Technical explanations</summary>

The command's implementation:

- **LoginHistory:** a single Bulk query reads the logins of the last `--lookback-days` days (default and maximum 180, the LoginHistory retention) whose `LoginSubType` is a SOAP API login, `OAuth Device`, `OAuth Username-Password` or an `OAuth User-Agent` flow. `Application`, `ApiVersion` and `Status` cannot be filtered in SOQL, so the logins are grouped in memory. Only successful logins count as usage; failed ones are shown in the details, as they reveal the `INSUFFICIENT_ACCESS` errors after enforcement.
- **Use Any API Auth:** a describe confirms `PermissionSet.PermissionsUseAnyApiAuth` exists, then `PermissionSetAssignment` is queried in chunks of 200 users, which covers profiles, permission sets and permission set groups.
- **OAuthToken:** every token is read (Bulk, page by page past the 2500 tokens limit). The idle time is the time since `LastUsedDate` (`CreatedDate` when never used). API only users come from `PermissionSetAssignment` on `PermissionsApiUserOnly`.
- **Trusted IP ranges:** `SecuritySettings.Metadata.networkAccess.ipRanges` (Tooling API). Profile login IP ranges cannot be read with SOQL and are not taken into account.
- **Username-password and user-agent flows:** `OauthOidcSettings.Metadata` (Tooling API) tells if both flows are already blocked in the org.
- **Salesforce Connect:** `ExternalDataSource` records of type `SfdcOrg` without `NamedCredentialId`.
- **Dates:** all the Salesforce dates are in one table of `authRetirementsDiagnoseUtils.ts`. `Organization.IsSandbox` picks the sandbox date when Salesforce gives one.
- **Report:** one CSV / XLSX (`auth-retirements-<date>`) with a row per finding, its deadline and the link to the Salesforce article. Usernames and IP addresses follow the anonymization settings.
- **Metrics:** `IdleRefreshTokensExpiringSoon`, `DeviceFlowUsers`, `SoapLoginUsersMissingPermission`, `SoapLoginUsersNeedingToken`, `UsernamePasswordFlowUsers`, `SfConnectLegacyDataSources`, `SoapLoginUsers`. A check that cannot run on the org sends no metric.
</details>


## Parameters

| Name              |  Type   | Description                                                                                                                                               | Default | Required | Options |
|:------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                                                                     |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                                                                           |         |          |         |
| flags-dir         | option  | Import flag values from a directory.                                                                                                                      |         |          |         |
| idle-warning-days | option  | Number of idle days from which the refresh token of an API only user is reported as about to expire (they expire after 30 days).                          |   20    |          |         |
| ignore-users      | option  | Comma-separated list of usernames to skip (merged with monitoringAuthRetirementsIgnoreUsers config and MONITORING_AUTH_RETIREMENTS_IGNORE_USERS env var). |         |          |         |
| json              | boolean | Format output as json.                                                                                                                                    |         |          |         |
| lookback-days     | option  | Number of days of LoginHistory to scan for SOAP login() and OAuth logins (maximum 180, the LoginHistory retention).                                       |   180   |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .csv                                                                                         |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                                             |         |          |         |
| target-org<br/>-o | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set.                                              |         |   true   |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                 |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:auth-retirements
```

```shell
$ sf hardis:org:diagnose:auth-retirements --target-org myorg@example.com
```

```shell
$ sf hardis:org:diagnose:auth-retirements --lookback-days 90 --idle-warning-days 15
```

```shell
$ sf hardis:org:diagnose:auth-retirements --ignore-users 'integration@x.com'
```

```shell
$ sf hardis:org:diagnose:auth-retirements --agent
```



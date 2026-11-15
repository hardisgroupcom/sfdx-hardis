---
title: Salesforce authentication retirements (Salesforce monitoring)
description: Find the integrations that SOAP login() retirement, OAuth flow restrictions and idle refresh token expiry will break, with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Detect integrations broken by Salesforce authentication retirements

Between November 2026 and Summer '27, Salesforce turns off several old ways for an integration to log in. An integration that still uses one of them stops working on the day of the change, often at night, often without anybody noticing until a business user complains.

This check reads who logs in how, and tells which integrations to fix before each deadline. It sends a single **AUTH_RETIREMENTS** notification, and a report with one row per finding, its deadline and the link to the Salesforce article.

| Check                                               | Salesforce change                                                                          | Production date                                    | Salesforce article                                                                                                          |
|-----------------------------------------------------|--------------------------------------------------------------------------------------------|----------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| Refresh tokens idle for 30 days                     | A refresh token unused for 30 days expires (`invalid_grant`)                               | Since November 4, 2026 (sandboxes: October 21)     | [005461275](https://help.salesforce.com/s/articleView?id=005461275&type=1)                                                  |
| OAuth device flow                                   | Only allowed on local External Client Apps with a `https://localhost` callback             | November 30, 2026                                  | [005461280](https://help.salesforce.com/s/articleView?id=005461280&type=1)                                                  |
| Use Any API Auth permission for SOAP login()        | Every SOAP `login()` caller needs the permission, or gets `INSUFFICIENT_ACCESS`            | December 1, 2026                                   | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                  |
| Security token for SOAP login() from wide IP ranges | A trusted IP range wider than /8 (IPv4) or /29 (IPv6) no longer spares the security token  | January 31, 2027 (sandboxes: December 15, 2026)    | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                  |
| SOAP login() turned off after 6 months without use  | Salesforce turns `login()` off in orgs where nobody called it in 6 months                  | January 31, 2027 (sandboxes: December 15, 2026)    | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                  |
| OAuth username-password and user-agent flows        | Both flows are retired                                                                     | February 20, 2027                                  | [Release update](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_unpw.htm&release=264&type=5) |
| Salesforce Connect cross-org legacy authentication  | Cross-org external data sources must use a Named Credential                                | Spring '27                                         | [Winter '27 highlights](https://www.salesforce.com/blog/winter-27-release-architect-highlights/)                           |
| SOAP login() retirement                             | SOAP `login()` is retired in API versions 31.0 to 64.0                                     | Summer '27                                         | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                  |

Salesforce has moved several of these dates already. Check the article of each change before you plan around it.

Sfdx-hardis command: [sf hardis:org:diagnose:auth-retirements](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/auth-retirements/)

Key: **AUTH_RETIREMENTS**

### What each check looks at

- **Refresh tokens**: the OAuth tokens of **API only users**, the users who run integrations. A token unused for 20 days or more (change it with `--idle-warning-days`) is about to expire. A token of another user is only counted per app: people log in again anyway. When an app and a user have several tokens, the most recent one counts.
- **Device flow, username-password flow, SOAP login()**: the logins of the last 180 days in `LoginHistory` (change it with `--lookback-days`). Only active users count.
- **User-agent flows**: listed per app as information. Salesforce for iOS and Salesforce for Android log in with the user-agent flow for hybrid apps, and Salesforce migrates its own apps.
- **Use Any API Auth**: the permission is looked for in the profiles, permission sets and permission set groups of each SOAP `login()` caller. Failed logins are kept, as after December 1, 2026 a caller without the permission only fails.
- **Wide IP ranges**: the trusted IP ranges of Setup > Network Access. Profile login IP ranges cannot be read and are not taken into account.
- **Salesforce Connect**: the external data sources of type Salesforce (cross-org adapter) without Named Credential.

Calls to retired API versions are detected by [Calls to deprecated API versions](salesforce-monitoring-deprecated-api-calls.md), and the Connected Apps to move to External Client Apps before Summer '27 are listed by [Unsecured Connected Apps](salesforce-monitoring-unsecured-connected-apps.md), in the Connected Apps usage report.

### Severity

- **error** when the deadline has passed or is less than 60 days away.
- **warning** when the deadline is further away, and for refresh tokens of API only users about to expire.
- **info** for facts that need no action, and for checks that cannot run on the org (missing object or permission). The check is then skipped, without failing the monitoring job.

### Excluding users

An integration already being fixed can be skipped with:

- The `--ignore-users` flag (comma-separated usernames).
- The `monitoringAuthRetirementsIgnoreUsers` project config key.
- The `MONITORING_AUTH_RETIREMENTS_IGNORE_USERS` env var (comma-separated).

### Permissions

The user running the monitoring needs **Manage Users** to read `LoginHistory`, and **View Setup and Configuration** to read the trusted IP ranges and the OAuth settings.

### Grafana metrics

| Metric                            | Meaning                                                     |
|-----------------------------------|-------------------------------------------------------------|
| `IdleRefreshTokensExpiringSoon`   | Refresh tokens of API only users about to expire            |
| `DeviceFlowUsers`                 | Users logging in with the OAuth device flow                 |
| `SoapLoginUsersMissingPermission` | SOAP `login()` callers without Use Any API Auth             |
| `SoapLoginUsersNeedingToken`      | SOAP `login()` callers only covered by a wide trusted range |
| `UsernamePasswordFlowUsers`       | Users logging in with the OAuth username-password flow      |
| `SfConnectLegacyDataSources`      | Cross-org data sources without Named Credential             |
| `SoapLoginUsers`                  | Users calling SOAP `login()`                                |

A check that cannot run on an org sends no metric, so the dashboards show "no data" instead of a false zero.

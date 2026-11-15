---
title: Salesforce authentication retirements (Salesforce monitoring)
description: Find the integrations that SOAP login() retirement, OAuth flow restrictions and idle refresh token expiry will break, with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Detect integrations broken by Salesforce authentication retirements

Between November 2026 and Summer '27, Salesforce turns off several old ways for an integration to log in. An integration that still uses one of them stops working on the day of the change, often at night, often without anybody noticing until a business user complains.

This check reads who logs in how, and tells which integrations to fix before each deadline. It sends a single **AUTH_RETIREMENTS** notification, and a report with one row per finding, its deadline, what to do, and links to its [How to fix](#how-to-fix) section and to the Salesforce article.

| Check                                               | Salesforce change                                                                         | Production date                                 | Salesforce article                                                                                                                             |
|-----------------------------------------------------|-------------------------------------------------------------------------------------------|-------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| Refresh tokens idle for 30 days                     | A refresh token unused for 30 days expires (`invalid_grant`)                              | Since November 4, 2026 (sandboxes: October 21)  | [005461275](https://help.salesforce.com/s/articleView?id=005461275&type=1)                                                                     |
| OAuth device flow                                   | Only allowed on local External Client Apps with a `https://localhost` callback            | November 30, 2026                               | [005461280](https://help.salesforce.com/s/articleView?id=005461280&type=1)                                                                     |
| Use Any API Auth permission for SOAP login()        | Every SOAP `login()` caller needs the permission, or gets `INSUFFICIENT_ACCESS`           | December 1, 2026                                | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                     |
| Security token for SOAP login() from wide IP ranges | A trusted IP range wider than /8 (IPv4) or /29 (IPv6) no longer spares the security token | January 31, 2027 (sandboxes: December 15, 2026) | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                     |
| SOAP login() turned off after 6 months without use  | Salesforce turns `login()` off in orgs where nobody called it in 6 months                 | January 31, 2027 (sandboxes: December 15, 2026) | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                     |
| OAuth username-password and user-agent flows        | Both flows are retired                                                                    | February 20, 2027                               | [Release update](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_unpw.htm&release=264&type=5)                     |
| Salesforce Connect cross-org legacy authentication  | Cross-org external data sources must use a Named Credential                               | Spring '27                                      | [Release update](https://help.salesforce.com/s/articleView?id=release-notes.rn_sf_connect_xorg_legacy_auth_retiring_ru.htm&release=264&type=5) |
| SOAP login() retirement                             | SOAP `login()` is retired in API versions 31.0 to 64.0                                    | Summer '27                                      | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                     |

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

### How to fix

The summary table of the command, each row of the report and each line of the notification link to the section of their check below. The **Item** column of the report names the user, the app or the data source to fix.

Most fixes end the same way: the integration logs in with an [External Client App](https://help.salesforce.com/s/articleView?id=xcloud.create_a_local_external_client_app.htm&type=5) and a flow that needs no password:

- [Client credentials flow](https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_oauth_client_credentials_flow.htm&type=5) when the integration always acts as one integration user ([how to configure it](https://help.salesforce.com/s/articleView?id=xcloud.configure_client_credentials_flow_for_external_client_apps.htm&type=5)).
- [JWT bearer flow](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_jwt_flow.htm&type=5) when it acts as several users, or needs a certificate instead of a secret.
- [Web server flow with PKCE](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm&type=5) when a person logs in through the app.

An OAuth access token also works as the session id of the SOAP API, so a SOAP integration can keep its calls and only change how it logs in. When the integration is a product you bought, ask its vendor for the version that supports OAuth.

#### Refresh tokens idle for 30 days { #fix-idle-refresh-tokens }

- **Token about to expire**: make sure the integration runs at least once every 30 days, or move it to the client credentials or JWT bearer flow, which use no refresh token.
- **Token expired** (`invalid_grant`): if the integration is still needed, authorize it again from the app to get a new token, then apply the line above.
- **Tokens of other users**: nothing to do, these people log in to the app again when their token expires.

Salesforce article: [005461275](https://help.salesforce.com/s/articleView?id=005461275&type=1).

#### OAuth device flow { #fix-device-flow }

1. [Create a local External Client App](https://help.salesforce.com/s/articleView?id=xcloud.create_a_local_external_client_app.htm&type=5) in the org.
2. In its [OAuth settings](https://help.salesforce.com/s/articleView?id=xcloud.configure_external_client_app_oauth_settings.htm&type=5), use a `https://localhost` callback URL and turn on the device flow.
3. Give the consumer key of this app to the tool that logs in with the device flow.

An integration that runs without anybody in front of it is better off with the client credentials or JWT bearer flow.

Salesforce article: [005461280](https://help.salesforce.com/s/articleView?id=005461280&type=1).

#### Use Any API Auth permission for SOAP login() { #fix-soap-login-permission }

1. Create a permission set (for example `API login with password`) and turn on the system permission **Use Any API Auth**.
2. [Assign it](https://help.salesforce.com/s/articleView?id=platform.perm_sets_manage_assignments.htm&type=5) to every user of the report.
3. Plan the move of these integrations to OAuth: the permission only keeps them working until SOAP `login()` is retired in Summer '27 (see [SOAP login() retirement](#fix-soap-login-retirement)).

After December 1, 2026, a user without the permission only shows failed logins (`INSUFFICIENT_ACCESS`): they are kept in the report.

Salesforce article: [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1).

#### Security token for SOAP login() from wide IP ranges { #fix-soap-login-ip-range }

For each user of the report, choose one:

- Add the user's [security token](https://help.salesforce.com/s/articleView?id=xcloud.user_security_token.htm&type=5) after the password in the integration settings.
- Replace the wide range by the exact IP addresses of the integration servers in [Setup > Network Access](https://help.salesforce.com/s/articleView?id=sf.security_networkaccess.htm&type=5).
- Move the integration to OAuth, which lasts beyond Summer '27.

A row for a wide range without user only lists the range: check whether it is still needed.

Salesforce article: [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1).

#### SOAP login() turned off after 6 months without use { #fix-soap-login-inactivity }

- **No SOAP login() in the period**: nothing to do, unless a yearly or seasonal job still calls it. Such a job fails on its next run once Salesforce has turned `login()` off.
- **Rare callers**: these jobs may run after `login()` is turned off. Move them to OAuth before that.

Salesforce article: [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1).

#### OAuth username-password and user-agent flows { #fix-username-password-flow }

1. Move each integration of the report to the client credentials flow (one integration user) or the JWT bearer flow (several users). Salesforce gives the steps in [Migrate from OAuth Username-Password to Client Credentials Flow](https://help.salesforce.com/s/articleView?id=000886201&type=1).
2. When no user of the flow remains, [block the username-password and user-agent flows](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_disable_username_password_flow.htm&type=5) in Setup > OAuth and OpenID Connect Settings. The check then shows the flows as blocked.

User-agent flow rows are information. Salesforce for iOS, Salesforce for Android and the browser need nothing from you. Your own apps move to the web server flow with PKCE.

Salesforce article: [release update](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_unpw.htm&release=264&type=5).

#### Salesforce Connect cross-org legacy authentication { #fix-salesforce-connect }

For each external data source of the report:

1. In the org that holds the data (provider), create an External Client App.
2. In the org of the report (subscriber), create an external credential and a named credential that use this app.
3. Edit the external data source and choose the named credential as its authentication.

Salesforce gives the details in [Cross-Org Adapter Support for Named Credentials](https://help.salesforce.com/s/articleView?id=release-notes.rn_sf_connect_xorg_named_credentials.htm&release=262&type=5).

Salesforce article: [release update](https://help.salesforce.com/s/articleView?id=release-notes.rn_sf_connect_xorg_legacy_auth_retiring_ru.htm&release=264&type=5).

#### SOAP login() retirement { #fix-soap-login-retirement }

Every user of the report logs in with SOAP `login()`, which stops working in Summer '27. The **Details** column gives the app and the API version.

1. Create an [External Client App](https://help.salesforce.com/s/articleView?id=xcloud.create_a_local_external_client_app.htm&type=5) for the integration.
2. Switch the integration to the client credentials or JWT bearer flow, and send the access token as the SOAP session id.
3. For a product you bought, upgrade to the version that supports OAuth.

An integration that already has a Connected App can [migrate it to an External Client App](https://help.salesforce.com/s/articleView?id=xcloud.migrate_connected_app_to_external_client_app.htm&type=5).

Salesforce article: [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1).

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

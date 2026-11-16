---
title: What will break after dated Salesforce changes (Salesforce monitoring)
description: Find what dated Salesforce changes will break in an org (SOAP login() retirement, OAuth flow restrictions, idle refresh tokens, retired API versions, Connected Apps, release updates), when, and what to do, with sfdx-hardis Monitoring
---
<!-- markdownlint-disable MD013 -->

## Detect what will break after dated Salesforce changes

Salesforce keeps retiring things on fixed dates: old ways for an integration to log in, old API versions, Connected Apps, and every release update it enforces. Whatever still depends on one of them stops working on the day of the change, often at night, often without anybody noticing until a business user complains.

This check looks for everything a dated Salesforce change will break in the org, and writes a main report that answers four questions for each finding: **what will break**, **when**, **what to do** to avoid it, and **where Salesforce announced it**. A check that found nothing gets its own row too, so a clean org gets a report that says so.

Sfdx-hardis command: [sf hardis:org:diagnose:what-will-break](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/what-will-break/)

Key: **WHAT_WILL_BREAK**

### Checks

The command starts with the list of checks, all selected: keep the ones to run. In CI and with `--agent`, all of them run, or the ones given with `--checks`.

| Check                                                          | Key                    | Salesforce change                                                                         | Production date                                 | Salesforce announcement                                                                                                                                |
|----------------------------------------------------------------|------------------------|-------------------------------------------------------------------------------------------|-------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| Refresh tokens idle for 30 days                                | `idleRefreshTokens`    | A refresh token unused for 30 days expires (`invalid_grant`)                              | Since November 4, 2026 (sandboxes: October 21)  | [005461275](https://help.salesforce.com/s/articleView?id=005461275&type=1)                                                                             |
| Integrations using their refresh token less than every 30 days | `refreshTokenCadence`  | A monthly or quarterly sync loses its refresh token between two runs                      | Since November 4, 2026 (sandboxes: October 21)  | [005461275](https://help.salesforce.com/s/articleView?id=005461275&type=1)                                                                             |
| OAuth device flow                                              | `deviceFlow`           | Only allowed on local External Client Apps with a `https://localhost` callback            | November 30, 2026                               | [005461280](https://help.salesforce.com/s/articleView?id=005461280&type=1)                                                                             |
| Use Any API Auth permission for SOAP login()                   | `soapLoginPermission`  | Every SOAP `login()` caller needs the permission, or gets `INSUFFICIENT_ACCESS`           | December 1, 2026                                | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                             |
| Security token for SOAP login() from wide IP ranges            | `soapLoginIpRange`     | A trusted IP range wider than /8 (IPv4) or /29 (IPv6) no longer spares the security token | January 31, 2027 (sandboxes: December 15, 2026) | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                             |
| SOAP login() turned off after 6 months without use             | `soapLoginInactivity`  | Salesforce turns `login()` off in orgs where nobody called it in 6 months                 | January 31, 2027 (sandboxes: December 15, 2026) | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                             |
| OAuth username-password and user-agent flows                   | `usernamePasswordFlow` | Both flows are retired                                                                    | February 20, 2027                               | [Release update](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_unpw.htm&release=264&type=5)                             |
| Salesforce Connect cross-org legacy authentication             | `sfConnectLegacyAuth`  | Cross-org external data sources must use a Named Credential                               | Spring '27                                      | [Release update](https://help.salesforce.com/s/articleView?id=release-notes.rn_sf_connect_xorg_legacy_auth_retiring_ru.htm&release=264&type=5)         |
| SOAP login() retirement                                        | `soapLoginRetirement`  | SOAP `login()` is retired in API versions 31.0 to 64.0                                    | Summer '27                                      | [005132110](https://help.salesforce.com/s/articleView?id=005132110&type=1)                                                                             |
| Connected Apps to move to External Client Apps                 | `connectedAppsToEca`   | Connected Apps keep working, without fixes or support                                     | Summer '27                                      | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_migrate_all_connected_apps.htm&release=264&type=5)               |
| Calls to retired API versions                                  | `legacyApiVersions`    | API versions 30.0 and older are retired, 31.0 to 40.0 are retired in Summer '28           | Summer '25 and Summer '28                       | [000389618](https://help.salesforce.com/s/articleView?id=000389618&type=1), [005321531](https://help.salesforce.com/s/articleView?id=005321531&type=1) |
| Release updates due                                            | `releaseUpdates`       | Salesforce enforces each release update on its due date                                   | The due date of each release update             | The Release Updates page of the org                                                                                                                    |

Salesforce has moved several of these dates already. Check the announcement of each change before you plan around it.

### Reports

The **main report** (`what-will-break-<date>.csv` and `.xlsx`) has one row per thing that will break (an integration and its user, a Connected App, a data source, a range of API versions, a release update), and one row per check that found nothing. A check with more than 20 findings lists the first 20, and a last row points to its detail report for the others:

| Column                  | Content                                                                                          |
|-------------------------|--------------------------------------------------------------------------------------------------|
| Status                  | ❌ Error, ⚠️ Warning, ℹ️ Info, ⏸️ Not checked (the reason is in What will break) or ✅ OK        |
| Check                   | The check                                                                                        |
| What will break         | What fails, for which app, user or data source, and when. On an OK row, what was checked.        |
| Date                    | When it breaks: a day, "Enforced since", or a Salesforce release such as "Summer '28 (2028-06)"  |
| What to do              | The steps that fix this item and keep it from breaking again, or the report file that lists them |
| Salesforce announcement | The official Salesforce page of the change                                                       |
| How to fix              | The section of this page with the steps                                                          |
| Count                   | The number of items found                                                                        |
| Detail report           | The report of the check, with every item it found                                                |

What will break comes first: errors, then warnings, the earliest date first. A check that could not run on the org (missing object or permission) is **Not checked**, never OK: it proves nothing.

Each check that found something writes its own **detail report** (`what-will-break-<check>-<date>`), with one row per user, app, data source or release update to fix, and the same **WhatWillBreak** and **Recommendation** texts. The calls to retired API versions keep the reports of the former `hardis:org:diagnose:legacyapi`, including one file of API clients (IP addresses) per range of API versions.

### What each check looks at

- **Refresh tokens idle for 30 days**: the OAuth tokens of **API only users**, the users who run integrations. A token unused for 20 days or more (change it with `--idle-warning-days`) is about to expire. A token of another user is only counted per app: people log in again anyway. When an app and a user have several tokens, the most recent one counts.
- **Refresh token use**: the `OAuth Refresh Token` logins of the last 180 days, day by day, for every user, API only or not. An app and user that went 30 days or more without using its refresh token, even once, runs too rarely: its next run fails. An app and user that used it on one day only is listed too: as information while that day is less than 30 days ago, as a warning after, as its token has expired. Salesforce's own end-user apps (Salesforce for iOS and Android, Outlook, Authenticator...) are left out, as a holiday is not a broken integration.
- **Salesforce CLI**: its refresh tokens are left out of both refresh token checks. When one expires, the developer logs in again with `sf org login`: nothing breaks.
- **Device flow, username-password flow, SOAP login()**: the logins of the last 180 days in `LoginHistory` (change it with `--lookback-days`). Only active users count.
- **User-agent flows**: listed per app as information. Salesforce for iOS and Salesforce for Android log in with the user-agent flow for hybrid apps, and Salesforce migrates its own apps.
- **Use Any API Auth**: the permission is looked for in the profiles, permission sets and permission set groups of each SOAP `login()` caller. Failed logins are kept, as after December 1, 2026 a caller without the permission only fails.
- **Wide IP ranges**: the trusted IP ranges of Setup > Network Access. Profile login IP ranges cannot be read and are not taken into account.
- **Salesforce Connect**: the external data sources of type Salesforce (cross-org adapter) without Named Credential.
- **Connected Apps**: the Connected Apps the org owns and used in the last 90 days. Apps of Salesforce and of vendors are moved by their owner, and an app unused for 90 days is better deleted. The detail report is the whole Connected Apps usage list, the same as in [Unsecured Connected Apps](salesforce-monitoring-unsecured-connected-apps.md).
- **API versions**: the `ApiTotalUsage` event log files (free in every org, kept one day), as described in [Calls to deprecated API versions](salesforce-monitoring-deprecated-api-calls.md). SOAP `login()` calls are kept in the detail report, but the main report counts them in the SOAP login() retirement check.
- **Release updates**: the release updates not applied yet, with their due date. An overdue one is an error. A release update that enforces the change another check looks at (SOAP `login()` permission, device flow, username-password and user-agent flows, SOAP `login()` retirement, Connected Apps, API 31.0 to 40.0) has no row of its own in the main report: the rows of that check take its due date in the org and the step to enable it, and a check that found nothing says it can be enabled now. The detail report lists every release update.

### How to fix

The summary table of the command, each row of the reports and each line of the notification link to the section of their check below. The **Item** column of a detail report names the user, the app, the data source or the release update to fix.

Most authentication fixes end the same way: the integration logs in with an [External Client App](https://help.salesforce.com/s/articleView?id=xcloud.create_a_local_external_client_app.htm&type=5) and a flow that needs no password:

- [Client credentials flow](https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_oauth_client_credentials_flow.htm&type=5) when the integration always acts as one integration user ([how to configure it](https://help.salesforce.com/s/articleView?id=xcloud.configure_client_credentials_flow_for_external_client_apps.htm&type=5)).
- [JWT bearer flow](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_jwt_flow.htm&type=5) when it acts as several users, or needs a certificate instead of a secret.
- [Web server flow with PKCE](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm&type=5) when a person logs in through the app.

An OAuth access token also works as the session id of the SOAP API, so a SOAP integration can keep its calls and only change how it logs in. When the integration is a product you bought, ask its vendor for the version that supports OAuth.

#### Refresh tokens idle for 30 days { #fix-idle-refresh-tokens }

- **Token about to expire**: make sure the integration runs at least once every 30 days, or move it to the client credentials or JWT bearer flow, which use no refresh token.
- **Token expired** (`invalid_grant`): if the integration is still needed, authorize it again from the app to get a new token, then apply the line above.
- **Tokens of other users**: nothing to do, these people log in to the app again when their token expires.

An expired refresh token shows on the side of the integration, not in Salesforce: look for `invalid_grant` errors in the logs of the system that calls Salesforce.

Salesforce article: [005461275](https://help.salesforce.com/s/articleView?id=005461275&type=1).

#### Integrations using their refresh token less than every 30 days { #fix-refresh-token-cadence }

The integration worked when it last ran, but it runs less often than its refresh token lives: a monthly or quarterly sync, a yearly job, a background process that is often idle. Its next run after 30 days without use fails with `invalid_grant`.

- Move it to the client credentials or JWT bearer flow: they use no refresh token, so the 30 days do not apply.
- Or make it run at least every 3 weeks, for example with a light scheduled call that only refreshes the token.
- When it already failed, authorize it again from the app to get a new token, then apply one of the lines above.

Look for `invalid_grant` errors in the logs of the system that calls Salesforce: that is how an expired refresh token shows.

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

#### Connected Apps to move to External Client Apps { #fix-connected-apps-to-eca }

For each Connected App of the report:

1. [Migrate it to an External Client App](https://help.salesforce.com/s/articleView?id=xcloud.migrate_connected_app_to_external_client_app.htm&type=5) from Setup > App Manager. Only an app that uses neither the username-password flow nor dynamic client registration can be migrated.
2. Check that the integration still logs in, then remove what the Connected App no longer needs.

An app of the detail report marked **Vendor** belongs to Salesforce or to the vendor of a package: ask the vendor. An app marked **Not used** has not been used for 90 days: delete it rather than move it.

In Summer '27 Salesforce ends the support of Connected Apps: they keep working, but their bugs are no longer fixed and the integrations that use them get no support.

Salesforce articles: [Migrate All Connected Apps to External Client Apps](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_migrate_all_connected_apps.htm&release=264&type=5), [Migrate a Connected App to an External Client App](https://help.salesforce.com/s/articleView?id=xcloud.migrate_connected_app_to_external_client_app.htm&type=5).

#### Calls to retired API versions { #fix-legacy-api-versions }

The detail report lists each call with its API version, its client IP address and its user. The API clients files group the calls per IP address, to find the server that sends them.

1. Find the integration behind each IP address.
2. Upgrade it to a supported API version (41.0 or later), or to a version of the product that uses one.
3. Before the retirement, turn on the test run of the retirement in Setup > Release Updates, to make these calls fail in a sandbox first.

Calls on API versions 30.0 and older already fail. Calls on 31.0 to 40.0 fail from Summer '28.

Salesforce articles: [API versions 21.0 to 30.0](https://help.salesforce.com/s/articleView?id=000389618&type=1), [API versions 31.0 to 40.0](https://help.salesforce.com/s/articleView?id=005321531&type=1).

#### Release updates due { #fix-release-updates }

Each row of the main report is one release update, with its due date: Salesforce enforces it that day.

sfdx-hardis knows the release updates below: their row says in plain words what stops working and what to do, and links to the official Salesforce page. A release update that only improves something (accessibility, performance, an automatic migration) is information. A release update that enforces the change another check looks at has no row of its own: that check shows its due date and when to enable it.

| Release update                                                                                                  | In the report                                                                                      | Salesforce announcement                                                                                                                                                    |
|-----------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Require Use Any API Auth for SOAP API login()                                                                   | Merged into Use Any API Auth permission for SOAP login()                                           | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_api_soap_login.htm&release=264&type=5)                                                        |
| Restrict the OAuth 2.0 Device Flow to Local External Client Apps                                                | Merged into OAuth device flow                                                                      | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_device.htm&release=264&type=5)                                                 |
| Migrate to an Easier Way to Require Single Sign-On                                                              | Information: existing users keep logging in, new users need the Single Sign-On Required permission | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_require_sso.htm&release=264&type=5)                                                  |
| Grant the View Setup Audit Trail Permission to Access the Setup Audit Trail                                     | New profiles and permission sets need View Setup Audit Trail                                       | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_setup_audit_trail.htm&release=264&type=5)                                                     |
| Enable Accessibility Enhancements for To Do Lists, and Lightning Dual List-boxes When Zoom is Greater Than 200% | Information: layout change only                                                                    | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_general_accessibility_todo_listboxes_ru_262.htm&release=264&type=5)                           |
| Update Apex Code and Flows for Changed Sharing Recalculation Behavior                                           | Apex and flows that expect record access right after a role or group change                        | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_sharing_apex_recalc.htm&release=264&type=5)                                                   |
| Roll Back Platform Event Trigger Transactions on Unhandled Exceptions                                           | Platform event triggers lose what they saved before an error                                       | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_roll_back_platform_event_trigger_transactions_on_unhandled_exceptions.htm&release=264&type=5) |
| Remove Non-Public Fields from Custom Object Data in Aura Action Responses                                       | Lightning components reading internal fields of custom objects                                     | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_lc_rus_remove_nonpublic_fields_ru.htm&release=264&type=5)                                     |
| Conceal Personal Information Fields from Guest Users                                                            | Information: guest users see the same fields at first                                              | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_experiences_conceal_pii_guests.htm&release=264&type=5)                                        |
| Render Visualforce Pages as Accessible (Tagged) PDFs (Beta)                                                     | PDFs generated from Visualforce can change                                                         | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_vf_accessible_pdf_ru.htm&release=264&type=5)                                                  |
| Salesforce to Salesforce Retirement                                                                             | Records shared between orgs with Salesforce to Salesforce                                          | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_sales_salesforce_to_salesforce_retiring_ru.htm&release=264&type=5)                            |
| Retirement of OAuth 2.0 Username-Password Flow for Connected Apps                                               | Merged into OAuth username-password and user-agent flows                                           | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_unpw.htm&release=264&type=5)                                                   |
| OAuth User-Agent and Hybrid User-Agent Flows Retirement                                                         | Merged into OAuth username-password and user-agent flows                                           | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_useragent.htm&release=264&type=5)                                              |
| SOAP API login() Retirement                                                                                     | Merged into SOAP login() retirement                                                                | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_api_soap_login_retirement.htm&release=264&type=5)                                             |
| Block Apex Anonymous Code Execution from Managed Packages                                                       | Managed packages that run anonymous Apex                                                           | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_apex_block_exec_anon_ru.htm&release=264&type=5)                                               |
| Optimize Performance for Revenue Management                                                                     | Information: Product Configurator gets faster                                                      | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_product_configurator_optimize_performance.htm&release=264&type=5)                             |
| Migrate All Connected Apps to External Client Apps                                                              | Merged into Connected Apps to move to External Client Apps                                         | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_security_migrate_all_connected_apps.htm&release=264&type=5)                                   |
| Salesforce Platform API Versions 31.0 through 40.0 Retirement                                                   | Merged into Calls to retired API versions                                                          | [Release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_api_retirement.htm&release=264&type=5)                                                        |

A release update sfdx-hardis does not know yet shows the description Salesforce gives in the org, and links to the Release Updates page of the org. For those:

1. Open the link of the row: the Release Updates page of the org. The release update there gives what it changes and its Salesforce article.
2. Test it in a sandbox (Get Started, then the test run when it has one) with your customizations and integrations.
3. Enable it in production before its due date, at a moment you choose.

Contributors add a release update to `src/common/whatWillBreak/releaseUpdatesCatalog.ts`, with its two texts in every language and a row in this table.

Salesforce help: [Release Updates](https://help.salesforce.com/s/articleView?id=sf.release_updates.htm&type=5).

### Severity

- **error** when the date has passed or is less than 60 days away, and for an overdue release update.
- **warning** when the date is further away, and for refresh tokens of API only users about to expire.
- **info** for facts that need no action, and for checks that cannot run on the org (missing object or permission). The check is then skipped, without failing the monitoring job.

### Excluding users

An integration already being fixed can be skipped with:

- The `--ignore-users` flag (comma-separated usernames).
- The `monitoringWhatWillBreakIgnoreUsers` project config key.
- The `MONITORING_WHAT_WILL_BREAK_IGNORE_USERS` env var (comma-separated).

### Permissions

The user running the monitoring needs **Manage Users** to read `LoginHistory`, **View Setup and Configuration** to read the trusted IP ranges, the OAuth settings and the release updates, and **View Event Log Files** to read the API usage event logs.

### Commands it replaces

This check replaces two monitoring commands, which are deprecated:

- [hardis:org:diagnose:legacyapi](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/) (`LEGACY_API`): the `legacyApiVersions` check.
- [hardis:org:diagnose:releaseupdates](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/releaseupdates/) (`RELEASE_UPDATES`): the `releaseUpdates` check.

The daily monitoring runs `WHAT_WILL_BREAK` instead of them. What you configured for them keeps working:

- When `LEGACY_API` or `RELEASE_UPDATES` is in `monitoringDisable`, or has the frequency `off` in `monitoringCommands`, the matching check is not run.
- The notification thresholds set on `LEGACY_API` or `RELEASE_UPDATES` in `notificationConfig` apply to `WHAT_WILL_BREAK` until you set its own, the lowest threshold of each channel being kept.

The metrics keep their names, so the Grafana history of `LegacyApiCalls` and `ReleaseUpdates` continues.

### Grafana metrics

| Metric                            | Meaning                                                              |
|-----------------------------------|----------------------------------------------------------------------|
| `IdleRefreshTokensExpiringSoon`   | Refresh tokens of API only users about to expire                     |
| `IntegrationsRefreshingTooRarely` | Integrations using their refresh token less than every 30 days       |
| `DeviceFlowUsers`                 | Users logging in with the OAuth device flow                          |
| `SoapLoginUsersMissingPermission` | SOAP `login()` callers without Use Any API Auth                      |
| `SoapLoginUsersNeedingToken`      | SOAP `login()` callers only covered by a wide trusted range          |
| `UsernamePasswordFlowUsers`       | Users logging in with the OAuth username-password flow               |
| `SfConnectLegacyDataSources`      | Cross-org data sources without Named Credential                      |
| `SoapLoginUsers`                  | Users calling SOAP `login()`                                         |
| `ConnectedAppsToMigrate`          | Connected Apps of the org to move to External Client Apps            |
| `LegacyApiCalls`                  | Calls to deprecated or retired API versions, SOAP `login()` included |
| `ReleaseUpdates`                  | Release updates due                                                  |

A check that is not selected, or cannot run on an org, sends no metric, so the dashboards show "no data" instead of a false zero.

<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:mfa

## Description


## Command Behavior

**Audits the org's Multi-Factor Authentication (MFA) configuration and reports gaps that violate the Salesforce MFA requirement.**

This monitoring command runs five independent checks against the target org and emits a single `MFA_CONFIG` notification with the consolidated findings.

Key checks:

- **Org-wide MFA enforcement.** Reads `SecuritySettings.Metadata.sessionSettings` via the Tooling API to inspect the `enableMFADirectUILoginOptIn` and `skipSFAWhenMFADirectUILogin` flags, and scans recent `LoginHistory` for at least one `Status = 'Multi-factor required'` event to detect platform-level enforcement. Weak identity methods (`enableSMSIdentity`, `canConfirmIdentityBySmsOnly`) downgrade the result to a warning.
- **Users with the MFA-bypass permission.** Queries Profiles and Permission Sets where `PermissionsBypassMFAForUiLogins = true` and lists every active Standard user assigned to them.
- **Privileged users coverage.** For users assigned to any Profile or Permission Set granting `ModifyAllData`, `ViewAllData`, `CustomizeApplication`, or `AuthorApex` (configurable), the report shows whether each privileged user also holds the MFA-bypass permission (error) or lacks the API MFA permission `PermissionsTwoFactorApi` (warning).
- **SSO presence.** Detects SAML SSO via `singleSignOnSettings.enableSamlLogin` in the same SecuritySettings metadata. When SSO is on the report adds an informational reminder to verify MFA at the IdP, which sfdx-hardis cannot introspect.
- **Non-MFA direct UI logins.** Scans `LoginHistory` over the configurable lookback window (default 30 days) for `LoginType = 'Application'` successes whose `AuthMethodReference` contains no strong-auth token (`mfa`, `swk`, `fido`, `wia`, `hwk`, `face`, `fpt`, `otp`). Records with a null `AuthMethodReference` are skipped (genuinely unknown), so this check only fires on confirmed non-MFA sessions.

The severity rollup is:

- **error** if org-wide MFA enforcement is missing, any privileged user has the bypass permission, or any non-MFA direct UI login was detected.
- **warning** if any other finding is present (non-privileged bypass user, privileged users missing API MFA, weak identity setting, or SSO is enabled without an asserted IdP MFA policy).
- **log** when every check passes.

Exclusions:

- Users listed in the project config key `monitoringMfaIgnoreUsers` or the env var `MONITORING_MFA_IGNORE_USERS` (comma-separated) are skipped from checks #2, #3 (only for ignore-overlapping cases) and #5.
- Users with `UserType != 'Standard'` (integration users, Chatter Only, etc.) are not flagged in any per-user check.

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) and produces Grafana, Slack, Microsoft Teams, Google Chat, and email notifications.

![](https://sfdx-hardis.cloudity.com/assets/images/screenshot-monitoring-mfa.png)

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:diagnose:mfa --agent --target-org myorg@example.com
```

In agent mode the command is fully non-interactive (there is no prompt in the happy path); the flag exists for consistency with the rest of the monitoring suite.

<details markdown="1">
<summary>Technical explanations</summary>

The command's implementation:

- Tooling API: `SELECT Id, Metadata FROM SecuritySettings LIMIT 1` to retrieve session and SSO settings.
- SOQL: `PermissionSet` and `Profile` filtered on `PermissionsBypassMFAForUiLogins`, `PermissionsTwoFactorApi`, and the configured privileged permission fields; `PermissionSetAssignment` joined with `User` to resolve assignees; `User` filtered by `ProfileId` for profile-based grants.
- SOQL: `LoginHistory` over `LAST_N_DAYS:N` with client-side filtering on `Status`, `LoginType` and `AuthMethodReference` because `Status` cannot be filtered in a WHERE clause.
- TwoFactorMethodsInfo is intentionally not queried: Salesforce does not allow runtime SOQL access to it from a CLI session, so per-user method registration cannot be introspected.
- Reports: a single CSV / XLSX (`mfa-config-<date>`) listing every check row and a per-check summary table in the console.

Reference: [Salesforce MFA Requirement](https://help.salesforce.com/s/articleView?id=005321563&type=1).
</details>


## Parameters

| Name                             |  Type   | Description                                                                                                                                                                                                          | Default | Required | Options |
|:---------------------------------|:-------:|:---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent                            | boolean | Run in non-interactive mode for agents and automation                                                                                                                                                                |         |          |         |
| debug<br/>-d                     | boolean | Activate debug mode (more logs)                                                                                                                                                                                      |         |          |         |
| flags-dir                        | option  | undefined                                                                                                                                                                                                            |         |          |         |
| ignore-users                     | option  | Comma-separated list of usernames to exclude from MFA checks (merged with monitoringMfaIgnoreUsers config and MONITORING_MFA_IGNORE_USERS env var).                                                                  |         |          |         |
| json                             | boolean | Format output as json.                                                                                                                                                                                               |         |          |         |
| lookback-days                    | option  | Number of days back to scan LoginHistory for non-MFA direct UI logins. Overrides monitoringMfaLoginHistoryLookbackDays from config.                                                                                  |         |          |         |
| phishing-resistant-lookback-days | option  | Number of days back to scan VerificationHistory for phishing-resistant MFA registration / usage per privileged user. Overrides monitoringMfaPhishingResistantLookbackDays from config (default: 180).                |         |          |         |
| privileged-permissions           | option  | Comma-separated list of PermissionSet/Profile permission API names that define a privileged user. Defaults to PermissionsModifyAllData,PermissionsViewAllData,PermissionsCustomizeApplication,PermissionsAuthorApex. |         |          |         |
| skipauth                         | boolean | Skip authentication check when a default username is required                                                                                                                                                        |         |          |         |
| target-org<br/>-o                | option  | undefined                                                                                                                                                                                                            |         |          |         |
| websocket                        | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                                            |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:mfa
```

```shell
$ sf hardis:org:diagnose:mfa --target-org myorg@example.com
```

```shell
$ sf hardis:org:diagnose:mfa --lookback-days 60
```

```shell
$ sf hardis:org:diagnose:mfa --ignore-users 'integration@x.com,break-glass@x.com'
```

```shell
$ sf hardis:org:diagnose:mfa --agent
```



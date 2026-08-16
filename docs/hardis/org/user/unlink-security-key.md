<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:user:unlink-security-key

## Description


## Command Behavior

**Disconnects MFA registrations (default: Security Key / U2F + WebAuthn) from selected Salesforce users by driving a real browser session against Salesforce Setup.**

This command automates the manual admin procedure documented at https://help.salesforce.com/s/articleView?id=xcloud.security_u2f_remove_users_security_key.htm so administrators can revoke a lost or compromised security key for multiple users at once.

Key functionalities:

- **User selection:** Provide a comma-separated list of usernames via `--usernames`. In interactive mode, you will be prompted if the flag is missing.
- **Method selection (opt-in):** Security Key (U2F + WebAuthn combined) is removed by default. Use `--include-salesforce-authenticator` or `--include-totp` to also disconnect those methods. Use `--no-include-security-key` to skip the security-key removal when combining with other methods.
- **Inactive users are skipped:** Inactive users (`IsActive = false`) are reported with status `inactive` and no browser action is attempted for them.
- **Per-user result:** Each username receives one of the following statuses: `unlinked`, `notLinked`, `notFound`, `inactive`, or `error`.
- **Locale-independent detection:** Disconnect links are located by the brand / spec tokens (`U2F`, `WebAuthn`, `Salesforce Authenticator`, `One-Time Password Authenticator`, `TOTP`) that Salesforce does not translate, plus known French section labels and removal-action words (`Supprimer`, `Déconnecter`), so English and French orgs work out of the box. For other languages, extend the matching set with `--text-markers`.
- **Reporting:** A console table summarises the run, and CSV / XLSX reports are generated for audit trails, including a `TriggeredBy` column naming who ran the command.
- **Notifications:** Sends a notification (Slack, Microsoft Teams, email, API/Grafana) summarising which users had MFA methods unlinked, so security admins are alerted. Routing thresholds follow the `SECURITY_KEY_UNLINK` notification type configuration.
- **Triggering user:** The notification ends with a line naming the person behind the run and whether it came from a CI pipeline or a manual run. Set `SFDX_HARDIS_TRIGGERED_BY` to override the detected value.

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:user:unlink-security-key --agent --usernames 'a@x.com,b@x.com' --target-org my-admin@myorg.com
```

In agent mode:

- The confirmation prompt is skipped and the unlink procedure starts immediately.
- You must provide `--usernames` (the interactive prompt is not available).
- Method selection flags default to Security Key only unless you opt in.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **SOQL Pre-query:** Runs `SELECT Id, Username, IsActive, Name FROM User WHERE Username IN (...)` to resolve each username to a User Id. Missing rows produce `notFound`; inactive rows are short-circuited to `inactive` without launching the browser.
- **Puppeteer automation:** Reuses `puppeteer-core` with the chrome path resolved by `getChromeExecutablePath()` and logs in to the org via `secur/frontdoor.jsp?sid=<accessToken>`, identical to the existing `hardis:org:fix:listviewmine` flow.
- **Locale-independent row matching:** For each MFA method the command navigates to the user detail page (`/lightning/setup/ManageUsers/page?address=%2F<USER_ID>%3Fnoredirect%3D1%26isUserEntityOverride%3D1`), waits for the inner Classic-style iframe, scans rows for a brand / spec marker (`U2F`, `WebAuthn`, `Salesforce Authenticator`, `One-Time Password Authenticator`, `TOTP`, etc.) and clicks the removal link in that row only.
- **Removal vs registration:** When a method is not connected, the same row shows a registration link instead (id `AddU2FOrWebAuthn`, label `Register` / `Inscrire`, navigating to `registrationInterstitial.apexp`). The command only clicks genuine removal links (id `DisableU2FOrWebAuthn`, the `deleteredirect.jsp` URL, or label `Remove` / `Retirer`) and reports `notLinked` otherwise, so it never enrolls a new key by mistake.
- **Salesforce labels reference (en / fr):** `Security Key (U2F or WebAuthn)` / `Clé de sécurité (U2F ou WebAuthn)` with a `Remove` / `Retirer` link, `App Registration: Salesforce Authenticator` (Disconnect), `App Registration: One-Time Password Authenticator` (Disconnect).
- **Reporting:** Generates CSV and XLSX files (`users-security-key-unlink-<date>`) via `generateReports` and prints a console table via `uxLogTable`.
- **Triggering user resolution:** `getTriggeringUser()` walks a priority chain and keeps the first value that actually identifies a person: `SFDX_HARDIS_TRIGGERED_BY`, then the CI actor (GitHub, GitLab, Azure Pipelines, Jenkins, Bitbucket), then `CI_USER_NAME` / `USER_EMAIL` / the `userEmail` config property, then the git config identity, then the last commit author, then the OS user. Opaque values such as a Bitbucket account UUID, generic runner accounts (`runner`, `root`) and purely numeric logins are rejected so the chain keeps looking. GitHub logins and Bitbucket UUIDs are resolved to real names through the provider API when a token is already configured. The value is added to the notification text, to the `TriggeredBy` report column, and to the `_triggeredBy` field of the API payload.

Reference: [Salesforce Help - Remove a user's security key](https://help.salesforce.com/s/articleView?id=xcloud.security_u2f_remove_users_security_key.htm).
</details>


## Parameters

| Name                             |  Type   | Description                                                                                                                                                   | Default | Required | Options |
|:---------------------------------|:-------:|:--------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent                            | boolean | Run in non-interactive mode for agents and automation                                                                                                         |         |          |         |
| debug<br/>-d                     | boolean | Activate debug mode (more logs)                                                                                                                               |         |          |         |
| dump-anchors                     | boolean | Diagnostic: print every anchor found on each user detail page (use with --debug to refine markers)                                                            |         |          |         |
| flags-dir                        | option  | undefined                                                                                                                                                     |         |          |         |
| include-salesforce-authenticator | boolean | Also unlink the Salesforce Authenticator mobile app registration                                                                                              |         |          |         |
| include-security-key             | boolean | Unlink the Security Key (U2F + WebAuthn combined) registration (default: true). Use --no-include-security-key to skip.                                        |         |          |         |
| include-totp                     | boolean | Also unlink the One-Time Password Authenticator (TOTP) registration                                                                                           |         |          |         |
| json                             | boolean | Format output as json.                                                                                                                                        |         |          |         |
| skipauth                         | boolean | Skip authentication check when a default username is required                                                                                                 |         |          |         |
| target-org<br/>-o                | option  | undefined                                                                                                                                                     |         |          |         |
| text-markers                     | option  | JSON object adding text markers per method, useful on non-English orgs. Example: --text-markers '{"salesforceAuthenticator":["Authentificateur Salesforce"]}' |         |          |         |
| usernames<br/>-u                 | option  | Comma-separated list of Salesforce usernames whose security keys should be unlinked                                                                           |         |          |         |
| websocket                        | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                     |         |          |         |

## Examples

```shell
$ sf hardis:org:user:unlink-security-key
```

```shell
$ sf hardis:org:user:unlink-security-key --usernames 'a@x.com,b@x.com'
```

```shell
$ sf hardis:org:user:unlink-security-key --usernames 'a@x.com' --include-salesforce-authenticator --include-totp
```

```shell
$ sf hardis:org:user:unlink-security-key --usernames 'a@x.com' --no-include-security-key --include-totp
```

```shell
$ sf hardis:org:user:unlink-security-key --agent --usernames 'a@x.com,b@x.com'
```

```shell
$ sf hardis:org:user:unlink-security-key --usernames 'a@x.com' --text-markers '{"salesforceAuthenticator":["Authentificateur Salesforce"]}'
```



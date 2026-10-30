<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->

# hardis:ticket:whoami

## Description

## Command Behavior

**Shows the account the configured credentials authenticate as on the ticketing system, so that a script can check its setup before a run.**

- Returns the account id, the display name and the e-mail address (null when the system hides it).
- The id is the one `ticket get` returns in `assigneeId`, `reporterId` and `comments[].authorId`: comparing them tells which comments the authenticated account wrote.
- Without `--provider`, the only configured ticketing system is used.

### Supported ticketing systems

| Provider | Supported | Id returned |
|----------|-----------|-------------|
| JIRA Cloud | Yes | `accountId` |
| JIRA Server / Data Center | Yes | user name |
| Azure Boards | Yes | identity id (GUID) |
| ServiceNow | No: fails with `TicketProviderNotSupported` | |

### Errors

`TicketProviderNotConfigured` (no usable credential, or the credential is refused), `TicketProviderNotSupported`, `TicketRateLimited`.

<details markdown="1">
<summary>Technical explanations</summary>

- **JIRA:** `jira.js` `myself.getCurrentUser` (`/rest/api/3/myself` on Cloud, `/rest/api/2/myself` on Server / Data Center).
- **Azure Boards:** `connectionData` of the organization (`azure-devops-node-api` `WebApi.connect`), field `authenticatedUser`.
- A read answered 5xx is retried once.

</details>

### Agent Mode

The command never prompts:

```sh
sf hardis ticket whoami --provider azure --agent --json
```

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|provider<br/>-p|option|Ticketing system to query. Defaults to the only one configured|||jira<br/>azure<br/>servicenow<br/>aha|
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:ticket:whoami
```

```shell
$ sf hardis:ticket:whoami --provider jira --agent --json
```


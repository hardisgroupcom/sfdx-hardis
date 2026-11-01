<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:ticket:meta

## Description


## Command Behavior

**Lists what a ticketing project accepts - issue types, statuses, and the statuses of each type - or the projects the credentials can see, so that a script can be configured without guessing names.**

- `--project <P>` returns `issueTypes`, `statuses` (each status once) and `statusesByType` (type name -> its status names). Statuses come with their id: on JIRA a query is safer with ids, since the names returned are translated.
- `--projects` returns the projects the credentials can see (`key` and `name`; on Azure Boards both are the team project name). Use it when the project of the repository is not the one that holds the work items.
- `--allowed-projects a,b` refuses a `--project` outside that list with `TicketOutOfScope`.

### Supported ticketing systems

JIRA Cloud, JIRA Server / Data Center, Azure Boards, ServiceNow (a project is a table: incident, rm_story...) and Aha! (a project is a workspace, named by the prefix of its features).

### Errors

`TicketProviderNotConfigured`, `TicketProviderNotSupported`, `TicketOutOfScope`, `TicketRateLimited`.

<details markdown="1">
<summary>Technical explanations</summary>

- **JIRA:** `/project/{key}/statuses` (statuses per issue type); projects from `/project/search` on Cloud, `/project` on Server / Data Center.
- **Azure Boards:** work item types of the project (disabled types are left out) with their states; a type that comes without states is completed by `workitemtypes/{type}/states`. Projects from `_apis/projects` (200 at most).
- **ServiceNow:** the projects are the tables a record number maps to (built-in prefixes and `SERVICENOW_TABLE_PREFIXES`); the statuses are the `state` choices of the table (`sys_choice`), or those of `task` when the table has none of its own. The type is the table itself.
- **Aha!:** workspaces from `/api/v1/products`; statuses from the feature workflow of the workspace (`/products/{key}/workflows`). Aha! lists no feature types: the types are the workflow kinds its features use, read on up to 200 features.
- A read answered 5xx is retried once.

</details>

### Agent Mode

The command never prompts. One of `--project` or `--projects` is required:

```sh
sf hardis ticket meta --project ACME --agent --json
sf hardis ticket meta --projects --provider azure --agent --json
```


## Parameters

| Name             |  Type   | Description                                                                     | Default | Required |                Options                |
|:-----------------|:-------:|:--------------------------------------------------------------------------------|:-------:|:--------:|:-------------------------------------:|
| agent            | boolean | Run in non-interactive mode for agents and automation                           |         |          |                                       |
| allowed-projects | option  | Comma-separated projects --project must belong to                               |         |          |                                       |
| debug<br/>-d     | boolean | Activate debug mode (more logs)                                                 |         |          |                                       |
| flags-dir        | option  | Import flag values from a directory.                                            |         |          |                                       |
| json             | boolean | Format output as json.                                                          |         |          |                                       |
| project          | option  | Project to describe (its key, or its name when the ticketing system has no key) |         |          |                                       |
| projects         | boolean | List the projects the credentials can see instead                               |         |          |                                       |
| provider<br/>-p  | option  | Ticketing system to query. Defaults to the only one configured                  |         |          | jira<br/>azure<br/>servicenow<br/>aha |
| skipauth         | boolean | Skip authentication check when a default username is required                   |         |          |                                       |
| websocket        | option  | Websocket host:port for VsCode SFDX Hardis UI integration                       |         |          |                                       |

## Examples

```shell
$ sf hardis:ticket:meta --project ACME
```

```shell
$ sf hardis:ticket:meta --projects --provider jira --agent --json
```

```shell
$ sf hardis:ticket:meta --projects --provider azure --agent --json
```

```shell
$ sf hardis:ticket:meta --project "My Project" --provider azure --allowed-projects "My Project" --agent --json
```

```shell
$ sf hardis:ticket:meta --projects --provider servicenow --agent --json
```

```shell
$ sf hardis:ticket:meta --project incident --provider servicenow --agent --json
```

```shell
$ sf hardis:ticket:meta --projects --provider aha --agent --json
```

```shell
$ sf hardis:ticket:meta --project PROD --provider aha --agent --json
```



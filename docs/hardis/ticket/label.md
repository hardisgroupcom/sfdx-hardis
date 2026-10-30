<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->

# hardis:ticket:label

## Description

## Command Behavior

**Adds a label to a ticket (a tag on Azure Boards), without posting anything else, so that a script can flag a ticket it could not process.**

- The label is added on top of the existing ones; a label already there (any case on Azure Boards) is left as is.
- JIRA refuses labels containing spaces: such a label is refused before any call.
- `--allowed-projects a,b` reads the ticket first and fails with `TicketOutOfScope`, writing nothing, when it belongs to another project.

### Errors

`TicketProviderNotConfigured`, `TicketProviderNotSupported` (ServiceNow), `TicketNotFound`, `TicketOutOfScope`, `TicketRateLimited`.

<details markdown="1">
<summary>Technical explanations</summary>

- **JIRA:** `issues.editIssue` with `update.labels.add`, the step `ticket comment` and `ticket attach` already use.
- **Azure Boards:** JSON patch of `System.Tags`, guarded by a `test` on the revision read just before.

</details>

### Agent Mode

The command never prompts. `--id` and `--label` are required:

```sh
sf hardis ticket label --id ACME-123 --label ia-qualif-erreur --allowed-projects ACME --agent --json
```

## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|allowed-projects|option|Comma-separated projects the ticket must belong to (TicketOutOfScope otherwise)||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|id<br/>-i|option|Ticket identifier (JIRA key such as ACME-123, or Azure Boards work item such as 1234 or AB-1234)||||
|json|boolean|Format output as json.||||
|label|option|Label (Azure Boards tag) added to the ticket||||
|provider<br/>-p|option|Force the ticketing system instead of deducing it from the identifier|||jira<br/>azure<br/>servicenow<br/>aha|
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:ticket:label --id ACME-123 --label ia-qualif-erreur
```

```shell
$ sf hardis:ticket:label --id AB-4567 --label ia-qualif-erreur --allowed-projects "My Project" --agent --json
```


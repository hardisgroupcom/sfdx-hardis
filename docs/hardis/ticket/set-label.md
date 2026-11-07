<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:ticket:set-label

## Description


## Command Behavior

**Adds a label to a ticket, without posting anything else, so that a script can flag a ticket it could not process.**

- The label is added on top of the existing ones; a label already there is left as is.
- A label the ticketing system cannot store (a space on JIRA) is refused before any call.
- `--allowed-projects a,b` reads the ticket first and fails with `TicketOutOfScope`, writing nothing, when it belongs to another project.

### Errors

`TicketProviderNotConfigured`, `TicketProviderNotSupported`, `TicketNotFound`, `TicketOutOfScope`, `TicketRateLimited`.

<details markdown="1">
<summary>Technical explanations</summary>

- **JIRA:** `issues.editIssue` with `update.labels.add`, the step `ticket comment` and `ticket attach` already use.
- **Azure Boards:** a tag. JSON patch of `System.Tags`, guarded by a `test` on the revision read just before; tags are compared without case.
- **ServiceNow:** a tag: a `label_entry` record pointing at a `label`, the label being created on first use (as the deployment tag).
- **Aha!:** a tag of the feature; the current tags are read first, since Aha! replaces the whole list.

</details>

### Agent Mode

The command never prompts. `--id` and `--label` are required:

```sh
sf hardis ticket set-label --id ACME-123 --label ia-qualif-erreur --allowed-projects ACME --agent --json
```


## Parameters

| Name             |  Type   | Description                                                                                      | Default | Required |                Options                |
|:-----------------|:-------:|:-------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------------------------------------:|
| agent            | boolean | Run in non-interactive mode for agents and automation                                            |         |          |                                       |
| allowed-projects | option  | Comma-separated projects the ticket must belong to (TicketOutOfScope otherwise)                  |         |          |                                       |
| debug<br/>-d     | boolean | Activate debug mode (more logs)                                                                  |         |          |                                       |
| flags-dir        | option  | Import flag values from a directory.                                                             |         |          |                                       |
| id<br/>-i        | option  | Ticket identifier (JIRA key such as ACME-123, or Azure Boards work item such as 1234 or AB-1234) |         |   true   |                                       |
| json             | boolean | Format output as json.                                                                           |         |          |                                       |
| label            | option  | Label added to the ticket                                                                        |         |   true   |                                       |
| provider<br/>-p  | option  | Force the ticketing system instead of deducing it from the identifier                            |         |          | jira<br/>azure<br/>servicenow<br/>aha |
| skipauth         | boolean | Skip authentication check when a default username is required                                    |         |          |                                       |
| websocket        | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                        |         |          |                                       |

## Examples

```shell
$ sf hardis:ticket:set-label --id ACME-123 --label ia-qualif-erreur
```

```shell
$ sf hardis:ticket:set-label --id ACME-123 --label ia-qualified --allowed-projects ACME --agent --json
```

```shell
$ sf hardis:ticket:set-label --id AB-4567 --label "ia qualified" --allowed-projects "My Project" --agent --json
```

```shell
$ sf hardis:ticket:set-label --id INC0012345 --label ia-qualified --agent --json
```

```shell
$ sf hardis:ticket:set-label --id PROD-12 --provider aha --label ia-qualified --agent --json
```



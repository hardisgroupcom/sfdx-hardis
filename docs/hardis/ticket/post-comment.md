<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:ticket:post-comment

## Description


## Command Behavior

**Posts a markdown comment on one or several tickets of JIRA, Azure Boards, ServiceNow or Aha!, converted to the format of each ticketing system.**

An AI agent can report what it designed or tested on the ticket it worked on, a CI job can tell what it did, and a developer can comment without opening the ticketing system. The deployment comments sfdx-hardis posts after a deployment go through the same code.

- **Several tickets:** repeat `--id` (or separate the identifiers with commas). Each ticket is handled on its own: one failing does not stop the others.
- **Markdown in, native format out:** headings, bold, italic, links, lists, tables and code blocks become an Atlassian document on Jira Cloud, wiki markup on Jira Server / Data Center, HTML on Azure Boards and Aha!, and plain text with the URLs spelled out in a ServiceNow journal.
- **Update instead of adding** (`--marker`): a rerun with the same marker replaces the comment it posted before, so a CI job can keep one status comment up to date. ServiceNow journal notes cannot be edited: a new note is added there, with a warning.
- **Report:** a table and a CSV file with the action (created, updated or failed) and the link of each comment. Exit code 0 when every comment was posted, 2 when some failed, 1 when all failed.

### Provider detection

The ticketing system is deduced from the shape of the identifier, as [hardis:ticket:get](https://sfdx-hardis.cloudity.com/hardis/ticket/get/) does, so `--provider` is only needed to disambiguate:

| Identifier                                   | Provider                                        | Example           |
|----------------------------------------------|-------------------------------------------------|-------------------|
| `PROJECT-123`                                | JIRA, or Aha! when `ticketingProvider` is `AHA` | `--id ACME-4567`  |
| `1234` or `AB-1234`                          | Azure Boards                                    | `--id AB-4567`    |
| `INC0012345`, `CHG...`, `RITM...`, `DMND...` | ServiceNow                                      | `--id INC0012345` |

### Configuration

The ticketing variables sfdx-hardis already documents, from CI/CD variables or a local **.env** file:

- **JIRA:** `JIRA_HOST` + (`JIRA_EMAIL` + `JIRA_TOKEN`) or `JIRA_PAT` or (`JIRA_CLIENT_ID` + `JIRA_CLIENT_SECRET`)
- **Azure Boards:** a token (`CI_SFDX_HARDIS_AZURE_TOKEN`, `SYSTEM_ACCESSTOKEN` or `AZURE_DEVOPS_EXT_PAT`). The organization and the project are read from the git remote, or from `SYSTEM_COLLECTIONURI` and `SYSTEM_TEAMPROJECT`.
- **ServiceNow:** `SERVICENOW_URL` + `SERVICENOW_USERNAME` + `SERVICENOW_PASSWORD`. The note goes to `work_notes` by default: `--servicenow-field`, then `SERVICENOW_COMMENT_FIELD`, then the `serviceNowCommentField` configuration choose another journal field, such as `comments`.
- **Aha!:** `AHA_HOST` + `AHA_API_KEY`

<details markdown="1">
<summary>Technical explanations</summary>

- **One posting path:** every connector implements `postComment(ticketId, markdown, options)`, and its deployment comments call it too. `TicketProvider.postComment()` picks the connector with the same routing as `TicketProvider.getTicketDetails()`.
- **Conversion:** the markdown is read with `marked`. Azure Boards and Aha! get its sanitized HTML. The Atlassian document, the wiki markup and the plain text are built from the same tokens, so a comment reads the same everywhere.
- **Marker:** `sfdx-hardis:<marker>` is written in the comment, hidden in the title of an empty element on Azure Boards and Aha! (Azure Boards strips HTML comments), as a last line in code format on JIRA and ServiceNow, which have no hidden text. A rerun reads the comments of the ticket and updates the most recent one holding the marker. A marker holds letters, digits, `_`, `.`, `:` and `-`, 80 characters at most.
- **Proxy support:** the HTTP calls go through the shared proxy-aware client (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`).

</details>

### Agent Mode

Use `--agent` to disable all interactive prompts. `--id` and `--message` (or `--file`) are then required.

```sh
sf hardis:ticket:post-comment --id ACME-4567 --file docs/ACME-4567/design.md --marker design --agent --json
```

The same applies in CI.


## Parameters

| Name             |  Type   | Description                                                                                                                                                                               | Default | Required |                Options                |
|:-----------------|:-------:|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------------------------------------:|
| agent            | boolean | Run in non-interactive mode for agents and automation                                                                                                                                     |         |          |                                       |
| debug<br/>-d     | boolean | Activate debug mode (more logs)                                                                                                                                                           |         |          |                                       |
| file<br/>-f      | option  | Markdown file holding the comment to post, instead of --message                                                                                                                           |         |          |                                       |
| flags-dir        | option  | Import flag values from a directory.                                                                                                                                                      |         |          |                                       |
| id<br/>-i        | option  | Ticket to comment on: JIRA key or Aha! feature (ACME-123), Azure Boards work item (1234 or AB-1234) or ServiceNow number (INC0012345). Repeat it, or separate the identifiers with commas |         |          |                                       |
| json             | boolean | Format output as json.                                                                                                                                                                    |         |          |                                       |
| marker           | option  | Key of the comment: a rerun with the same marker updates the comment it posted before instead of adding one                                                                               |         |          |                                       |
| message<br/>-m   | option  | Comment to post, in markdown                                                                                                                                                              |         |          |                                       |
| provider<br/>-p  | option  | Force the ticketing system instead of deducing it from the identifier                                                                                                                     |         |          | jira<br/>azure<br/>servicenow<br/>aha |
| servicenow-field | option  | ServiceNow journal field written to (work_notes by default, comments for a note the requester reads)                                                                                      |         |          |                                       |
| skipauth         | boolean | Skip authentication check when a default username is required                                                                                                                             |         |          |                                       |
| websocket        | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                 |         |          |                                       |

## Examples

```shell
$ sf hardis:ticket:post-comment --id ACME-4567 --message "The fix is deployed in UAT, please test it"
```

```shell
$ sf hardis:ticket:post-comment --id ACME-4567 --id ACME-4568 --file release-notes.md
```

```shell
$ sf hardis:ticket:post-comment --id AB-1234 --file test-report.md --marker test-report
```

```shell
$ sf hardis:ticket:post-comment --id INC0012345 --message "Fixed in the last release" --servicenow-field comments
```

```shell
$ sf hardis:ticket:post-comment --id ACME-4567 --file docs/ACME-4567/design.md --marker design --agent
```



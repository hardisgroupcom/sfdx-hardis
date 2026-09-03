<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:ticket:get

## Description


## Command Behavior

**Fetches a single ticket from JIRA, Azure Boards or ServiceNow with everything attached to it, and returns it as structured JSON (and optionally as a markdown extract).**

Where `collectTicketsInfo` gathers a shallow summary of every ticket referenced by a Pull Request, this command does the opposite: **one** ticket, in full, so that a human (or an AI agent preparing an implementation) has the complete requirement without opening the ticketing system.

It returns:

- **Header fields:** type, status, priority, assignee, reporter, sprint, story points, labels, components, fix versions, parent, epic, and the key dates.
- **Description and acceptance criteria**, converted from the provider's HTML / ADF to readable plain text.
- **All comments**, in chronological order (paginated on JIRA).
- **Subtasks and linked items**, with their status.
- **Attachments**, downloaded next to the report so images can be looked at and documents opened.
- **Possible manual actions:** the lines of the ticket mentioning an operation that deployable metadata will not carry (permission set assignment, org setting, scheduled job, data load...). Each one that survives the design phase should become an [sfdx-hardis deployment action](https://sfdx-hardis.cloudity.com/hardis/project/action/create/), so it is replayed in every org rather than done by hand once.

### Provider detection

The ticketing system is deduced from the shape of the identifier, so `--provider` is only needed to disambiguate:

| Identifier | Provider | Example |
|------------|----------|---------|
| `PROJECT-123` | JIRA | `--id ACME-4567` |
| `1234` or `AB-1234` | Azure Boards | `--id AB-4567` |
| `INC0012345`, `CHG...`, `RITM...`, `DMND...` | ServiceNow | `--id INC0012345` |

### Configuration

The command reuses the ticketing variables sfdx-hardis already documents, read from CI/CD variables or from a local **.env** file:

- **JIRA:** `JIRA_HOST` + (`JIRA_EMAIL` + `JIRA_TOKEN`) or `JIRA_PAT` or (`JIRA_CLIENT_ID` + `JIRA_CLIENT_SECRET`)
- **Azure Boards:** a token only — `CI_SFDX_HARDIS_AZURE_TOKEN`, `SYSTEM_ACCESSTOKEN` or `AZURE_DEVOPS_EXT_PAT`. The organization and the project are read from the git remote of the current repository; set `SYSTEM_COLLECTIONURI` and `SYSTEM_TEAMPROJECT` only to override that (on a CI agent, Azure Pipelines already provides them).
- **ServiceNow:** `SERVICENOW_URL` + `SERVICENOW_USERNAME` + `SERVICENOW_PASSWORD`

<details markdown="1">
<summary>Technical explanations</summary>

- **Provider abstraction:** `TicketProvider.getTicketDetails()` picks the connector whose identifier pattern matches and whose credentials are configured, then delegates to that provider's `getTicketDetails()`. A matching connector may first complete its own configuration: Azure Boards parses `origin` with `parseAzureRepoUrl()` and fills the organization and project it finds there, so only a token has to be supplied locally. Values already set always win, and the git remote is only read when the identifier could belong to Azure Boards. An identifier that matches nothing, or that matches a provider with no credentials, raises an explicit error naming the missing configuration rather than returning an empty result.
- **Text conversion:** provider HTML (JIRA `renderedFields`, Azure Boards fields, ServiceNow journals) is converted to plain text with `sanitize-html`, and JIRA's Atlassian Document Format is walked as a fallback.
- **Attachment safety:** the download URL of an attachment comes from the ticket payload, which is user-controlled data. Before any credential is sent, the URL is checked to resolve to the same host as the ticketing instance the command authenticated against. The response is read through a size cap (`--max-attachment-size`, 20 MB by default), the file name is sanitized and the resolved path is verified to stay inside the target directory.
- **No sub-process:** downloaded content is never handed to an external converter. Text attachments are decoded in-process; images, PDFs and Office documents are saved as-is and reported through `localPath`, for the caller to open with its own tooling.
- **Proxy support:** every call goes through the shared proxy-aware HTTP client, so `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` are honored.

</details>

### Agent Mode

Use `--agent` to disable all interactive prompts. In agent mode `--id` is required, and nothing is ever prompted.

Combine it with `--json` to get the machine-readable payload:

```sh
sf hardis ticket get --id ACME-4567 --agent --json
```


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|attachments-dir|option|Folder the attachments are downloaded into. Defaults to a temporary folder, or to <output-file folder>/attachments when --output-file is set||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|id<br/>-i|option|Ticket identifier: JIRA key (ACME-123), Azure Boards work item (1234 or AB-1234) or ServiceNow number (INC0012345)||||
|json|boolean|Format output as json.||||
|max-attachment-size|option|Maximum size in MB read from a single attachment. Bigger files are truncated|20|||
|output-file<br/>-f|option|Write a markdown extract of the ticket at this path (parent folders are created)||||
|provider<br/>-p|option|Force the ticketing system instead of deducing it from the identifier|||jira<br/>azure<br/>servicenow|
|skip-attachments|boolean|List the attachments without downloading them||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:ticket:get --id ACME-4567
```

```shell
$ sf hardis:ticket:get --id ACME-4567 --agent --json
```

```shell
$ sf hardis:ticket:get --id INC0012345 --output-file docs/INC0012345/ticket-extract.md
```

```shell
$ sf hardis:ticket:get --id AB-4567 --provider azure --attachments-dir ./ticket-attachments
```

```shell
$ sf hardis:ticket:get --id ACME-4567 --skip-attachments --agent --json
```



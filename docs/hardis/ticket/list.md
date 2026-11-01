<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:ticket:list

## Description


## Command Behavior

**Lists the tickets matching some criteria, so that an agent or a script can process a whole backlog without typing the tickets one by one.**

- The criteria are the same on every ticketing system: `--project`, `--status`, `--type`, `--assignee` (`me`, `none` or an account), `--label`, `--text`, `--created-after`, `--updated-after` (YYYY-MM-DD) and `--open-only`. A flag taking several values takes them comma separated, and matches any of them. Different flags all apply.
- sfdx-hardis converts the criteria to the query language of the ticketing system, quoting every value, so a criterion is never read as query syntax. You never write the query yourself.
- At least one criterion is required: a search without any would read every ticket.
- `--allowed-projects a,b` bounds the search to those projects: without `--project`, the search reads all of them; a `--project` outside them is refused with `TicketOutOfScope`; any result outside them is dropped.
- `--order-by created|updated` (created by default) and `--descending` sort the tickets.
- When nothing matches, the JSON carries a `warning`. An empty result is often a wrong project: the project of the repository may only hold the code. `sf hardis ticket meta --projects` lists the visible projects, and `sf hardis ticket meta --project <P>` the types and statuses to filter on.
- Without `--provider`, the only configured ticketing system is queried; when several are configured, `--provider` is required. In an Azure DevOps pipeline, the `SYSTEM_*` variables make Azure Boards count as configured: a team using another ticketing system there should always pass `--provider`.
- `--max-results` caps the number of tickets fetched (50 by default). The command never fetches more than that silently.
- When more tickets match, the output says `truncated: true` and gives a `nextPageToken`. Pass it to `--page-token`, with the same criteria, to read the next page. The token is **opaque**: relay it as is, never parse or build it.
- Each ticket comes with its key, URL, summary, type, status, priority, assignee (name and `assigneeId`), project, area path (when the ticketing system has one), creation and update dates (ISO 8601, UTC) and labels.

### Supported ticketing systems

| Provider                  | Supported                                                              |
|---------------------------|------------------------------------------------------------------------|
| JIRA Cloud                | Yes                                                                    |
| JIRA Server / Data Center | Yes (offset pagination, carried by the page token)                     |
| Azure Boards              | Yes (one page of `--max-results`, no page token)                       |
| ServiceNow                | Yes (`--project` is required: the table, such as incident or rm_story) |
| Aha!                      | Yes (`--project` is the workspace prefix, such as PROD)                |

### Errors

Failures carry a stable name, to branch on in a script: `TicketProviderNotConfigured` (no usable credential), `TicketProviderNotSupported`, `TicketQueryInvalid` (no criterion, a wrong date, or a search the ticketing system rejected: its message is kept), `TicketOutOfScope`, `TicketRateLimited` (HTTP 429).

### Configuration

The credentials of [sf hardis ticket get](https://sfdx-hardis.cloudity.com/hardis/ticket/get/), from CI/CD variables or a local **.env** file.

<details markdown="1">
<summary>Technical explanations</summary>

- **Provider abstraction:** the command builds a neutral `TicketSearchCriteria` and calls the `searchTickets()` method of the provider. Each provider converts the criteria to its query language in its own class: no query language appears in the command.
- **JIRA:** the criteria become JQL (`project in (...)`, `status in (...)`, `issuetype in (...)`, `assignee = currentUser()` or `is EMPTY`, `labels in (...)`, `text ~`, `created >=`, `updated >=`, `statusCategory != Done`). Cloud calls `/search/jql` through `jira.js` `issueSearch.searchForIssuesUsingJqlEnhancedSearchPost` (the former `/rest/api/3/search` was removed from Jira Cloud, HTTP 410), whose cursor gives no exact total, so `totalFetched` counts the tickets actually fetched. Server / Data Center has no `/search/jql`: the command calls `/rest/api/2/search` and carries `startAt` in the opaque page token. JIRA Cloud is recognized by its host (`atlassian.net` or `.jira.com`). The assignee account is the `accountId` on Cloud, the user name on Server / Data Center.
- **Azure Boards:** the criteria become a WIQL statement on `System.TeamProject` (the configured team project when no project is given), `System.State`, `System.WorkItemType`, `System.AssignedTo` (`@Me`; another assignee is matched by display name or email), `System.Tags`, `System.Title` / `System.Description`, `System.CreatedDate` and `System.ChangedDate`. WIQL has no status category: `--open-only` leaves out the states Done, Closed, Completed, Resolved and Removed. `wit/wiql` with `$top`, then `workitemsbatch` for the fields.
- **ServiceNow:** the criteria become an encoded query on the table (several tables are searched in `task` with `sys_class_nameIN`): `stateIN` (the label or the value of the choice list), `assigned_to.user_name`, tags through `label_entry`, `short_descriptionLIKE` / `descriptionLIKE`, `sys_created_on` / `sys_updated_on`, `active=true` for `--open-only`. A value holding `^` (or a comma in a list) is refused, since the encoded query cannot quote it. Pages by offset; the labels of the tickets are not returned.
- **Aha!:** `q`, `tag` (one label), `assigned_to_user` and `updated_since` are filters of the features API; status, type, creation day, open only (a workflow status not `complete`), several labels or several workspaces are applied to each page. The tickets of a page are sorted with `--order-by`, the pages keep the order of Aha!.
- A read answered 5xx is retried once.

</details>

### Agent Mode

The command never prompts. Pass at least one criterion, and `--agent --json` to get the machine-readable result:

```sh
sf hardis ticket list --project ACME --open-only --agent --json
```


## Parameters

| Name               |  Type   | Description                                                                                                                             | Default | Required |                Options                |
|:-------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------------------------------------:|
| agent              | boolean | Run in non-interactive mode for agents and automation                                                                                   |         |          |                                       |
| allowed-projects   | option  | Comma-separated projects the search is bounded to                                                                                       |         |          |                                       |
| assignee           | option  | me (the authenticated account), none (unassigned), or the account of the assignee                                                       |         |          |                                       |
| created-after      | option  | YYYY-MM-DD: tickets created on or after that day                                                                                        |         |          |                                       |
| debug<br/>-d       | boolean | Activate debug mode (more logs)                                                                                                         |         |          |                                       |
| descending         | boolean | Newest first                                                                                                                            |         |          |                                       |
| flags-dir          | option  | Import flag values from a directory.                                                                                                    |         |          |                                       |
| json               | boolean | Format output as json.                                                                                                                  |         |          |                                       |
| label              | option  | Labels, comma separated: any of them                                                                                                    |         |          |                                       |
| max-results        | option  | Maximum number of tickets fetched                                                                                                       |   50    |          |                                       |
| open-only          | boolean | Leave out the tickets in a done status (done, closed, resolved...)                                                                      |         |          |                                       |
| order-by           | option  | Sort on the creation or the update date                                                                                                 | created |          |          created<br/>updated          |
| output-file<br/>-f | option  | Also write the JSON result at this path (parent folders are created). JSON, not the markdown of ticket get: a list is read by a program |         |          |                                       |
| page-token         | option  | nextPageToken returned by the previous page, relayed as is                                                                              |         |          |                                       |
| project            | option  | Projects the tickets belong to, comma separated                                                                                         |         |          |                                       |
| provider<br/>-p    | option  | Ticketing system to query. Defaults to the only one configured                                                                          |         |          | jira<br/>azure<br/>servicenow<br/>aha |
| skipauth           | boolean | Skip authentication check when a default username is required                                                                           |         |          |                                       |
| status             | option  | Status names, comma separated: any of them                                                                                              |         |          |                                       |
| text               | option  | Words searched in the summary and the description                                                                                       |         |          |                                       |
| type               | option  | Ticket types (Bug, Story...), comma separated: any of them                                                                              |         |          |                                       |
| updated-after      | option  | YYYY-MM-DD: tickets updated on or after that day                                                                                        |         |          |                                       |
| websocket          | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                               |         |          |                                       |

## Examples

```shell
$ sf hardis:ticket:list --project ACME --type Bug --open-only
```

```shell
$ sf hardis:ticket:list --project ACME --status "To Do,In Progress" --assignee me --agent --json
```

```shell
$ sf hardis:ticket:list --project ACME --label ia-qualified --updated-after 2026-10-01 --order-by updated --descending --agent --json
```

```shell
$ sf hardis:ticket:list --project ACME --max-results 100 --page-token <nextPageToken of the previous page> --agent --json
```

```shell
$ sf hardis:ticket:list --assignee none --allowed-projects ACME,OPS --output-file docs/backlog.json
```

```shell
$ sf hardis:ticket:list --provider azure --project "My Project" --status New --agent --json
```

```shell
$ sf hardis:ticket:list --provider azure --type "User Story" --text login --open-only --agent --json
```

```shell
$ sf hardis:ticket:list --provider servicenow --project incident --status "In Progress" --assignee me --agent --json
```

```shell
$ sf hardis:ticket:list --provider servicenow --project incident,rm_story --open-only --created-after 2026-10-01 --agent --json
```

```shell
$ sf hardis:ticket:list --provider aha --project PROD --status "In design" --agent --json
```

```shell
$ sf hardis:ticket:list --provider aha --project PROD,DEMO --label ia-qualified --open-only --agent --json
```



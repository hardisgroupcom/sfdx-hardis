---
title: Configure Integrations between sfdx-hardis and ServiceNow
description: Enrich pull requests with ServiceNow record info and post work notes on tickets when they are deployed to a Salesforce org
---
<!-- markdownlint-disable MD013 -->

- [ServiceNow integration](#servicenow-integration)
  - [For git providers](#for-git-providers)
  - [For notifications providers](#for-notifications-providers)
  - [Update ServiceNow records](#update-servicenow-records)
- [Configuration](#configuration)
  - [Credentials](#credentials)
  - [Identify ServiceNow records](#identify-servicenow-records)
  - [Record number prefixes](#record-number-prefixes)
  - [Where the deployment comment is written](#where-the-deployment-comment-is-written)
  - [Deployment tag](#deployment-tag)
- [Read a single ticket](#read-a-single-ticket)
- [Required ServiceNow permissions](#required-servicenow-permissions)
- [Technical notes](#technical-notes)

## ServiceNow integration

If you track your work in ServiceNow, sfdx-hardis can use it to enrich its integrations.

sfdx-hardis analyzes **commit messages, branch names and Pull Request titles and descriptions** to collect the ServiceNow record numbers they mention, then reads each record to get its short description and its state.

`INC0012345` is detected on its own, and so is a full ServiceNow URL containing the number, for example `https://acme.service-now.com/incident.do?sysparm_query=number=INC0012345`.

> Record numbers are only collected when the ServiceNow credentials are configured, and only for the prefixes listed as **scanned by default** below. What is collected here is written to at the next deployment, so a match has to be a deliberate reference rather than a coincidence.

### For git providers

GitHub, GitLab, Azure DevOps, Bitbucket: the Tickets section of the Pull Request comment lists each record, with its short description and its state.

### For notifications providers

Slack, Microsoft Teams, Google Chat, Email: deployed records are added to the deployment notifications.

### Update ServiceNow records

When the records are deployed in a major org, sfdx-hardis writes a **work note** on each of them, naming the target org, the branch and the Pull Request:

```text
Deployed by sfdx-hardis in Salesforce org acme--uat (https://acme--uat.sandbox.my.salesforce.com)
Branch: integration (https://github.com/acme/sfdx-project/tree/integration)
Pull Request: Block a past close date (https://github.com/acme/sfdx-project/pull/812) by Alice Martin
```

Tagging the records is also possible, and is disabled by default: see [Deployment tag](#deployment-tag).

## Configuration

> When possible, define these properties in the **.sfdx-hardis.yml** file, so that the VS Code SFDX Hardis extension can use them for UI features.

### Credentials

Define the following CI/CD variables. They are the same three variables as [hardis:misc:servicenow-report](hardis/misc/servicenow-report.md), so a project that already reports on ServiceNow has nothing more to configure.

| Variable                | Description                                                                                       |
|-------------------------|---------------------------------------------------------------------------------------------------|
| **SERVICENOW_URL**      | Instance URL, with or without the scheme (`https://acme.service-now.com`, `acme.service-now.com`) |
| **SERVICENOW_USERNAME** | User name of the integration user                                                                 |
| **SERVICENOW_PASSWORD** | Password of the integration user                                                                  |

### Identify ServiceNow records

- .sfdx-hardis.yml property: **serviceNowTicketRegex** or ENV variable **SERVICENOW_TICKET_REGEX**

By default, sfdx-hardis looks for the number of every prefix listed in [Record number prefixes](#record-number-prefixes), followed by at least four digits.

Define a regular expression to narrow that down to the records your project actually uses, for example `(INC[0-9]{7})`.

> The **first capturing group** must be the whole record number: that is what sfdx-hardis reads to find the table and build the link.

### Record number prefixes

A ServiceNow record number carries its table, so the number alone is enough to know where to read it. These prefixes are recognized out of the box:

| Prefix   | Table            | Scanned by default |
|----------|------------------|--------------------|
| `INC`    | `incident`       | yes                |
| `PRB`    | `problem`        | yes                |
| `CHG`    | `change_request` | yes                |
| `RITM`   | `sc_req_item`    | yes                |
| `SCTASK` | `sc_task`        | yes                |
| `DMND`   | `dmn_demand`     | yes                |
| `STRY`   | `rm_story`       | yes                |
| `ENHC`   | `rm_enhancement` | yes                |
| `REQ`    | `sc_request`     | no                 |
| `TASK`   | `task`           | no                 |
| `STORY`  | `rm_story`       | no                 |
| `KB`     | `kb_knowledge`   | no                 |

`REQ`, `TASK`, `STORY` and `KB` are ordinary words followed by digits, and a false positive does not merely add a line to a Pull Request comment: it writes a work note on a real, unrelated record at the next deployment. They are therefore not scanned unless you ask for them, by declaring them in `SERVICENOW_TABLE_PREFIXES` (below) or by writing your own `SERVICENOW_TICKET_REGEX`.

They stay routable by hand either way: `sf hardis:ticket:get --id TASK0001234` works without any extra configuration.

To reach the tables of a **scoped application**, or to scan one of the prefixes above that is off by default, declare your own prefixes:

- .sfdx-hardis.yml property: **serviceNowTablePrefixes** or ENV variable **SERVICENOW_TABLE_PREFIXES**

The value is a comma-separated list of `PREFIX:table` pairs. A prefix declared there overrides the built-in mapping of the same name, and is always scanned.

```yaml
serviceNowTablePrefixes: 'DEFECT:x_acme_defect,TASK:task'
```

### Where the deployment comment is written

- .sfdx-hardis.yml property: **serviceNowCommentField** or ENV variable **SERVICENOW_COMMENT_FIELD**

The default is **work_notes**, the internal journal of the record: on an incident, `comments` is read by the person who reported it, and a Salesforce deployment is not addressed to them.

Set it to `comments` to write in the customer-visible journal instead, or to any other journal field of your tables.

### Deployment tag

- .sfdx-hardis.yml property: **serviceNowAddDeploymentTag** or ENV variable **SERVICENOW_ADD_DEPLOYMENT_TAG** (set to `true`)

Disabled by default, where Jira and Azure Boards tag the tickets they deploy. A ServiceNow tag is a record of the global `label` table, created on first use: no project should get that write without asking for it.

Once enabled, the default tag is `UPPERCASE(branch_name) + "_DEPLOYED"`.

To override it, define the environment variable **DEPLOYED_TAG_TEMPLATE**, which must contain `{BRANCH}`.

Example: `DEPLOYED_TO_{BRANCH}`

Re-deploying the same branch does not stack duplicate tags on the record.

## Read a single ticket

[hardis:ticket:get](hardis/ticket/get.md) fetches one record in full, with its description, its journal entries, its attachments and the manual actions it mentions:

```sh
sf hardis:ticket:get --id INC0012345 --output-file docs/INC0012345/ticket-extract.md
```

## Required ServiceNow permissions

The integration user needs:

- **read** on the tables of the records you reference (`incident`, `change_request`, `dmn_demand`...), and on `sys_journal_field` and `sys_attachment` to read journal entries and attachments.
- **write** on those same tables, for the deployment work note.
- **read and write** on `label` and `label_entry`, only when the deployment tag is enabled.

`sys_journal_field` is ACL-restricted on many instances, and a denied read comes back as an empty result rather than as an error. When it answers nothing, sfdx-hardis falls back to the journal fields carried by the record itself (`comments`, `work_notes`, `close_notes`, `resolution_notes`) and says so in the log.

## Technical notes

This integration uses the following variables, which must be available from the pipelines:

- SERVICENOW_URL
- SERVICENOW_USERNAME
- SERVICENOW_PASSWORD
- SERVICENOW_TICKET_REGEX
- SERVICENOW_TABLE_PREFIXES
- SERVICENOW_COMMENT_FIELD
- SERVICENOW_ADD_DEPLOYMENT_TAG

Records are read and written through the ServiceNow **Table API** (`/api/now/table/...`), with basic authentication, using the shared proxy-aware HTTP client: `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` are honored.

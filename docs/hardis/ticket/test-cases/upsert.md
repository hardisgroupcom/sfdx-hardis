<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:ticket:test-cases:upsert

## Description


## Command Behavior

**Sends the test cases of a notebook to Azure DevOps, ServiceNow Test Management or Xray Cloud, creating the missing ones and updating the others.**

[hardis:ticket:test-cases:init](https://sfdx-hardis.cloudity.com/hardis/ticket/test-cases/init/) writes the notebook, a tester reviews it, and this command sends the reviewed version to the test management tool. No AI is involved: a notebook committed next to the code and a CI job keep the tool in sync.

- **Upsert:** every case carries the key `TESTKIT:<TICKET>:<SHORT ID>`. A second run updates the cases it created instead of duplicating them.
- **Unfinished notebooks are refused:** an empty title or expected result, a `TO BE COMPLETED` marker, a template token such as `{SCENARIO_TITLE}` or a literal `null` blocks the whole upsert, and every problem is listed at once.
- **Updates keep what the team changed in the tool:** assignee, area, iteration and labels added by hand stay, and a column the notebook does not have (priority, steps...) is not sent.
- **Best effort per case:** one case failing does not stop the others. Exit code 0 when everything went through, 2 when some cases failed, 1 when nothing could be attempted.
- **Dry run** (`--dry-run`): checks the notebook, the connection and the carrier tickets, and tells which cases would be created or updated, without writing anything.
- **Report:** a CSV and XLSX file with the action, tracker id and URL of each case.

### Choosing the test management tool

The tool is never guessed from the environment variables that happen to be set, because the sfdx-hardis CI templates already set the Azure DevOps ones on every Azure pipeline:

1. `--provider` (`azure-devops`, `servicenow` or `xray`)
2. else the `testCasesProvider` property of `config/.sfdx-hardis.yml`
3. else, in an interactive session, a prompt listing the configured tools. In CI and in agent mode the command fails instead.

### Configuration

The variables sfdx-hardis already uses for these tools, from CI/CD variables or a local **.env** file:

| Tool | What is written | Settings |
|------|-----------------|----------|
| `azure-devops` | A Test Case work item with its steps, tagged and linked to its user story | `CI_SFDX_HARDIS_AZURE_TOKEN` (or `SYSTEM_ACCESSTOKEN` or `AZURE_DEVOPS_EXT_PAT`), plus `SYSTEM_COLLECTIONURI` and `SYSTEM_TEAMPROJECT`, read from the git remote when unset |
| `servicenow` | A Test Management 2.0 test, its version and its steps | `SERVICENOW_URL`, `SERVICENOW_USERNAME`, `SERVICENOW_PASSWORD` |
| `xray` | A Jira Test issue with its steps, labelled and linked to its story | `XRAY_CLIENT_ID`, `XRAY_CLIENT_SECRET`, `JIRA_HOST` (or `jiraHost` config), `JIRA_PROJECT_KEY`, `JIRA_EMAIL`, `JIRA_TOKEN`, and `XRAY_REGION` (`us`, `eu` or `au`) when not on the global endpoint |

<details markdown="1">
<summary>Technical explanations</summary>

- **Idempotency key:** `TESTKIT:<TICKET>:<SHORT ID>`, the ticket being the one of the identifier, so `--ticket-number` never changes it. Azure DevOps stores it as a tag, Xray as a label, ServiceNow as a `[TESTKIT:...]` prefix of the test short description. Every search result is checked against the exact key before it is updated.
- **Carrier ticket:** the ticket of the identifier, or `--ticket-number`. Azure DevOps uses its last group of digits as work item number (`PROJ-2026-14545` gives 14545), and reads that work item before any write: a missing one refuses the run. A new test case inherits its area, iteration and assignee; an unassigned story leaves the test case unassigned.
- **Descriptions** are written in English whatever the language of sfdx-hardis, so runs from different machines do not rewrite each other. Azure DevOps descriptions are HTML: the text is escaped first, then links, `code` and `**bold**` become tags. ServiceNow and Jira descriptions are plain text, where a markdown link becomes its URL.
- **ServiceNow steps:** Test Management 2.0 has no expected result field on `sn_test_management_step`, so the expected result is written in the step text, after `Expected result:`.
- **Proxy:** ServiceNow and Xray calls go through the proxy-aware HTTP client (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`).

</details>

### Agent Mode

Use `--agent` to disable all interactive prompts: the confirmation before writing is skipped, and the tool must come from `--provider` or from the `testCasesProvider` configuration.

```sh
sf hardis:ticket:test-cases:upsert --notebook docs/tests/PROJ-123.xlsx --provider xray --agent
```

The same applies in CI.

### Known limitations

- **Azure DevOps test cases are not added to a Test Plan nor a Test Suite.**
- **ServiceNow matching uses the title prefix:** removing `[TESTKIT:...]` from a test short description in ServiceNow makes the next run create a duplicate.
- **ServiceNow and Xray updates do not change the steps:** ServiceNow steps may already have been run, and Xray has no mutation to update the steps of a test.
- **Jira descriptions have no formatting:** they are sent as plain text.
- **A partial create is not repaired by a rerun:** a failed story link, reported with the tracker id, has to be added by hand, and a ServiceNow test whose version or steps failed, reported with its URL, has to be completed or deleted by hand.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|dry-run|boolean|Check the notebook and the tool, and list what would be created or updated, without writing||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|notebook<br/>-n|option|Notebook to upsert: .md, .xlsx or .csv||||
|outputfile<br/>-f|option|Path of the generated upsert report||||
|provider<br/>-p|option|Test management tool to send the test cases to. Defaults to the testCasesProvider configuration|||azure-devops<br/>servicenow<br/>xray|
|testsjsonfile<br/>-j|option|NormalizedTestCase[] JSON file, for a pipeline that skips the notebook||||
|ticket-number|option|Carrier ticket the test cases are linked to, instead of the one of their ID||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:ticket:test-cases:upsert --notebook docs/tests/PROJ-123.xlsx
```

```shell
$ sf hardis:ticket:test-cases:upsert --notebook docs/tests/PROJ-123.xlsx --provider azure-devops --dry-run
```

```shell
$ sf hardis:ticket:test-cases:upsert --testsjsonfile cases.json --provider xray --agent
```

```shell
$ sf hardis:ticket:test-cases:upsert --notebook docs/tests/PROJ-123.xlsx --agent
```



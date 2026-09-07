<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:ticket:test-cases:upsert

## Description


## Command Behavior

**Sends the test cases of a notebook to Azure DevOps, ServiceNow Test Management or Xray Cloud, creating what does not exist yet and updating what does.**

This is the second half of the chain. [hardis:ticket:test-cases:init](https://sfdx-hardis.cloudity.com/hardis/ticket/test-cases/init/) writes the notebook from the test cases an agent drafted, a human reviews and corrects it in Excel, and this command sends the corrected version to the test management tool the team actually uses. It runs **without any AI involvement**: a notebook committed next to the code plus a CI job keeps the tracker in sync at every merge.

It provides:

- **Upsert, not blind insert.** Every case carries the key `TESTKIT:<TICKET>:<ID>`. A second run updates the cases it already created instead of duplicating them, which is what makes the command safe in a pipeline.
- **Refusal of an unfinished notebook.** A case still holding the completion marker, an unsubstituted template token, or a stringified `null` blocks the **whole** upsert, listing every offender at once. Sending half a notebook to a client tracker only creates cleanup work.
- **Best effort per case.** One case failing does not abandon the others, and one provider being unreachable does not block the rest. The command returns 0 when everything went through, 2 when some cases failed, and 1 when nothing could even be attempted.
- **A dry run** (`--dry-run`) that validates the notebook and probes every provider without writing anything.
- **A CSV and XLSX report** of what was created, updated or failed, with the tracker id and URL of each case.

### Provider detection

Providers turn themselves on from their own environment variables, so there is nothing to declare in the configuration and `--provider` is only needed to narrow down to one of them:

| `--provider` | Target | What is written |
|----------------|--------|-----------------|
| `azure-devops` | Azure DevOps | A Test Case work item, tagged, with its steps as `Microsoft.VSTS.TCM.Steps` |
| `servicenow` | ServiceNow Test Management 2.0 | A test, its version, and one step record per step |
| `xray` | Xray Cloud on Jira | A Jira Test issue with its steps, labelled |

`--provider` only ever **narrows**: a provider whose variables are unset stays inactive even when named explicitly, so the flag can never be a way around authentication.

### Configuration

The command reuses the variables sfdx-hardis already documents, read from CI/CD variables or from a local **.env** file:

- **Azure DevOps:** `SYSTEM_COLLECTIONURI` + `SYSTEM_TEAMPROJECT` + (`CI_SFDX_HARDIS_AZURE_TOKEN` or `SYSTEM_ACCESSTOKEN`)
- **ServiceNow:** `SERVICENOW_URL` + `SERVICENOW_USERNAME` + `SERVICENOW_PASSWORD`
- **Xray:** `XRAY_CLIENT_ID` + `XRAY_CLIENT_SECRET` + `JIRA_HOST` + `JIRA_PROJECT_KEY` + `JIRA_EMAIL` + `JIRA_TOKEN`, plus `XRAY_REGION` (`us`, `eu` or `au`) when the instance is not on the global endpoint

When no provider is active, the command names the variables that would have to be set rather than reporting an empty result.

<details markdown="1">
<summary>Technical explanations</summary>

- **Idempotency key:** `TESTKIT:<TICKET>:<SHORT ID>`, the short id being the identifier stripped of its ticket prefix. Cases already sent carry this exact string, so it is covered by a non-regression test.
- **Azure DevOps context inheritance:** `System.AreaPath`, `System.IterationPath` and `System.AssignedTo` are read from the carrier work item and copied onto each case. Without the area path, Azure DevOps rejects the very first case with a 403. The carrier is read once per run, not once per case, and a carrier that cannot be read fails the run before anything is written. An unassigned carrier leaves the cases unassigned: no recipient is ever invented.
- **Carrier work item number:** the last group of digits of the ticket key, so `DSI-11533` and `DSI-2026-11533` both resolve to work item 11533. A ticket key carrying no digits raises rather than asking the API for item `NaN`.
- **Text conversion:** the Azure DevOps description is HTML, so the notebook text is escaped **first** and only then are its `[label](url)`, ``code`` and `**bold**` constructs turned into tags. Reversing the two would open an HTML injection. The ServiceNow and Jira descriptions are plain text, so a markdown link is reduced to its bare URL instead of showing literal brackets.
- **Proxy support:** the ServiceNow and Xray calls go through the shared proxy-aware HTTP client, so `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` are honored.

</details>

### Agent Mode

Use `--agent` to disable all interactive prompts. In agent mode the confirmation asked before any write is skipped, so the flags must carry everything: a notebook (`--notebook` or `--testsjsonfile`) is required, and the provider variables must be set in the environment.

```sh
sf hardis:ticket:test-cases:upsert --notebook docs/tests/DSI-11533.xlsx --agent
```

The same skip applies in CI, where `isCI` is true.

### Known limitations

- **Azure DevOps cases are created isolated:** they are linked to their carrier user story, but attached to no Test Plan and no Test Suite. Adding them to a plan stays a human action.
- **ServiceNow idempotency rests on the title.** Test Management 2.0 exposes no portable correlation field on `sn_test_management_test`, so idempotency relies on the `[TESTKIT:<TICKET>:<ID>]` prefix of `short_description`. Renaming a test case in ServiceNow breaks the match, and the next run creates a duplicate instead of updating it. Keep the prefix in the title.
- **ServiceNow updates do not touch the steps** of an existing test version: replacing them would delete rows a tester may already have executed against.
- **No ADF conversion on the Jira description:** it is sent as a plain string, so it renders without formatting.
- **Return codes:** 0 when every case went through, 2 when some failed, 1 when nothing could be attempted.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|dry-run|boolean|Validate the notebook and probe the providers, write nothing||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|notebook<br/>-n|option|Notebook to upsert, as reviewed by a human: .md, .xlsx or .csv||||
|outputfile<br/>-f|option|Force the path of the generated upsert report||||
|provider<br/>-p|option|Narrow the upsert to a single provider instead of using every configured one|||azure-devops<br/>servicenow<br/>xray|
|testsjsonfile<br/>-j|option|Pre-normalized NormalizedTestCase[] JSON file, for a pipeline that skips the notebook||||
|ticket-number|option|Carrier ticket key, overriding the one derived from the ID column||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:ticket:test-cases:upsert --notebook docs/tests/DSI-11533.xlsx
```

```shell
$ sf hardis:ticket:test-cases:upsert --notebook docs/tests/DSI-11533.xlsx --dry-run
```

```shell
$ sf hardis:ticket:test-cases:upsert --notebook cahier.xlsx --provider azure-devops
```

```shell
$ sf hardis:ticket:test-cases:upsert --testsjsonfile cases.json --agent
```



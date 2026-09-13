<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:ticket:test-cases:init

## Description


## Command Behavior

**Writes the test cases of a ticket into a notebook a tester reviews and fills in: an Excel workbook, a CSV or a markdown table.**

The test cases usually come from a `NormalizedTestCase[]` JSON file written by an AI agent that read the specification and the code. This command turns them into a file a human can read and correct, then [hardis:ticket:test-cases:upsert](https://sfdx-hardis.cloudity.com/hardis/ticket/test-cases/upsert/) sends the corrected file to the test management tool.

- **One column set per kind of notebook.** Functional notebooks have the steps and a helper SOQL query, technical notebooks have the Apex class and method under test, maintenance notebooks have no module nor priority. The kind comes from the `ID` column, or from `--kind`.
- **Tester columns:** `Actual result`, `Comment` and `Status` (a value list: Passed, Failed, Blocked, N/A). They are written empty for new cases, and kept when an existing notebook is converted to another format.
- **A summary** of the cases per module and priority, in its own sheet or under the CSV rows.
- **Readable back:** every file written here is read by `upsert`, after a tester corrected it.
- **A blank notebook** when no test case is given, with identifiers already filled.

### Input

The format is read from the file extension:

| Input | Flag | Typical producer |
|-------|------|------------------|
| JSON test cases | `--testsjsonfile` | An AI agent that read the ticket and the code |
| An existing notebook (.md, .xlsx, .csv) | `--notebook` | A previous run of this command, or a notebook a tester filled in |
| Nothing | neither flag | Blank notebook |

### Output

- Format: `--format` (`xlsx` by default, `both` writes the xlsx and the CSV), or the extension of `--outputfile`.
- File: `--outputfile`, or `hardis-report/test-cases-<TICKET>-<KIND>-<DATE>.<ext>`.
- An existing file is never overwritten silently: the command asks first, and refuses in CI and in agent mode.

### Configuration

None: this command reads a file and writes a file, without org, provider nor secret.

<details markdown="1">
<summary>Technical explanations</summary>

- **JSON contract:** `id`, `title` and `expected` are required. `module`, `priority` (1, 2 or 3), `preconditions`, `target`, `soql` and `steps` (`[{ "action": "...", "expected": "..." }]`) are optional. Every problem of an entry is reported at once, with its index.
- **Identifiers:** `<TICKET>-F01` functional, `<TICKET>-T01` technical, `<TICKET>-01` maintenance, with a 2 or 3 digit counter. Letters, digits, `_`, `.`, `#` and `-` only. The ticket and the kind are derived from the identifier, and an unreadable one is refused.
- **Steps cell:** one numbered line per step, `1. Open the record → The record page is displayed`. The first `→` or `->` separates the action from its expected result, and a step without arrow has no expected result. An arrow inside an action is written `=>`, so it is not read as the separator. Steps are separated by a line break in the xlsx, and by `<br>` in the CSV and in markdown.
- **CSV:** `,` delimiter, UTF-8 with BOM so Excel reads the accents, CRLF line endings. A cell starting with `=`, `+`, `-` or `@` is prefixed with an apostrophe, so a spreadsheet does not run it as a formula. The reader detects `,` or `;`.
- **Headers:** the reader also accepts the French headers of earlier notebooks (`Cas de test`, `Étapes`, `Résultat attendu`...).

</details>

### Agent Mode

Use `--agent` to disable all interactive prompts. Without test cases, `--kind` and `--ticket-number` are required. An existing output file makes the command fail instead of asking.

```sh
sf hardis:ticket:test-cases:init --testsjsonfile cases.json --agent
```

The same applies in CI.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|format|option|Output format: xlsx (default), csv, md, or both for xlsx and csv. Defaults to the extension of --outputfile|||xlsx<br/>csv<br/>md<br/>both|
|json|boolean|Format output as json.||||
|kind<br/>-k|option|Column set to write. Defaults to the kind derived from the ID column|||functional<br/>technical<br/>maintenance|
|modules|option|Module names of a blank notebook, one group of rows each||||
|notebook<br/>-n|option|Existing notebook to read the test cases from: .md, .xlsx or .csv||||
|outputfile<br/>-f|option|Path of the generated notebook||||
|rows|option|Rows per module of a blank notebook|3|||
|testsjsonfile<br/>-j|option|NormalizedTestCase[] JSON file holding the test cases to write||||
|ticket-number|option|Ticket key of a blank notebook. With test cases, sets their carrier ticket||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:ticket:test-cases:init --testsjsonfile cases.json
```

```shell
$ sf hardis:ticket:test-cases:init --testsjsonfile cases.json --format both --outputfile ./PROJ-123.xlsx
```

```shell
$ sf hardis:ticket:test-cases:init --notebook docs/tests/PROJ-123.xlsx --outputfile docs/tests/PROJ-123.md
```

```shell
$ sf hardis:ticket:test-cases:init --kind functional --ticket-number PROJ-123 --modules Opportunity --rows 5 --agent
```

```shell
$ sf hardis:ticket:test-cases:init --testsjsonfile cases.json --agent
```



<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:ticket:test-cases:init

## Description


## Command Behavior

**Writes the test cases of a ticket into a notebook a human can review and correct: an Excel workbook, a CSV, or a markdown table.**

The test cases come **in**, as a `NormalizedTestCase[]` JSON payload. That payload is what an AI agent produces after reading the specification and the code, and this command turns it into the artifact a tester actually works in. The point is not that somebody types test cases from scratch: it is that the ones already written get a shape that can be read, corrected, and then sent to a tracker with [hardis:ticket:test-cases:upsert](https://sfdx-hardis.cloudity.com/hardis/ticket/test-cases/upsert/).

It provides:

- **A column set per notebook kind.** The functional notebook carries the advisory SOQL query and the steps; the technical one carries the class and method under test instead; the TMA one drops the module and the priority. The kind is derived from the `ID` column, or forced with `--kind`.
- **The reviewer's columns left empty:** `Résultat obtenu`, `Commentaire` and `Statut`. Filling them would be answering for the tester.
- **A `Statut` column restricted to a value list**, so a campaign can be counted rather than read, plus a per-module summary sheet with the counts by priority.
- **A round trip that holds.** The workbook this command writes is read back by the very same parser, so the corrections a human makes in Excel survive all the way to the tracker.
- **A blank notebook as a fallback.** Without `--testsjsonfile`, the command writes the scaffolding with its identifiers pre-filled and its cells empty, for the rare case where nobody has drafted the cases yet.

### Where the test cases come from

Any of these, and the format is read from the file extension rather than sniffed from the content:

| Input | Flag | Typical producer |
|-------|------|------------------|
| Pre-normalized JSON | `--testsjsonfile` | An AI agent that read the ticket and the code. **The main path.** |
| An existing notebook | `--notebook` | A previous run of this command, or a workbook a tester has filled in |
| Nothing | neither flag | The blank scaffolding fallback |

### Configuration

None. This command reads a file and writes a file: no org, no project, no provider, no secret.

<details markdown="1">
<summary>Technical explanations</summary>

- **Public contract:** `--testsjsonfile` accepts a `NormalizedTestCase[]` payload, validated field by field with the array index and the field name in the error message, so a generator can be fixed without reading this source. That contract is the seam between the agent that writes the cases and the deterministic code that renders and sends them.
- **Identifier convention:** `<TICKET>-F01` functional, `<TICKET>-T01` technical, `<TICKET>-01` TMA. The ticket and the kind are both derived from the identifier, and an unreadable one raises rather than guessing, because guessing "functional" for a technical case renders the wrong column set.
- **Formula injection guard:** every cell is passed through a guard that prefixes an apostrophe to any value starting with `=`, `+`, `-` or `@`. Those are executed by Excel and LibreOffice on open, and a notebook is written by one party and opened by another.
- **CSV shape:** `;` delimiter, UTF-8 **with a BOM** so Excel opens the accents on a double click, CRLF line endings, and a summary footer padded to the header width. The reader stops at that footer marker rather than turning the summary rows into malformed test cases.
- **Step rendering:** the steps of a case are rendered into a single cell, numbered, with a separator chosen so the cell can be read back. A real line break in the xlsx, which is also what a tester wants to see; a `<br>` in the CSV, because a CSV field has to stay on one physical line.
- **Column width detail:** the priority column is 9.5 characters wide and not 9. ExcelJS treats a width equal to the default column width (9) as "not custom" and omits it on write, so a width of exactly 9 reads back undefined.

</details>

### Agent Mode

Use `--agent` to disable all interactive prompts. In agent mode nothing is guessed: when no test cases are supplied, `--kind` and `--ticket-number` become required and a missing one raises an error naming the flag.

```sh
sf hardis:ticket:test-cases:init --testsjsonfile cases.json --agent
```

The same applies in CI, where `isCI` is true.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|format|option|Output format. "both" writes the xlsx and the CSV side by side|xlsx||xlsx<br/>csv<br/>md<br/>both|
|json|boolean|Format output as json.||||
|kind<br/>-k|option|Column set to write. Defaults to the kind derived from the ID column|||functional<br/>technical<br/>tma|
|modules|option|Module names of the blank scaffolding, one group of rows each. Ignored when test cases are supplied||||
|notebook<br/>-n|option|Existing notebook to read the test cases from instead: .md, .xlsx or .csv||||
|outputfile<br/>-f|option|Force the path of the generated notebook||||
|rows|option|Rows per module of the blank scaffolding. Ignored when test cases are supplied|3|||
|testsjsonfile<br/>-j|option|NormalizedTestCase[] JSON file holding the test cases to write. The main input||||
|ticket-number|option|Ticket key the test cases belong to, overriding the one derived from the ID column||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:ticket:test-cases:init --testsjsonfile cases.json
```

```shell
$ sf hardis:ticket:test-cases:init --testsjsonfile cases.json --format both --outputfile ./DSI-11533.xlsx
```

```shell
$ sf hardis:ticket:test-cases:init --notebook docs/tests/DSI-11533.md --format csv
```

```shell
$ sf hardis:ticket:test-cases:init --agent --kind functional --ticket-number DSI-11533 --modules Opportunite --rows 5
```



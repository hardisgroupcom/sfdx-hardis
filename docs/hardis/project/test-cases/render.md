<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:test-cases:render

## Description


## Command Behavior

**Turns a test notebook into the deliverable a tester actually works in: a formatted Excel workbook, or a CSV Excel opens cleanly on a double click.**

The input can be a markdown table, an existing workbook, a CSV, or a pre-normalized JSON payload. The output is a workbook whose result columns are left empty, for a human to fill in during the test campaign.

It provides:

- **A column set per notebook kind.** The functional notebook carries the query and the steps; the technical one carries the class and method under test instead; the TMA one drops the module and the priority. The kind is derived from the `ID` column, or forced with `--kind`.
- **The tester's columns left empty:** `Résultat obtenu`, `Commentaire` and `Statut`. Pre-filling them would be answering for the tester.
- **A `Statut` column restricted to a value list**, so a campaign can be counted instead of being read.
- **Readable formatting:** frozen bold header on a grey fill, wrapped cells aligned to the top, an autofilter, and a per-module summary sheet with the counts by priority.
- **A round trip that holds.** The workbook this command writes is read back by the very same parser, once the tester has filled in the result columns, so a finished campaign can be re-read without anything being retyped.

### Configuration

None. This command reads a file and writes a file: no org, no project, no provider, no secret.

<details markdown="1">
<summary>Technical explanations</summary>

- **Formula injection guard:** every cell is passed through a guard that prefixes an apostrophe to any value starting with `=`, `+`, `-` or `@`. Those are executed by Excel and LibreOffice on open, and a notebook is written by one human and opened by another.
- **CSV shape:** `;` delimiter, UTF-8 **with a BOM** so Excel opens the accents on a double click, CRLF line endings, and a summary footer padded to the header width. The reader stops at that footer marker rather than turning the summary rows into malformed test cases.
- **Step rendering:** the steps of a case are rendered into a single cell, numbered, with a separator chosen so the cell can be read back. A real line break in the xlsx, which is also what a tester wants to see; a `<br>` in the CSV, because a CSV field has to stay on one physical line.
- **Why not the report writer:** `generateCsvFile` writes comma delimited reports with no BOM and decorates them with an Excel table whose theme rewrites the rows. A test notebook needs the opposite shape, and going through the report writer would break the round trip. The report path helper and the IDE notification are reused; the workbook is written directly with ExcelJS.
- **Column width detail:** the priority column is 9.5 characters wide and not 9. ExcelJS treats a width equal to the default column width (9) as "not custom" and omits it on write, so a width of exactly 9 reads back undefined.

</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|format|option|Output format|xlsx||xlsx<br/>csv<br/>both|
|json|boolean|Format output as json.||||
|kind<br/>-k|option|Column set to render. Defaults to the kind derived from the ID column|||functional<br/>technical<br/>tma|
|notebook<br/>-n|option|Notebook file to render: .md, .xlsx or .csv||||
|outputfile<br/>-f|option|Force the path of the generated notebook||||
|testsjsonfile|option|Pre-normalized NormalizedTestCase[] JSON file||||
|ticket-number|option|Carrier ticket key, overriding the one derived from the ID column||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:test-cases:render --notebook docs/tests/PROJ-123.md
```

```shell
$ sf hardis:project:test-cases:render --notebook docs/tests/PROJ-123.md --format csv
```

```shell
$ sf hardis:project:test-cases:render --notebook cahier.md --format both --outputfile ./PROJ-123.xlsx
```

```shell
$ sf hardis:project:test-cases:render --testsjsonfile cases.json --kind technical
```



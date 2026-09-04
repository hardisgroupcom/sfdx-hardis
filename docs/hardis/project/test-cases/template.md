<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:test-cases:template

## Description


## Command Behavior

**Generates an empty test notebook with the expected columns and pre-filled identifiers, so a tester can start writing test cases straight away.**

This is the entry point of the chain: `template` produces the blank notebook, a human fills it in, and `render` turns it into the deliverable workbook a tester works in. The identifiers it writes follow the convention the parser reads, so nothing has to be fixed by hand between the steps.

It provides:

- **A column set per notebook kind** (`functional`, `technical`, `tma`), the same sets `render` uses.
- **Identifiers pre-filled and numbered continuously** across the module groups: `PROJ-123-F01`, `-F02`, `-F03`. They never restart at each module, because two cases sharing an identifier are indistinguishable to anything that reads the notebook back.
- **One group of rows per module** (`--modules`), with the module name carried on every row of its group.
- **Three output formats:** a formatted workbook, a CSV, or a markdown table.
- **Interactive guidance:** every missing value is asked for, in the terminal or in the VS Code panel, whichever is running.

### Configuration

None. No org, no project, no provider, no secret.

<details markdown="1">
<summary>Technical explanations</summary>

- **Identifier convention:** `<TICKET>-F01` functional, `<TICKET>-T01` technical, `<TICKET>-01` TMA. A unit test feeds every generated identifier back through the shared derivation, so the loop is closed by construction rather than by inspection.
- **Ticket default:** the current git branch is proposed, its ticket key extracted with the same regex machinery the ticketing providers use.
- **Interactive rendering:** the prompts go through `prompts.ts`, which routes to the LWC UI of the VS Code extension when it is running and falls back to the terminal otherwise. There is no interface code in this command.
- **Opening the result:** the generated file is announced with `requestOpenFile`. For an `.xlsx` the VS Code extension hands it to the default application, so it opens in Excel rather than as XML in the editor.

</details>

### Agent Mode

Use `--agent` to disable all interactive prompts. In agent mode nothing is guessed: `--kind` and `--ticket-number` are required, and a missing one raises an error naming the flag.

```sh
sf hardis:project:test-cases:template --agent --kind functional --ticket-number PROJ-123 --modules Devis --rows 2
```

The same applies in CI, where `isCI` is true.


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|format|option|Output format|xlsx||xlsx<br/>csv<br/>md|
|json|boolean|Format output as json.||||
|kind<br/>-k|option|Notebook kind, which decides the column set and the identifier prefix|||functional<br/>technical<br/>tma|
|modules|option|Module names, one group of rows each||||
|outputfile<br/>-f|option|Force the path of the generated notebook||||
|rows|option|Number of empty rows per module|3|||
|ticket-number|option|Carrier ticket key the identifiers are built from. Defaults to the current git branch||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:test-cases:template
```

```shell
$ sf hardis:project:test-cases:template --kind functional --ticket-number PROJ-123
```

```shell
$ sf hardis:project:test-cases:template --kind technical --ticket-number PROJ-123 --modules Devis --modules Contrat --rows 5
```

```shell
$ sf hardis:project:test-cases:template --agent --kind functional --ticket-number PROJ-123 --format md
```



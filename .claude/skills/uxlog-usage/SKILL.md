---
name: uxlog-usage
description: How to pick the correct uxLog level (action, log, warning, error, success, other), the matching chalk color, the options object (sensitive, alwaysVisible), VS Code UI suppression, and uxLogTable. Use when adding or modifying any uxLog call.
user-invocable: false
---

# uxLog Usage

`uxLog` writes to three sinks at once:

1. The terminal (via `commandThis.ux.log` or `console.log`).
2. The `hardisLogFileStream` file log.
3. The VS Code (LWC) UI over WebSocket - **except** when `logType === "other"`, or the line contains the markers `[command]` or `[NotifProvider]`.

The `logType` argument both labels the line in the UI (drives section grouping, icons, colors) and decides whether the line reaches the UI at all. Pick it deliberately.

## Import

```typescript
import { uxLog, uxLogTable } from "../../../common/utils/index.js";
import c from "chalk";
import { t } from "../../../common/utils/i18n.js";
```

## Levels and colors (strict 1:1 pairing)

Always pair the level with its chalk color. Mixing them confuses the terminal output and breaks the convention used across ~2000 existing call sites.

| Level     | Chalk color                  | When to use                                                                                                                                                  |
|-----------|------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `action`  | `c.cyan`                     | A new major step. Opens a new section / log group in the VS Code LWC UI. One per logical phase (e.g. "Querying", "Generating report", "Deploying metadata"). |
| `log`     | `c.grey`                     | Sub-detail beneath the current `action`. Counts, file paths, timings, intermediate state.                                                                    |
| `warning` | `c.yellow`                   | Recoverable issue the user should review. Operation continues.                                                                                               |
| `error`   | `c.red`                      | Failure or blocking issue. Operation is aborting or the result is unusable.                                                                                  |
| `success` | `c.green`                    | Confirmed successful completion of an operation, often the closing line of an `action` block.                                                                |
| `other`   | none / `c.grey` / `c.italic` | Console + file only. NOT forwarded to the VS Code UI. Use for raw JSON dumps, verbose debug, or chatter that would clutter the UI session log.               |
| `table`   | (internal)                   | Used by `uxLogTable` only. Do **not** call `uxLog("table", ...)` directly.                                                                                   |

### Examples

```typescript
// New phase - opens a UI section
uxLog("action", this, c.cyan(t("deployingMetadata", { metadata: name })));

// Detail under that action
uxLog("log", this, c.grey(t("foundFiles", { count: files.length })));
uxLog("log", this, c.grey(`- ${reportFile}`));

// Recoverable issue
uxLog("warning", this, c.yellow(t("missingOptionalConfig", { key: "slackWebhook" })));

// Failure
uxLog("error", this, c.red(t("deploymentFailed", { message: e.message })));

// Successful completion
uxLog("success", this, c.green(t("deploymentSucceeded", { org: targetOrg })));

// Debug payload that should NOT pollute the VS Code UI
uxLog("other", this, JSON.stringify(rawApiResponse, null, 2));
```

### Pitfalls to avoid

- Do not use `c.green` with `error`, `c.red` with `success`, etc. The level and color must match.
- Do not use `action` for sub-details - that creates spurious sections in the UI. One `action` per phase, then `log` for everything underneath.
- Do not use `log` (which goes to the UI in grey) for noisy diagnostic output - prefer `other`.
- Do not omit chalk - every `uxLog` should be wrapped in the matching color so terminal output stays readable.

## Options (4th argument)

The optional fourth argument is a `UxLogOptions` object: `{ sensitive?: boolean; alwaysVisible?: boolean }`.

```typescript
uxLog("log", this, c.grey(`Authenticating with token ${token}`), { sensitive: true });
uxLog("action", this, c.cyan("Installation summary:"), { alwaysVisible: true });
```

> Backward compatibility: the 4th argument also still accepts a bare boolean (the legacy `sensitive` flag), because `uxLog` is called by external plugins. `uxLog(..., true)` is equivalent to `uxLog(..., { sensitive: true })`. **For new code, always use the options object.**

### `sensitive`

Set `{ sensitive: true }` when the line contains credentials, tokens, secrets, or any data that must not land in the file log or the VS Code UI. Use it for any line that interpolates an access token, refresh token, client secret, password, or third-party API key.

Behaviour:

- Terminal: shows the real text (so the user running the command can still see it locally).
- File log (`hardisLogFileStream`): writes the literal string `OBFUSCATED LOG LINE`.
- VS Code UI: sends `OBFUSCATED LOG LINE`. Exception: lines containing `SFDX_CLIENT_ID_`, `SFDX_CLIENT_KEY_`, or `SFDX_CLIENT_CERT_` are sent as-is even when `sensitive` is set.

### `alwaysVisible`

Set `{ alwaysVisible: true }` to keep the enclosing VS Code UI section expanded by default, instead of auto-collapsing when a later section opens (and staying open in the UI's "simple" mode too). A manual collapse by the user still wins.

- On an `action` line: keeps the section that line **starts** expanded.
- On any other level (`log`, `warning`, `error`, ...): keeps the section that **contains** the line expanded.

Use it for a summary block the user should keep seeing while they act on the next prompt (e.g. an install summary shown just before a confirmation). No effect outside the VS Code LWC UI.

## VS Code / LWC UI suppression

The VS Code extension only renders lines whose `logType !== "other"` AND whose text does not include the markers `[command]` or `[NotifProvider]`.

Practical consequences:

- For raw payloads, JSON dumps, or noisy progress that would overwhelm the UI session log, use `uxLog("other", ...)`. The terminal and file log still receive it.
- The `[command]` and `[NotifProvider]` prefixes are reserved for internal command-execution and notification-provider lines that the UI handles through dedicated events; do not introduce new uses of those markers in unrelated code.
- Other `[Marker]` prefixes (e.g. `[DORA]`, `[sfdx-hardis]`) are fine and **are** forwarded to the UI.

## uxLogTable

For tabular output, do not hand-format a table inside `uxLog`. Use `uxLogTable`, which renders an aligned text table to the terminal/file log AND emits a structured `table` payload to the LWC UI.

```typescript
import { uxLogTable } from "../../../common/utils/index.js";

uxLogTable(this, [
  { name: "Account", recordCount: 42, status: "ok" },
  { name: "Contact", recordCount: 17, status: "ok" },
], ["name", "recordCount", "status"]);
```

- Second arg: array of plain objects (rows).
- Third arg (optional): column order. Omit to use the keys of the first row.
- Booleans are auto-rendered as checkbox emoji via `bool2emoji`.
- The LWC UI receives a JSON payload truncated at 20 rows with a "truncated" indicator row appended when the dataset is larger.

### A table that can hold more than 20 rows must always come with a report file

The VS Code UI never displays more than `UX_LOG_TABLE_MAX_UI_ROWS` (20) rows, and invites the user to open the
associated CSV / XLS report instead. So every table whose row count is data-driven (query results, file lists,
metadata items, users, errors...) must also produce a report file.

Use `uxLogTableWithReport` from `src/common/utils/filesUtils.ts`: it displays the table and, when the dataset
exceeds 20 rows, writes the CSV (plus its XLSX twin) and pushes it to the UI as a report.

```typescript
import { uxLogTableWithReport } from "../../../common/utils/filesUtils.js";

await uxLogTableWithReport(this, rows, ["type", "fullName", "status"], {
  fileNamePrefix: "mdapi-read-successes",
  fileTitle: "Metadata read successes",
});
```

- Keep plain `uxLogTable` only for tables whose size is bounded by construction (a fixed summary, a handful of
  config keys, a per-status counter). Anything that grows with the org or the project needs the report.
- When the command already generates its own report covering the same rows (`generateReports`,
  `generateCsvFile`, a generated markdown/XLSX file sent with `sendReportFileMessage`), keep `uxLogTable`:
  the requirement is that the full list is reachable, not that it is written twice.
- `fileNamePrefix` must be unique per table inside a command, otherwise two tables overwrite each other's report.

## A prompt must always be followed by an `uxLog("action", ...)`

After the user answers a `prompts()` call, the VS Code UI needs a new section before it renders anything else:
**any output that is not `uxLog("action", ...)` is hidden**. This covers `log`, `warning`, `error`, `success`,
`uxLogTable`, and command execution (`execCommand` / `execSfdxJson` / `wrapSfdxCoreCommand` write their own
lines and open sub-command entries in the UI).

So, on every code path leaving a prompt, the first thing that produces output must be an `action`:

```typescript
const confirmRes = await prompts({ type: "confirm", name: "value", message: t("confirmDelete") });
if (confirmRes.value !== true) {
  // Conclusion of the user's answer: make it the action itself
  uxLog("action", this, c.cyan(t("operationCancelledByUser")));
  return {};
}
// Real work starts: open the section before anything logs or runs
uxLog("action", this, c.cyan(t("deletingApexLogs", { count: apexLogsNumber })));
await execCommand(deleteCommand, this, { output: true, fail: true });
```

Two ways to fix a case, pick the one that reads best:

1. **Convert the next log into an `action`** when it concludes the user's answer ("cancelled by user",
   "nothing selected", "skipping X"). Remember to switch the chalk color to `c.cyan` at the same time.
2. **Insert the missing `action`** when the next output is a detail line, a table, a loop, or a command
   execution: the phase header was simply missing.

This also applies to the prompt wrappers (`promptOrg`, `promptProfiles`, `promptUserEmail`,
`promptTargetBranch`, `MetadataUtils.promptMetadataTypes`, `selectDataWorkspace`,
`selectFilesWorkspace`, the `promptText` / `promptSelect` / `promptConfirm` helpers...), and it crosses
function boundaries: when a helper ends with a prompt, the caller is responsible for the `action`.

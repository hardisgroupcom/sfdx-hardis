---
name: uxlog-usage
description: How to pick the correct uxLog level (action, log, warning, error, success, other), the matching chalk color, sensitive logging, VS Code UI suppression, and uxLogTable. Use when adding or modifying any uxLog call.
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

| Level     | Chalk color | When to use                                                                                                                                                  |
|-----------|-------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `action`  | `c.cyan`    | A new major step. Opens a new section / log group in the VS Code LWC UI. One per logical phase (e.g. "Querying", "Generating report", "Deploying metadata"). |
| `log`     | `c.grey`    | Sub-detail beneath the current `action`. Counts, file paths, timings, intermediate state.                                                                    |
| `warning` | `c.yellow`  | Recoverable issue the user should review. Operation continues.                                                                                               |
| `error`   | `c.red`     | Failure or blocking issue. Operation is aborting or the result is unusable.                                                                                  |
| `success` | `c.green`   | Confirmed successful completion of an operation, often the closing line of an `action` block.                                                                |
| `other`   | none / `c.grey` / `c.italic` | Console + file only. NOT forwarded to the VS Code UI. Use for raw JSON dumps, verbose debug, or chatter that would clutter the UI session log. |
| `table`   | (internal)  | Used by `uxLogTable` only. Do **not** call `uxLog("table", ...)` directly.                                                                                   |

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

## Sensitive logging (`sensitive=true`)

Pass `true` as the fourth argument when the line contains credentials, tokens, secrets, or any data that must not land in the file log or the VS Code UI.

```typescript
uxLog("log", this, c.grey(`Authenticating with token ${token}`), true);
```

Behaviour:

- Terminal: shows the real text (so the user running the command can still see it locally).
- File log (`hardisLogFileStream`): writes the literal string `OBFUSCATED LOG LINE`.
- VS Code UI: sends `OBFUSCATED LOG LINE`. Exception: lines containing `SFDX_CLIENT_ID_`, `SFDX_CLIENT_KEY_`, or `SFDX_CLIENT_CERT_` are sent as-is even when `sensitive=true`.

Use `sensitive=true` for any line that interpolates an access token, refresh token, client secret, password, or third-party API key.

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

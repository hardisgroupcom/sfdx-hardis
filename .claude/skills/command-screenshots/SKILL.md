---
name: command-screenshots
description: Screenshots of the command pages of the documentation (docs/hardis/**) - every sfdx-hardis command run from VS Code against real orgs (orgfarm Dev Hub and scratch orgs created from it), with numbered pills, and every report it writes opened in Excel. Covers the runner (yarn screenshots:commands, scripts/command-screenshots/run.mjs), the spec of a command (specs/**.yml - prompts answered, org, live or replay, caption, pills), the `reports` static field of a command class, data overlays and replay transcripts, the masking of real values, the extension harness it drives (SFDX_HARDIS_COMMAND_SHOTS), and the manifest docs/assets/command-screenshots.json read by hardis:doc:plugin:generate. Use it when a command is created or changed (its spec and its screenshots), when a command writes a new report, when the user asks to regenerate command screenshots, or when build:doc warns about commands without screenshot.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Command screenshots

Every command page under <https://sfdx-hardis.cloudity.com/hardis/> shows the command running in
VS Code, and, when the command writes reports, each report opened in Excel. The images come from
real runs, regenerated with one command:

```sh
yarn screenshots:commands hardis:org:diagnose:unusedusers   # one command
yarn screenshots:commands org:diagnose:*                     # one topic
yarn screenshots:commands                                    # everything (hours)
```

Windows only: VS Code and Excel run on a desktop of their own (the hidden desktop launcher of
vscode-sfdx-hardis), so nothing shows on the screen of the person working. Needs the sibling
clones `../vscode-sfdx-hardis` and `../sfdx-hardis-training`, Excel, and sfdx-hardis linked in sf
(`sf plugins link .`, the runner checks it).

## What happens in a run

1. **Preflight**: Windows, sibling clones, link, free memory (waits under 1.5 GB,
   `SFDX_HARDIS_SHOTS_MIN_FREE_GB`).
2. **Build**: `yarn compile` here, `yarn dev` + `yarn compile` in the extension (`--skip-build`).
3. **Orgs** (`lib/orgs.mjs`): a home folder of its own (`<run dir>/home`) holding only the
   authorization of one Dev Hub and of the scratch orgs created from it. The other orgs of the
   machine are never visible to the commands. The Dev Hub is the first connected orgfarm one with
   2 scratch orgs left today (`SFDX_HARDIS_SHOTS_DEVHUB` forces one).
   - `showcase`: scratch org with the Helios project deployed and seeded, reused while it has 3
     days left.
   - `throwaway`: scratch org for the specs that change their org, deleted at the end
     (`--keep-orgs`).
4. **Workspace** (`lib/workspace.mjs`): the Helios Energy project of the training repository with
   the sfdx-hardis configuration of the extension's training fixture (in `config/.sfdx-hardis.yml`),
   as a git repository (main, preprod, uat, integration, a feature branch), git identity Victor
   Martin. `scripts/command-screenshots/workspace/` is copied over it: what some commands work on
   (files workspace, custom function script, Apex script), and `sfdx-hardis.append.yml`, appended
   to the configuration (deployment actions, a custom function, Apex test classes, replacement
   rules). **Before each command, the workspace goes back to its first commit** (`git reset --hard`,
   `git clean -fd`): what a retrieve or a config change writes never reaches the next command.
5. **Masking** (`lib/orgs.mjs` `buildMaskRules`): usernames, org ids, hosts, user names and emails
   of the orgs, the git identity of the machine, local paths -> Helios values. Written to
   `<run dir>/mask.json`.
6. **VS Code** (`lib/harness.mjs` -> extension `src/test/ui/commandShots.test.ts`): each command
   runs in the real command runner, prompts answered from the spec, captures taken through the
   debugging port after masking. **A capture where a real value is still visible fails the
   command instead of being saved.** Results: `<run dir>/out/<slug>/result.json` and PNGs. A failed
   run keeps its last errors, warnings and steps in `logLines` of its result.json.
7. **Reports** (`lib/reports.mjs`, `lib/excel.mjs`): the xlsx the run wrote (or, when it only
   wrote a CSV, an xlsx built from the masked CSV), masked, plus the overlay rows; or, for a replayed command, an xlsx built from the overlay by the product's own
   `createXlsxFromCsv`. Opened in Excel (`excel-shot.ps1`, `/x` own process, closed by PID) and
   cropped to the grid, so the Office language and add-ins never show.
8. **Images** (`lib/manifest.mjs`): pills drawn by `scripts/annotate-doc-images.mjs`
   (`renderAnnotated`), written as WebP under `docs/assets/images/commands/`, listed in
   `docs/assets/command-screenshots.json`.
9. **Pages**: `hardis:doc:plugin:generate --commands <ids>` (`--no-doc` skips it).

`--resume` skips the commands the run folder already captured: use it after an interruption
(memory, reboot). `--keep-orgs` keeps the throwaway scratch org for the next run (orgfarm Dev
Hubs have about one free active scratch org slot each: do not create and delete it at every run).
`--reseed` runs the seed again on the showcase org it reuses. `--mode=replay` / `--mode=live`
selects only the replayed or the live commands. Each command has 7 minutes by default
(`timeoutMs`). The run folder is `%LOCALAPPDATA%/sfdx-hardis-command-shots`
(`SFDX_HARDIS_SHOTS_DIR`), kept between runs. `<run dir>/summary.json` lists what failed.

## The spec of a command

`scripts/command-screenshots/specs/<command path without hardis>.yml`, e.g.
`specs/org/diagnose/unusedusers.yml`:

```yaml
command: hardis:org:diagnose:unusedusers
run: sf hardis:org:diagnose:unusedusers --days 180   # the command line the runner shows
org: showcase           # showcase | devhub | throwaway | none
mode: live              # live | replay (transcripts/<command id with _>.json)
caption: Users who did not log in for 180 days, with the report buttons
pills:                  # on the capture of the finished run, placed on the element showing `text`
  - text: Unused users (XLSX)
    legend: Open the report in Excel
    button: true                   # on a button showing the text, not on a log line showing it too
answers:                # one rule per question, in order (same format as the training lab driver)
  - q: "Which license"              # regular expression on the question (never "^": it starts with "🦙 ")
    choice: "Salesforce"           # regular expression on a choice title (multiselect: all matches)
    shot: true                     # capture the question before answering it
    caption: Pick the license to analyze
    pills: [{ text: Salesforce, legend: The license type }]
  - q: "Do you want to"
    value: true                    # or a typed value, [] for an empty multiselect, or "__INITIAL__" for what the panel pre-fills
    optional: true                 # may not be asked
# Shell command run in the workspace after its reset, before the command (live runs only)
before: sf project reset tracking --target-org hardis-shots-showcase --no-prompt
timeoutMs: 900000
allowedStatuses: [completed]       # a run ending in error can be the point of the image
# skip: "Why this command has no screenshot"
```

- **Choose the run line a user would type.** Flags that avoid a question are fine; keep the
  questions that explain the command, and capture them (`shot: true`).
- **`discover: true`** (first-pass specs): a question no rule covers gets the value the panel
  pre-fills, or its first choice, and is written to `result.json` (`discovered`). Copy the rules
  you keep into `answers`, then remove `discover`.
- **`org`**: `devhub` only for read-only commands. Anything that deletes, freezes, deploys or
  imports goes to `throwaway`.
- **`replay`**: the command needs something the machine does not have (ticketing or git provider,
  Data Cloud, Confluence, ServiceNow, a sandbox refresh, a browser login, Docker). Its transcript
  is `transcripts/<command id, ":" replaced by "_">.json`:
  `{ "command": "...", "exitCode": 0, "events": [{ "delay": 200, "message": { "event": "commandLogLine", "logType": "action", "message": "..." } }, ...] }`.
  Record a real run with `--record` (`<run dir>/recorded/`) when one is possible, then edit it;
  otherwise write it from the uxLog calls of the command. A `prompts` message waits for the
  answer. Use the Helios cast and data, never a real name.
- **The workspace goes back to its first commit before each command** (`git reset --hard`,
  `git clean -fd`), but what git ignores and what lives in the orgs stays. Use `before` when an
  earlier run changed the state a command needs: source tracking out of step with the reset
  sources (`sf project reset tracking`), a draft of deployment actions a deployment refuses
  (`git rm` and `git commit`). The workspace has a local bare `origin`, so pull and fetch work
  offline. Some states no org can be put back in (an email changed through the API stays pending
  until the user confirms it): replay those commands.
- **`skip`**: only for a command that never shows anything in the command runner
  (`disableWebsocket`, read in the background by a panel). The page then shows no screenshot and
  build:doc does not warn.

## Reports

A command that writes CSV/XLSX reports declares them on its class, right after `title`:

```ts
import type { CommandReport } from '../../../../common/docBuilder/commandScreenshots.js';

  public static reports: CommandReport[] = [
    {
      file: 'unused-users',   // the prefix given to generateReportPath / uxLogTableWithReport / generateReports
      title: 'Unused users',
      description: 'One row per active user who did not log in for the number of days given, with their license and profile.',
    },
  ];
```

`test/command-screenshots.test.ts` checks that each prefix is a string the code writes, that no
prefix is declared twice, and that the texts have all their fields. Declare the workbook a user
opens, not every intermediate CSV.

**Overlay** (`overlays/<command path>/<report file>.json`): fictional rows when the org cannot
produce enough data (licenses, MFA, audit trail volume...) or for a replayed command:

```json
{ "mode": "append", "rows": [{ "Username": "mariia.kowalska@helios-solar.demo", "Profile": "Standard User" }] }
```

`append` keeps the real (masked) rows and adds these in the style of the first data row;
`replace` keeps only these. The column names are the header row of the report; a column it does
not have fails the report. A replayed command needs `replace` rows with every column, and can set
`"title"`.

Reports a normal run does not write need an overlay too: a `uxLogTableWithReport` table only
becomes a file above 20 rows, and some reports are only written after a deletion or a fix. Give
such an overlay `"columns"` (the exact header of the real report, in order) and `replace` rows.
A `replace` overlay with `"columns"` always builds the report from the overlay alone, so it also
fixes a report the run wrote empty (no header at all when there were no rows). A report that ends
with no data row gets no image and is listed in `summary.json`: give it an overlay. Aim for at
least 3 rows that tell a story, consistent with what the panel shows.

Before Excel opens a report, booleans become `TRUE` / `FALSE`, decimals keep their dot and dates
become ISO dates, so the image reads the same whatever the language of the Excel that took it. A
semicolon CSV (`generateReports`) is read as such before the xlsx is built.

After a change to an overlay only, rebuild the images without running VS Code again:
`yarn screenshots:commands <ids> --resume` (every command already captured, so only the images,
the reports and the manifest are rebuilt from `<run dir>/out`).

## Rules

- **Never a real value in an image**: no username, org id, host, person or customer name. Use the
  Helios cast: Victor Martin, Mariia Kowalska, Romain Lefebvre, `@helios-solar.demo`.
- **The Dev Hub is shared with real people and packages.** Its users are masked with fictional
  names, and a report of a `devhub` spec is only built from a `replace` overlay. Masking cannot
  know a name it was never given: a command that reads several orgs (`multi-org-query`) is pointed
  at the scratch org only (`--target-orgs`). Open every report image before committing it.
- **Never automate the desktop**: the harness and Excel capture only touch the processes they
  started, on their own desktop. No SendKeys, no window found by its title.
- **Pills**: at most 10 per image (palette), only where they explain something. Their legend is
  printed under the image as `**(n)** legend`.
- **One command or topic at a time** when you change a few commands; a full run takes hours and
  regenerates every image (live data changes each time).
- **A failed run is often a product bug: fix the product, not the spec.** "Nonexistent flag:
  --websocket" means the command lacks the `websocket` and `skipauth` flags the extension adds to
  every `sf hardis` command it runs. A flag ignored outside `--agent` mode, or a report column
  always empty, belongs in the CHANGELOG too.
- A command whose run fails keeps its previous images: read `summary.json` and the `error` of
  `result.json`, fix the spec, and run it again with `--resume` or by id.

## Files

| File                                             | What                                                        |
|--------------------------------------------------|-------------------------------------------------------------|
| `scripts/command-screenshots/run.mjs`            | The runner                                                  |
| `scripts/command-screenshots/lib/*.mjs`          | specs, orgs, workspace, harness, reports, excel, manifest   |
| `scripts/command-screenshots/excel-shot.ps1`     | Excel capture on the hidden desktop                         |
| `scripts/command-screenshots/specs/**.yml`       | One spec per command                                        |
| `scripts/command-screenshots/overlays/**.json`   | Fictional report rows                                       |
| `scripts/command-screenshots/transcripts/*.json` | Replayed runs                                               |
| `scripts/command-screenshots/seed/apex/*.apex`   | Seed of the scratch orgs (plus the Helios SFDMU data)       |
| `src/common/docBuilder/commandScreenshots.ts`    | `CommandReport`, the manifest types, missing image listing  |
| `src/common/docBuilder/pluginDocUtils.ts`        | Screenshots and Reports sections of a command page          |
| `docs/assets/command-screenshots.json`           | The manifest                                                |
| `docs/assets/images/commands/**.webp`            | The images                                                  |
| extension `src/test/ui/commandShots.test.ts`     | The suite that runs the commands and captures them          |
| extension `src/test/ui/domMask.ts`               | Masking and leak check                                      |
| extension `test/fixtures/sf-shim/sf-mock.js`     | Passthrough to the real sf, replay and record of transcripts |

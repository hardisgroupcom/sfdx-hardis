---
name: vscode-sfdx-hardis
description: How sfdx-hardis and its VS Code extension vscode-sfdx-hardis depend on each other, and the checklist to apply whenever a change here can affect the extension (command flags, prompts, --json output, WebSocket messages, config schema, command list, report files, doc screenshots), or when a request mentions VS Code, the extension, a panel, an LWC or the DevOps Pipeline. Load it before analyzing, designing, implementing or testing such a change.
---

# vscode-sfdx-hardis (VS Code extension)

The extension is how most users run sfdx-hardis. It lives in its own repository:

- GitHub: <https://github.com/hardisgroupcom/vscode-sfdx-hardis>
- Local clone: the sibling folder `../vscode-sfdx-hardis` (for example `C:/git/vscode-sfdx-hardis`). If it is missing, clone it next to this repository before working on the extension side.

It runs the CLI (`sf hardis:...`) and talks with it over a WebSocket. A change made here without looking at the extension ships a broken or outdated UI.

## When a task has an extension impact

The extension is in scope as soon as one of these is true:

- The request names VS Code, the extension, a panel, an LWC, the DevOps Pipeline, the Welcome page, the commands tree or a UI.
- A command's flags, prompts, defaults, `--json` output or `--agent` behavior change: the extension launches commands with flags and reads their JSON results.
- A `prompts()` call is added, removed or changes type: the extension renders every prompt in the command runner.
- A `WebSocketClient` message is added or changed (`src/common/websocketClient.ts`).
- A config property is added or changed in `config/sfdx-hardis.jsonschema.json`: the extension copies this schema and builds its settings editors from it.
- A command is added, renamed or removed: the extension lists commands in its tree, and some LWC cards launch them.
- A feature exists on both sides (backpromote, promotion branches, monitoring config, metadata retriever, org manager...): both must behave the same.

When in doubt, grep the extension for the command id, the flag, the config key or the event name.

## Integration surface

| sfdx-hardis                                                                            | vscode-sfdx-hardis                                                                                                                       |
|----------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| `WebSocketClient.send*` messages (`event: '...'`) in `src/common/websocketClient.ts`   | `src/hardis-websocket-server.ts`, one `data.event === "..."` branch per event                                                            |
| `prompts()` (`src/common/utils/prompts.ts`)                                            | `prompts` event, rendered in the command runner (`s/commandExecution`) or the `s-prompt-input` panel                                     |
| `uxLog('action', ...)`, `uxLogTable`, `WebSocketClient.sendReportFileMessage`          | Command runner timeline: visible log lines, tables (20 rows at most), report buttons                                                     |
| `WebSocketClient.sendVscodeDiffMessage`                                                | `vscodeDiff` event, opens `vscode.diff` editors                                                                                          |
| `sendRefreshPipelineMessage`, `sendRefreshStatusMessage`, `sendRefreshCommandsMessage` | Refresh of the DevOps Pipeline, the status tree and the commands tree                                                                    |
| `config/sfdx-hardis.jsonschema.json`                                                   | `resources/sfdx-hardis.jsonschema.json` via `yarn sync:schema` (reads `main`), editors in `src/utils/pipeline/sfdxHardisConfigHelper.ts` |
| `src/common/metadata-utils/metadataList.ts`                                            | `yarn sync:metadata-list` (reads `main`)                                                                                                 |
| Commands, their flags and their `--json` output                                        | `execSfdxJson()` / `execCommandWithProgress()` calls, `src/hardis-commands-provider.ts`, LWC `runCommand` messages                       |
| Read-only JSON commands meant for a UI (`hardis:config:monitoring-defaults`)           | Panels that load data first, then run the real command (`src/utils/monitoringConfigUtils.ts`)                                            |
| `colorClass` values of categories, notifications and commands                          | Tile hues of the LWC catalogs: the CLI sets them, the extension reads them                                                               |
| Extension screenshots in `docs/assets/images`                                          | `yarn screenshots` regenerates them and copies them into this repository                                                                 |
| `src/i18n/*.json` (CLI messages shown in the command runner)                           | Its own `src/i18n/*.json` for the extension labels, same 9 locales, case-sensitive key order                                             |

## Rules

1. **Same feature, same behavior.** When a feature can be run from the terminal and from a panel, the CLI is the only engine. The panel reads what it needs from a read-only command (`--json`), then runs the real command with explicit flags (usually with `--agent`). Every choice a panel offers exists as a CLI flag, and every terminal prompt fills the same option. Never reimplement CLI logic in the extension.
2. **Flags, JSON fields and events are an API.** Renaming or removing one breaks the extensions already installed. Add, deprecate, then remove.
3. **Minimum CLI version.** When the extension starts using a new flag, command or JSON field, raise `RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION` in the extension's `src/constants.ts` to the sfdx-hardis version that ships it.
4. **Schema first.** A config property the extension edits must be merged in `config/sfdx-hardis.jsonschema.json` on sfdx-hardis `main` before `yarn sync:schema` can pick it up.
5. **Two pull requests, linked.** Use the same branch name in both repositories, open one PR in each, link each description to the other, and add a CHANGELOG entry in each (`## [beta] (master)` here, `## Unreleased` there).

## Working on the extension side

The extension has its own agent setup. For every file under `vscode-sfdx-hardis`, read and follow it instead of the sfdx-hardis conventions:

- `vscode-sfdx-hardis/CLAUDE.md`: build commands, architecture, LWC and styling rules (theme-aware `resources/global-theme.css` kit, no hardcoded colors, `s-hardis-datatable`, tinted neutral buttons), i18n key order, panel performance rules.
- `vscode-sfdx-hardis/.claude/skills/`: `analyze`, `design`, `implement`, `test`, `document`, `pr-watch-fix`, `megalinter`, `megalinter-check`, `megalinter-fix`, `megalinter-setup`, `fix-duplicate`, `fix-security`, `monitoring`.
- `vscode-sfdx-hardis/.claude/agents/`: `analyze`, `design`, `implement`, `test`, `document`, `pr-fix`, `pr-watch`, and the MegaLinter agents.

Each phase of the sfdx-hardis workflow has its extension counterpart:

| Phase     | sfdx-hardis               | vscode-sfdx-hardis                                                                                              |
|-----------|---------------------------|-----------------------------------------------------------------------------------------------------------------|
| Analyze   | `analyze` skill / agent   | `analyze` skill: entry points, panels, message flow                                                             |
| Design    | `design` skill / agent    | `design` skill: execution mode, message types, i18n keys, styling, loading state                                |
| Implement | `implement` skill / agent | `implement` skill: LWC patterns, kit classes, i18n in 9 locales, CHANGELOG `## Unreleased`                      |
| Test      | `test` skill / agent      | `test` skill: `yarn lint`, `yarn dev`, `yarn compile`, `yarn test`, and `yarn test:ui` for panels and tree views |

A sub-agent started from this repository only loads the sfdx-hardis instructions. When delegating extension work, point the sub-agent at the extension folder and tell it to read the extension's `CLAUDE.md` and the matching skill before touching anything.

## Checklist

- [ ] Grepped the extension for the command ids, flags, config keys and event names the change touches.
- [ ] Wrote the extension impact in the analysis and in the design, or "none" with the reason.
- [ ] CLI flags cover every choice the UI offers, and the UI passes them instead of duplicating logic.
- [ ] Extension changes follow its `CLAUDE.md` and skills, and pass its lint, build and tests.
- [ ] `RECOMMENDED_MINIMAL_SFDX_HARDIS_VERSION` raised when the extension needs the new CLI.
- [ ] One PR per repository, cross-linked, with a CHANGELOG entry in each.

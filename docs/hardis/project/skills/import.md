<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:skills:import

## Description


## Command Behavior

**Imports Claude Code skills, agents, and rules from a remote git repository into the current project.**

This command makes it easier to share and reuse AI coding agent configurations across projects. It clones a remote repository containing Claude Code configuration files (skills, agents, rules) into a temporary directory, then copies them into the current project's `.claude/` folder.

Key functionalities:

- **Remote Repository Cloning:** Clones the specified git repository into a temporary directory for file extraction.
- **Flexible Source Layout:** Reads skills and agents from the repository root (`skills/`, `agents/`) and rules from `.claude/rules/`, which is the layout used by the Cloudity framework repo. Older repos that keep everything under `.claude/` (`.claude/skills/`, `.claude/agents/`) are still supported as a fallback. For each kind, the first matching source location wins.
- **File Copy with Overwrite Control:** Copies the resolved `skills/`, `agents/`, `rules/` into the project's `.claude/` folder, plus `CLAUDE.md` and `WORKFLOW.md` from the repo root. If any files already exist, prompts once to overwrite all or skip all (defaults to overwrite).
- **Config Persistence:** When `--repo` is not provided, reads the repo URL from the `skillsRepo` config property. If not found, prompts the user and stores the URL for future use.
- **Add-On Mode:** When `--addon` is used, the resolved repository URL is appended to the `skillsRepoAddOns` array config property instead of being saved as the main `skillsRepo`. This lets you track a main skills repo plus a list of complementary add-on repos in the project config. The actual files are still imported from a single repo per invocation; merging across the main repo and add-ons is expected to be handled separately by an agent later.
- **Agent Mode:** Supports `--agent` flag for non-interactive CI/CD and automation use. In agent mode, `--repo` or `skillsRepo` config must be set, and existing files are always overwritten.

<details markdown="1">
<summary>Technical explanations</summary>

- Clones the repo with `git clone --depth 1` (shallow clone for speed) into a temp directory created via `createTempDir()`.
- For each kind of config, resolves the source directory from a list of candidate locations and copies every file into the matching `.claude/<kind>/` path in the current project: `skills` from `skills/` then `.claude/skills/`; `agents` from `agents/` then `.claude/agents/`; `rules` from `.claude/rules/` then `rules/`. The first existing candidate wins for each kind.
- If none of the candidate locations and no root `CLAUDE.md`/`WORKFLOW.md` are found, the command fails with a clear error.
- In interactive mode, if any existing files are detected, a single overwrite prompt is shown (default: overwrite all).
- In agent mode (`--agent`), all existing files are silently overwritten.
- With `--addon`, the URL is appended (deduplicated) to the `skillsRepoAddOns` string array config property; without it, the URL replaces the `skillsRepo` string config property as before.
- The temporary directory is cleaned up after the operation completes.
</details>


## Parameters

| Name         |  Type   | Description                                                                                                      | Default | Required | Options |
|:-------------|:-------:|:-----------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| addon        | boolean | Persist the repository URL to the skillsRepoAddOns array config property instead of the main skillsRepo property |         |          |         |
| agent        | boolean | Run in non-interactive mode for agents and automation                                                            |         |          |         |
| debug<br/>-d | boolean | Activate debug mode (more logs)                                                                                  |         |          |         |
| flags-dir    | option  | undefined                                                                                                        |         |          |         |
| json         | boolean | Format output as json.                                                                                           |         |          |         |
| repo<br/>-r  | option  | Git repository URL containing .claude/ skills, agents, and rules to import                                       |         |          |         |
| skipauth     | boolean | Skip authentication check when a default username is required                                                    |         |          |         |
| websocket    | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                        |         |          |         |

## Examples

```shell
$ sf hardis:project:skills:import
```

```shell
$ sf hardis:project:skills:import --repo https://github.com/mycompany/claude-skills.git
```

```shell
$ sf hardis:project:skills:import --repo https://github.com/mycompany/claude-skills-billing.git --addon
```

```shell
$ sf hardis:project:skills:import --agent --repo https://github.com/mycompany/claude-skills.git
```



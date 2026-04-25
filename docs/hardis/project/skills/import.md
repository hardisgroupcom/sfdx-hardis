<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:skills:import

## Description


## Command Behavior

**Imports Claude Code skills, agents, and rules from a remote git repository into the current project.**

This command streamlines the process of sharing and reusing AI coding agent configurations across projects. It clones a remote repository containing `.claude/` configuration files (skills, agents, rules) into a temporary directory, then copies them into the current project's `.claude/` folder.

Key functionalities:

- **Remote Repository Cloning:** Clones the specified git repository into a temporary directory for file extraction.
- **File Copy with Overwrite Control:** Copies `.claude/skills/`, `.claude/agents/`, `.claude/rules/`, `CLAUDE.md`, and `WORKFLOW.md` from the cloned repo into the current project. If any files already exist, prompts once to overwrite all or skip all (defaults to overwrite).
- **Config Persistence:** When `--repo` is not provided, reads the repo URL from the `skillsRepo` config property. If not found, prompts the user and stores the URL for future use.
- **Agent Mode:** Supports `--agent` flag for non-interactive CI/CD and automation use. In agent mode, `--repo` or `skillsRepo` config must be set, and existing files are always overwritten.

<details markdown="1">
<summary>Technical explanations</summary>

- Clones the repo with `git clone --depth 1` (shallow clone for speed) into a temp directory created via `createTempDir()`.
- Walks the `.claude/` subdirectories (`skills`, `agents`, `rules`) in the cloned repo and copies each file into the corresponding path in the current project.
- In interactive mode, if any existing files are detected, a single overwrite prompt is shown (default: overwrite all).
- In agent mode (`--agent`), all existing files are silently overwritten.
- The temporary directory is cleaned up after the operation completes.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|agent|boolean|Run in non-interactive mode for agents and automation||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|repo<br/>-r|option|Git repository URL containing .claude/ skills, agents, and rules to import||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:project:skills:import
```

```shell
$ sf hardis:project:skills:import --repo https://github.com/mycompany/claude-skills.git
```

```shell
$ sf hardis:project:skills:import --agent --repo https://github.com/mycompany/claude-skills.git
```



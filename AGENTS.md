# sfdx-hardis Agent Guidance

This repository already documents how coding agents should use `sfdx-hardis`.
Do not add runtime AI behavior, generated command catalogs, or MCP-specific command
knowledge here.

## Command Usage

When selecting, explaining, or preparing a `sfdx-hardis` CLI command:

1. First read `docs/salesforce-agentic-automation.md`.
2. Then read the selected command page under `docs/hardis/**`.
3. Use `--agent` for non-interactive execution only when the selected command
   documents agent mode support.
4. Prefer `--json` when the selected command supports it and structured output
   is useful.

Do not invent commands, aliases, flags, defaults, examples, or behavior. If the
existing documentation does not prove a command or flag, say that it is
unverified and ask for confirmation before using it.

## Safety

Ask for explicit confirmation before recommending or running commands that can:

- deploy or mutate Salesforce metadata;
- delete data, metadata, files, scratch orgs, or org resources;
- create, refresh, connect, select, or otherwise mutate org state;
- mutate git state or publish externally;
- handle secrets, credentials, tokens, or authentication material.

For local repository work, follow the existing project conventions in
`CLAUDE.md` and `.claude/skills/**` where relevant. Use Yarn for package
scripts.

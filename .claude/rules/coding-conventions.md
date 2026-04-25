# Coding Conventions

## Module System

- ESM module (`"type": "module"` in package.json).
- Import paths must use `.js` extensions (compiled output compatibility).
- Commands extend `SfCommand<any>` from `@salesforce/sf-plugins-core`.

## Logging

- Use `uxLog(level, context, message)` for all logging.
- Use `chalk` (commonly aliased as `c`) for colors.
- No emojis at the beginning of log lines.
- Use `uxLogTable` from `src/common/utils/uxLog.js` for formatted tables.

## File Operations

- Use `fs-extra` (not native `fs`).

## User Input

- Use `prompts()` from `src/common/utils/prompts.ts` for interactive prompts.

## Configuration

- Use `CONSTANTS` and `getEnvVar()` from `src/config/index.ts`.
- Three-layer config priority: user > branch > project.
  - **Project**: `config/.sfdx-hardis.yml` (shared, committed to git).
  - **Branch**: `config/branches/.sfdx-hardis.<branch>.yml` (per-environment overrides).
  - **User**: `config/user/.sfdx-hardis.<username>.yml` (per-developer, git-ignored).
- Read config: `getConfig("project" | "branch" | "user")` — returns merged config up to the specified layer.
- Write config: `setConfig("project" | "branch" | "user", { key: value })`.
- Config files support `extends` property to inherit from a remote YAML URL.
- **JSON Schema**: All config properties must be defined in `config/sfdx-hardis.jsonschema.json`. When adding or modifying a config property, update the schema with `$id`, `description`, `title`, `type`, and optionally `default`, `enum`, `examples`, `docUrl`.

## Commands

- Return `AnyJson` from `run()` method.
- Static `description` must include `## Command Behavior` and `<details>Technical explanations</details>` sections.
- **Headless / agent mode**: When possible, commands must support a `--agent` boolean flag so they can be called non-interactively by AI agents and automation pipelines.
  - Declare it as: `agent: Flags.boolean({ default: false, description: 'Run in non-interactive mode for agents and automation' })`
  - Read it in `run()` as: `const agentMode = flags.agent === true;`
  - Gate all interactive `prompts()` calls behind `!isCI && !agentMode` so the command never blocks waiting for user input when running headlessly.
  - When a prompt collects a value that cannot have a reasonable default, add a corresponding CLI flag so agents can pass the value explicitly (e.g., `--query` for a SOQL query that would otherwise be prompted).
  - Add `'$ sf hardis:<topic>:<action> --agent'` to the command `examples` array.
  - Add a `### Agent Mode` section to the command `description` explaining: required flags, defaults applied, and what is skipped. See the `documentation` skill for the exact template.

## Code Duplication

- Use `/* jscpd:ignore-start */` / `/* jscpd:ignore-end */` where duplication is intentional.

## Dependencies

- Salesforce: `@salesforce/*` namespace.
- AI features: `@langchain/*` packages.
- Use `columnify` for table formatting where `uxLogTable` isn't appropriate.
- Package manager: **Yarn only** (not npm).

## Git Workflow

- Uses Husky for git hooks.
- Conventional commits encouraged.
- Mega-linter for code quality.

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
- Files: `.sfdx-hardis.yaml` / `.sfdx-hardis.yml` in `config/`, `config/branches/`, `config/user/`.

## Commands

- Return `AnyJson` from `run()` method.
- Static `description` must include `## Command Behavior` and `<details>Technical explanations</details>` sections.

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

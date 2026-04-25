---
name: architecture
description: sfdx-hardis project architecture, technology stack, provider pattern, configuration system, and project structure. Use when working with project structure, providers, hooks, or config.
user-invocable: false
---

# Architecture

## Technology Stack

- **Language**: TypeScript (strict mode)
- **CLI Framework**: Oclif (Salesforce CLI framework)
- **Build System**: Wireit (task orchestration)
- **Testing**: Mocha with Nyc for coverage
- **Linting**: ESLint with Salesforce configurations
- **AI Integration**: LangChain (Anthropic, Google GenAI, Ollama, OpenAI) + Codex + Agentforce

## Project Structure

```
src/
├── commands/hardis/   # CLI commands (~300+) organized by domain
│   ├── auth/          ├── cache/       ├── config/
│   ├── datacloud/     ├── doc/         ├── git/
│   ├── lint/          ├── mdapi/       ├── misc/
│   ├── org/           ├── package/     ├── packagexml/
│   ├── project/       ├── scratch/     ├── source/
│   └── work/
├── common/
│   ├── aiProvider/    # AI integration and prompt templates
│   └── utils/         # Shared utilities (barrel-exported from index.ts)
├── hooks/             # Oclif lifecycle hooks
├── i18n/              # Translation files (9 locales)
test/                  # Test files (*.test.ts, *.nut.ts)
lib/                   # Compiled JavaScript output
messages/              # Oclif message files (.md)
defaults/              # Default configurations and templates
docs/                  # Project documentation
```

## CLI Framework

- Commands extend `SfCommand<any>` from `@salesforce/sf-plugins-core`.
- Invoked as `sf hardis <topic> <action>`.
- ESM module (`"type": "module"`).

### Headless / Agent Mode

When possible, every command should support a `--agent` boolean flag so it can be called non-interactively by AI agents and automation pipelines:

```ts
// Flag declaration
agent: Flags.boolean({
  default: false,
  description: 'Run in non-interactive mode for agents and automation',
}),

// In run()
const agentMode = flags.agent === true;

// Guard every interactive prompt
if (!isCI && !agentMode) {
  const answer = await prompts({ ... });
}
```

- Add `'$ sf hardis:<topic>:<action> --agent'` to the command `examples` array.
- In agent mode the command must complete without blocking on any interactive prompt, applying sensible defaults instead.

## Provider Pattern (`src/common/`)

External integrations use a root class + concrete implementations:

- **gitProvider**: GitHub, GitLab, Azure DevOps, Bitbucket
- **notifProvider**: Slack, MS Teams, Email, API webhook
- **ticketProvider**: Jira, Azure Boards, generic
- **aiProvider**: LangChain-based (Anthropic, Google GenAI, Ollama, OpenAI) + Codex + Agentforce
- **actionsProvider**: Post-deploy actions (Apex, data, manual, community publish, schedule batch)
- **keyValueProviders**: Salesforce org, local test
- **docBuilder**: Documentation generation

## Configuration System (`src/config/index.ts`)

### Three-Layer Config

Configuration uses a three-layer merge with priority: **user > branch > project**.

| Layer                | File locations                                                                                                            | Purpose                                                                                                                                             |
|----------------------|---------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
| **Project** (global) | `config/.sfdx-hardis.yml` or `config/.sfdx-hardis.yaml` (also `.sfdx-hardis.yaml`/`.yml` at repo root, or `package.json`) | Shared settings for the entire project, committed to git                                                                                            |
| **Branch**           | `config/branches/.sfdx-hardis.<branch-name>.yml`                                                                          | Per-branch overrides (e.g., different target org, deploy options per environment). Branch name is auto-detected from git or `CONFIG_BRANCH` env var |
| **User**             | `config/user/.sfdx-hardis.<os-username>.yml`                                                                              | Per-developer overrides, typically git-ignored                                                                                                      |

Higher-priority layers override lower ones via `Object.assign()` (shallow merge).

### Config File Discovery

Uses `cosmiconfig` to search for config files. Supported names: `.sfdx-hardis.yaml`, `.sfdx-hardis.yml`, and `package.json` (for project layer).

### Remote Config Inheritance

A config file can include an `extends` property pointing to a remote YAML URL. The remote config is fetched and merged underneath the local config (local wins). This allows sharing a common config base across multiple projects.

```yaml
# config/.sfdx-hardis.yml
extends: https://raw.githubusercontent.com/mycompany/shared-config/main/.sfdx-hardis.yml
projectName: my-project
```

### API

- `getConfig(layer)` - returns merged config up to the specified layer (`"project"`, `"branch"`, or `"user"` - default `"user"`)
- `setConfig(layer, propValues)` - writes properties to the config file for the specified layer
- `CONSTANTS` - static constants (API version, URLs, metadata type lists)
- `getEnvVar(name)` - reads env var with Azure unresolved-variable detection

### JSON Schema

All config properties are defined in `config/sfdx-hardis.jsonschema.json` (JSON Schema draft-07). This schema is used to:

- Generate HTML documentation (`yarn build` runs `generate-schema-doc`)
- Validate config structure
- Power IDE autocompletion

**When adding or modifying a config property, always update `config/sfdx-hardis.jsonschema.json` to keep it in sync.** Each property should have `$id`, `description`, `title`, `type`, and optionally `default`, `enum`, `examples`, and `docUrl`.

## Hooks (`src/hooks/`)

Oclif lifecycle hooks:

- `init`: logging, upgrade check, websocket client
- `prerun`: auth, dependency check
- `auth`: authentication
- `postrun`: cache store
- `finally`: notifications

## WebSocket Client (`src/common/websocketClient.ts`)

Communicates with VS Code extension (vscode-sfdx-hardis) for UI interactions, progress, and prompts.

## Utilities (`src/common/utils/`)

Barrel-exported from `src/common/utils/index.ts`:

- `uxLog()` -- logging
- `execSfdxJson()` -- CLI subprocess calls
- Deploy, git, org, XML utilities

## AI Prompt Templates

Located in `src/common/aiProvider/promptTemplates/`. Each exports a `PromptTemplateDefinition` with variables and multilingual text. Users can override by placing `.md` files in `config/prompt-templates/` (`.txt` also supported for backward compatibility).

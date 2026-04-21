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

Three-layer config with priority: user > branch > project.

- Files: `.sfdx-hardis.yaml` / `.sfdx-hardis.yml`
- Directories: `config/`, `config/branches/`, `config/user/`
- Access: `getConfig(layer)`
- Constants: `CONSTANTS` and `getEnvVar()` from `src/config/index.ts`

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

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
- **notifProvider**: Slack, MS Teams, Email, API webhook. Slack and Teams share the logical `messaging` channel; each provider declares its channel via `getChannel()`. Routing is filtered per notification type and per channel via severity thresholds. See the `monitoring-notifications` skill.
- **ticketProvider**: Jira, Azure Boards, ServiceNow, Aha!, generic
- **aiProvider**: LangChain-based (Anthropic, Google GenAI, Ollama, OpenAI) + Codex + Agentforce
- **actionsProvider**: Deployment actions and org initialization steps (command, Apex, data, manual, community publish, schedule batch, run batch, package.xml items removal, user access policies...)
- **keyValueProviders**: Salesforce org, local test
- **docBuilder**: Documentation generation

### Rule for every provider family: generic code is agnostic

This applies to all of them (git, notification, ticketing, AI, actions, key-value providers...), for new code and for every review:

- **Code specific to one implementation exists only in its provider class** (`gitProvider/gitlab.ts`, `notifProvider/slackProvider.ts`, `ticketProvider/jiraProvider.ts`...). Commands, the family's `index.ts`, its root class and shared `utils/` never name an implementation: no `providerKey === 'gitlab'`, no `instanceof SlackProvider`, no `if (isJira)`, no import of an implementation-only helper.
- **Commands and generic code speak a common format** defined once in the generic code: neutral criteria, neutral options, neutral results. Each provider converts it to and from its native form (a JQL or WIQL query, a GitLab or GitHub API filter, Slack blocks or Teams cards, ADF or wiki markup...) inside its class. A command never accepts, builds, wraps or validates a native syntax.
- **One implementation's rule is a base-class hook** the provider overrides (validation, capability, formatting). Generic code calls the hook and never tests which implementation it got. An operation an implementation cannot do throws a named "not supported" error from the base-class default.
- **Flags, option types, i18n keys and descriptions stay neutral.** A flag only one implementation understands is either mapped or refused by every provider through a hook, or not added. The per-implementation mapping goes in the `Technical explanations` section of the command doc.
- **Test of the design:** adding a new implementation means adding its class to the family's list and overriding base methods, with no edit to a command or to shared code. If it needs one, fix the abstraction first.

The sections below detail this rule for deployment action types and ticketing systems.

### Deployment action types: everything specific lives in the provider class

Everything specific to one action type goes in its `ActionsProvider` subclass (`src/common/actionsProvider/<type>Action.ts`), and nowhere else: its flags, its prompts, its parameter normalization, its validation, the phases it may run in, its `runOnlyOnceByOrg` default. Generic code never names a type nor imports a type-specific helper: `hardis/project/action/base.ts`, `create.ts`, `update.ts`, `actionUtils.ts` and the Pull Request comment code only call the provider through the base-class hooks.

| Hook (base default)                                    | Used by                                                                                                                                                                                                  |
|--------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `getFlagNames()` (`[]`)                                | `assertNoFlagsOfOtherTypes`: create and update refuse a flag that only another type accepts                                                                                                              |
| `getAllowedWhen()` (`null` = both phases)              | create refuses the other phase, `validateActionParameters` checks it, `listAvailableActionTypes(when)` hides the type, the provider's `checkParameters` refuses a hand-written action in the wrong phase |
| `collectParameters(flags, headless, current)` (`null`) | create and the interactive update: flags when headless, prompts seeded with the current values otherwise                                                                                                 |
| `applyFlags(parameters, flags)` (unchanged)            | update in agent mode                                                                                                                                                                                     |
| `getDefinitionErrors(action, when)` (`null`)           | `validateActionParameters`, when an action is saved                                                                                                                                                      |
| `checkParameters`, `getIdentityParameters`, `run`      | the execution loop                                                                                                                                                                                       |

Generic code reaches the provider with `getBuiltInActionProvider(type)` (`actionUtils.ts`, `null` for a custom function). A hook returning `null` means "not handled by the provider": the older types (command, apex, data, publish-community, manual, schedule-batch, remove-packagexml-items) still have branches in the generic code. Do not add new branches there: move a type to its class when you touch it and the user agrees.

Exceptions that stay outside the class:

- The oclif flag declarations of `action:create` and `action:update`: oclif reads them statically.
- The registries of `actionTypes.ts`, read by synchronous code (forecast, Pull Request comment, developer org runs, backpromote) where no provider class can be loaded: `DEPLOYMENT_ONLY_ACTION_TYPES` (read through `getEffectiveActionContext`) and `RUN_AT_EVERY_DEPLOYMENT_BY_DEFAULT_ACTION_TYPES` (read through `resolveRunOnlyOnceByOrg(def)`, which every reader of `runOnlyOnceByOrg` must use instead of `def.runOnlyOnceByOrg !== false`, so a hand-written action without the key gets the default of its type).

Load prompt helpers (`actionPromptUtils.js`) with a dynamic import inside `collectParameters`, so running an action never loads them. A provider class must not be imported statically by `deploymentActionsStateUtils.ts` or by anything `actionsProvider.ts` imports: that creates an import cycle (`Cannot access 'ActionsProvider' before initialization`).

### Ticketing systems: commands are agnostic, everything specific lives in the provider class

The `hardis:ticket:*` commands, `src/common/ticketProvider/index.ts`, `ticketProviderRoot.ts` and `src/common/ticketProvider/utils/` never contain anything specific to one ticketing system. Code specific to JIRA, Azure Boards, ServiceNow, Aha! or a future connector exists **only** in its provider class (`jiraProvider.ts`, `azureBoardsProvider.ts`...).

- **No native query language in a command.** A command never accepts, builds, wraps or validates JQL, WIQL or any provider syntax. It takes a common, provider-neutral criteria format (for example `{ projects, statuses, types, assignee, labels, text, createdAfter, updatedAfter, orderBy }`), defined once in the generic code, and passes it to the provider. Each provider converts it to its own language (JQL, WIQL, a ServiceNow encoded query...) inside its class. The same command line then works on every connector.
- **No provider branch in generic code.** No `providerKey === 'jira'`, no `instanceof AzureBoardsProvider`, no regex of one system (`customfield_NNNNN`) in a command or in a shared util. A rule that applies to one connector is a method of that connector: validation goes in a base-class hook the provider overrides (for example `validateQualifyOptions(options)`), called by the command before any write.
- **No provider-specific helper in `utils/`.** Query builders (`scopeJql`, `scopeWiql`), mention builders (ADF, wiki, Azure HTML), tag splitting, HTML spacing for one system's renderer: all private to the provider class that uses them. Only neutral helpers live in `utils/` (marker detection, project scope check, strict markdown, retry, error names).
- **Flags and option types stay neutral.** A flag that only one connector understands (`--visibility role:<role>`) is either expressed in a neutral form every provider can map or refuse, or not added. Descriptions say "label", "status", "story points field", not "JIRA custom field" or "Azure tag"; the per-provider mapping is documented in the `Technical explanations` section.
- **Unsupported is a named error from the base class.** A connector that cannot do an operation inherits the `TicketProviderRoot` default that throws `TicketProviderNotSupported`; the command does not test which connector it got.

A new ticketing system must work with every `hardis:ticket:*` command by adding its class to `allTicketProviders` and overriding the base methods, with no change to any command. If supporting it needs an edit to a command or to `utils/`, the abstraction is wrong: fix the abstraction. See also how connectors are selected without naming them (`activeTicketProviders`, `onlyWhenDeclared`).

## Monitoring Pipeline (`src/common/monitoring/`, `src/common/notifProvider/`)

`hardis:org:monitor:all` runs a list of sub-commands (`monitoringCommandsDefault`) on a configurable cadence. Each sub-command posts notifications through `NotifProvider.postNotifications`, which fans out to enabled channels (`messaging` / `email` / `api`) using per-notification-type severity thresholds. Defaults live in source; users override per-entry via the `monitoringCommands` property in `.sfdx-hardis.yml`, merged by `key`. The `hardis:config:monitoring-defaults` command exposes the full defaults payload to the VS Code extension UI.

When adding a monitoring command, a notification type, or changing default routing, use the **`monitoring-notifications` skill** -- it lists exactly which files to touch.

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

Communicates with VS Code extension (vscode-sfdx-hardis) for UI interactions, progress, and prompts. Every message carries an `event` handled in the extension's `src/hardis-websocket-server.ts`, so adding or changing one is an extension change too. See the `vscode-sfdx-hardis` skill for the full integration surface.

## Utilities (`src/common/utils/`)

Barrel-exported from `src/common/utils/index.ts`:

- `uxLog()` - logging
- `execSfdxJson()` - CLI subprocess calls
- Deploy, git, org, XML utilities

## AI Prompt Templates

Located in `src/common/aiProvider/promptTemplates/`. Each exports a `PromptTemplateDefinition` with variables and multilingual text. Users can override by placing `.md` files in `config/prompt-templates/` (`.txt` also supported for backward compatibility).

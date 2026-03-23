# GitHub Copilot Instructions for sfdx-hardis

## Project Overview

**sfdx-hardis** is a comprehensive Salesforce DevOps toolbox that provides CI/CD pipeline capabilities, metadata backup/monitoring, and project documentation generation. It's an open-source project by Cloudity that includes AI-powered features for Salesforce development.

## Package Manager

**⚠️ IMPORTANT: This project uses Yarn as the package manager**

- Use `yarn` instead of `npm` for all package management operations
- Use `yarn install` to install dependencies
- Use `yarn add <package>` to add new dependencies
- Use `yarn remove <package>` to remove dependencies
- Lock file: `yarn.lock` (do not modify manually)

## Technology Stack

- **Language**: TypeScript
- **CLI Framework**: Oclif (Salesforce CLI framework)
- **Build System**: Wireit (for task orchestration)
- **Testing**: Mocha with Nyc for coverage
- **Linting**: ESLint with Salesforce configurations
- **AI Integration**: LangChain with multiple providers (Anthropic, Google GenAI, Ollama)
- **Salesforce**: Salesforce Core libraries and SF Plugins Core

## Project Structure

```
src/
├── commands/          # CLI commands organized by category
│   └── hardis/       # Main command namespace
│       ├── auth/     # Authentication commands
│       ├── doc/      # Documentation generation commands
│       ├── org/      # Org management commands
│       └── ...
├── common/           # Shared utilities and helpers
│   ├── aiProvider/   # AI integration and prompt templates
│   └── utils/        # Common utility functions
test/                 # Test files
lib/                  # Compiled JavaScript output
messages/             # Internationalization messages
defaults/             # Default configurations and templates
docs/                 # Project documentation
```

## Development Guidelines

### Command Development

- All CLI commands extend `SfCommand` from `@salesforce/sf-plugins-core`
- Commands follow the pattern: `sf hardis:<category>:<action>`
- Use proper TypeScript typing with `AnyJson` return types
- Use the `uxLog` utility for consistent logging output with chalk colors (do not use emojis at the beginning of log lines)

### Coding Standards

- Follow TypeScript strict mode requirements
- Use ESLint and Prettier configurations provided
- Import statements should use `.js` extensions for compiled compatibility
- Use `/* jscpd:ignore-start */` and `/* jscpd:ignore-end */` to ignore code duplication checks where appropriate

### AI Features

- Prompt templates are defined in `src/common/aiProvider/promptTemplates/`
- Each template exports a `PromptTemplateDefinition` with variables and multilingual text
- Templates can be overridden by placing `.txt` files in `config/prompt-templates/`
- Support multiple AI providers via LangChain

### Build and Test

- Build: `yarn build` (uses Wireit orchestration)
- Test: `yarn test`
- Lint: `yarn lint`
- Clean: `yarn clean`
- Development: Use `./bin/dev.js` for testing commands locally

### File Patterns

- Commands: `src/commands/hardis/**/*.ts`
- Tests: `test/**/*.test.ts` or `**/*.nut.ts` for integration tests
- Messages: `messages/**/*.md` for internationalization
- Utilities: `src/common/utils/**/*.ts`

### Dependencies

- Salesforce-specific dependencies in `@salesforce/*` namespace
- AI features use `@langchain/*` packages
- Use `fs-extra` for file operations
- Use `chalk` for colored console output
- Use `columnify` for table formatting

### Git Workflow

- Uses Husky for git hooks
- Conventional commits are encouraged
- Automated workflows for testing, building, and releasing
- Mega-linter integration for code quality

## Internationalization (i18n) / Translations

sfdx-hardis uses **i18next** for runtime translations. The locale is selected via the `SFDX_HARDIS_LOCALE` environment variable (default: `en`; supported: `en`, `de`, `fr`, `es`, `it`, `ja`, `pl`).

### Translation files

- English: `src/i18n/en.json`
- French: `src/i18n/fr.json`
- Spanish: `src/i18n/es.json`
- Italian: `src/i18n/it.json`
- Japanese: `src/i18n/ja.json`
- German: `src/i18n/de.json`
- Polish: `src/i18n/pl.json`

All files are flat JSON objects with **camelCase** keys and **i18next interpolation** syntax for variables (`{{varName}}`).

### Using translations in source code

Always import `t` from the i18n utility:

```typescript
import { t } from "../../../common/utils/i18n.js"; // adjust relative path as needed
```

Use `t(key)` or `t(key, { varName: value })` wherever a user-visible string is needed:

```typescript
uxLog("action", this, c.cyan(t("processingFile", { file: fileName })));
uxLog("warning", this, c.yellow(t("fileNotFound", { path: filePath })));
```

### Naming conventions for translation keys

- Use `camelCase`, starting with a lowercase letter.
- The key should be a compressed English summary of the message, e.g.:
  - `"No apex logs to delete."` → `noApexLogsToDelete`
  - `"Processing file {{file}}..."` → `processingFile`
  - `"Error while deploying metadata: {{message}}"` → `errorWhileDeployingMetadata`
- Keep keys unique across the whole file.
- Always add the key to **all** translation files (`en.json`, `fr.json`, `es.json`, `it.json`, `ja.json`, and `de.json`) simultaneously. Non-English translations can mirror English when unsure, but should be translated.
- Reuse existing translations when possible instead of creating new keys for similar messages.
- Always keep translation json files well-formatted and sorted alphabetically by key for readability.

### Rules for translating strings

- When you are asked for a new translation, look at other translations in the same language (i18n json file) to use the same terminology and style for consistency.

- **Do NOT translate markers** surrounded by `[]` (e.g. `[sfdx-hardis]`, `[SKIP]`). Keep them as hardcoded string literals and concatenate with the translated string:
  ```typescript
  uxLog("action", this, c.cyan("[MyMarker] " + t("someMessage")));
  ```
- **Do NOT translate technical terms** that are not user-facing words in French or English (e.g. `merge`, `commit`, `branch`, `sandbox`, `scratch org`, `package.xml`, `Apex`, `SOQL`, `LWC`, CLI flags, environment variable names). Keep such terms as-is inside the translation value.
- **Salesforce-specific terms (Spanish)**: Avoid literal translations and use the terminology commonly used by Salesforce developers in Spain. Keep the official Salesforce term in English when it is the standard used in tooling, CLI messages, and DevOps contexts (e.g. `Flow` → `Flow`, `Object` → `objeto`, `Field` → `campo`, `Profile` → `Profile`, `Permission Set` → `Permission Set`, `Permission Set Group` → `Permission Set Group`, `Record Type` → `Record Type`, `Validation Rule` → `Validation Rule`, `Workflow Rule` → `Workflow Rule`, `Approval Process` → `Approval Process`, `Assignment Rule` → `Assignment Rule`, `Escalation Rule` → `Escalation Rule`, `Custom Label` → `Custom Label`, `Custom Setting` → `Custom Setting`, `Custom Permission` → `Custom Permission`, `Connected App` → `Connected App`, `External Client App` → `External Client App`, `Lightning Page` → `Lightning Page`, `Lightning Web Component` → `Lightning Web Component`, `Dashboard` → `dashboard`, `Sandbox` → `Sandbox`, `Scratch Org` → `Scratch Org`, `org` → `org`, `Deployment` → `despliegue`, `Production (Org)` → `Producción`, `Developer Console` → `Developer Console`). When translating to Spanish, do not assume that the official Salesforce UI translation is always the best choice. Prefer the terminology commonly used by Salesforce developers in Spain. Translate generic functional wording into natural Spanish, but keep metadata names, CLI terms, and developer-facing concepts in English when that is the common real-world usage (for example: Flow, Permission Set, Custom Setting, Connected App, Scratch Org, etc.). The goal is to keep terminology consistent with Salesforce CLI, DevOps tooling, and typical Spanish developer vocabulary, rather than translating every Salesforce concept literally. Use terminology commonly used by Salesforce developers in Spain rather than strictly following the official Salesforce UI translations (e.g. keep developer-facing terms like Flow, Permission Set, Custom Setting, Connected App when appropriate, while translating generic wording such as "metadatos", "despliegue", etc.)
  Keep English technical terms untranslated when they belong to Git, CLI tooling or metadata names: merge, commit, branch, Scratch Org, package.xml, DevHub
  Use clear and natural Spanish for technical users, avoiding literal translations that sound unnatural in developer tools
  Use neutral European Spanish (Spain) rather than forcing Latin American variants.
- **Salesforce-specific terms (French)**: Use the official Salesforce French translation when translating to French (e.g. `Permission Set` → `Ensemble d'autorisations`, `Record Type` → `Type d'enregistrement`, `Flow` → `Flux`, `Object` → `Objet`, `Field` → `Champ`, `Profile` → `Profil`).
- **Salesforce-specific terms (Japanese)**: Use the official Salesforce Japanese translation when translating to Japanese. Use polite professional Japanese (Desu/Masu form - です/ます調) (e.g. `Account` → `取引先`, `Contact` → `取引先責任者`, `Opportunity` → `商談`, `Lead` → `リード`, `Case` → `ケース`, `Campaign` → `キャンペーン`, `Task` → `ToDo`, `Event` → `行動`, `Activity` → `活動`, `Object` → `オブジェクト`, `Custom Object` → `カスタムオブジェクト`, `Record Type` → `レコードタイプ`, `Permission Set` → `権限セット`, `Permission Set Group` → `権限セットグループ`, `Profile` → `プロファイル`, `Role` → `ロール`, `Flow` → `フロー`, `Trigger` → `トリガー`, `Validation Rule` → `入力規則`, `Workflow Rule` → `ワークフロールール`, `Process Builder` → `プロセスビルダー`, `Approval Process` → `承認プロセス`, `Assignment Rule` → `割り当てルール`, `Escalation Rule` → `エスカレーションルール`, `Connected App` → `接続アプリケーション`, `External Client App` → `外部クライアントアプリケーション`, `Custom Setting` → `カスタム設定`, `Custom Label` → `カスタム表示ラベル`, `Custom Permission` → `カスタム権限`, `Field` → `項目`, `Deployment` → `デプロイ`, `Production (Org)` → `本番環境`, `Sandbox` → `Sandbox`, `Scratch Org` → `スクラッチ組織`, `Lightning Page` → `Lightningページ`, `Lightning Web Component` → `Lightning Webコンポーネント`, `Developer Console` → `開発者コンソール`, `Dashboard` → `ダッシュボード`).
- **German-specific terms**: Use the official Salesforce German translation when translating to German.
  - Use formal German ("Sie" not "du") for all user facing text.
  - Keep English technical terms untranslated: merge, commit, branch, scratch org, package.xml, DevHub, SOQL, DML, CSV, REST, Bulk API, upsert, mock data.
  - Use standard German software/IT terminology (e.g. "Datensatz" for record, "Org" stays as "Org", "Workspace" stays as "Workspace").
  - Keep brand names untranslated: Salesforce, SFDMU, Git, GitHub, GitLab, JIRA, VS Code.
- **Polish-specific terms**: Use natural, professional Polish for Salesforce developers.
  - Use neutral formal Polish — avoid personal address forms ("ty", "Pan", "Pani"). Use impersonal constructs or verbs in third person when possible (e.g. "Czy chcesz..." instead of "Chcesz...").
  - Keep English technical terms untranslated: merge, commit, branch, Scratch Org, package.xml, DevHub, SOQL, DML, CSV, REST, Bulk API, upsert, mock data, org, sandbox.
  - Keep Salesforce metadata names in English: Flow, Permission Set, Permission Set Group, Profile, Custom Setting, Custom Label, Custom Permission, Connected App, External Client App, Validation Rule, Workflow Rule, Approval Process, Assignment Rule, Escalation Rule, Record Type, Lightning Page, Lightning Web Component, Static Resource, Visualforce, sObject, Flexipage.
  - Keep brand names untranslated: Salesforce, SFDMU, Git, GitHub, GitLab, JIRA, VS Code, Azure DevOps, Bitbucket, Docker, Cloudflare, ServiceNow, MermaidJS.
  - Translate key terms consistently: "deployment" → "wdrożenie", "deploy" → "wdrożyć", "retrieve" → "pobrać"/"pobieranie", "scratch org" → stays as "Scratch Org", "metadata" → "metadane", "org" → stays as "org".
  - Use Polish-specific software vocabulary: "błąd" for error, "ostrzeżenie" for warning, "repozytorium" for repository, "gałąź" for branch (but keep "branch" as-is when referring to git commands), "wdrożenie" for deployment.
- **Italian-specific terms**: Use natural, informal Italian ("tu" register) matching the standard style used in Italian software products.
  - Keep English technical terms untranslated: merge, commit, branch, scratch org, package.xml, DevHub, SOQL, DML, CSV, REST, Bulk API, upsert, mock data, sandbox, deployment plan, pull request, merge request.
  - Keep Salesforce metadata names in English: Flow, Permission Set, Permission Set Group, Profile, Custom Setting, Custom Label, Custom Permission, Connected App, External Client App, Validation Rule, Workflow Rule, Approval Process, Assignment Rule, Escalation Rule, Record Type, Lightning Page, Lightning Web Component, Static Resource, Visualforce, sObject, Flexipage.
  - Keep brand names untranslated: Salesforce, SFDMU, Git, GitHub, GitLab, JIRA, VS Code, Cloudity, Apex, LWC, sfdx-hardis, Azure DevOps, Docker, Cloudflare, ServiceNow, MermaidJS.
  - Translate key terms consistently: "deployment" → "distribuzione", "configuration" → "configurazione", "settings" → "impostazioni", "metadata" → "metadati", "package" (generic) → "pacchetto".
  - "org" stays as "org"; "workspace" stays as "workspace" or "area di lavoro".
  - Keep all `{{varName}}` interpolation placeholders, `\n` newlines, `<br/>` tags, emoji characters, and markdown formatting exactly as-is.

### uxLog calls

Every `uxLog` call whose message contains user-visible text **must** use `t()`:

```typescript
// ✅ Correct
uxLog("action", this, c.cyan(t("deployingMetadata", { metadata: name })));

// ❌ Wrong – hardcoded English string
uxLog("action", this, c.cyan(`Deploying metadata ${name}...`));
```

Exceptions (no `t()` needed):

- The entire string is a variable or expression (e.g. `uxLog("other", this, JSON.stringify(result))`).
- The string is a debug stack trace (e.g. `uxLog("log", this, c.grey(e.stack))`).
- The string is a URL only.
- The uxLog is "other" (e.g. `uxLog("other", this, "Some message")`)

### uxLogTable usage

Use `uxLogTable` for user-facing tables so formatting stays consistent across plugins:

```typescript
import { uxLogTable } from "../../../common/utils/uxLog.js";
import { t } from "../../../common/utils/i18n.js";

uxLogTable(
  this,
  [
    { name: "My Flow", type: "Flow", status: "Active" },
    { name: "My Object", type: "Custom Object", status: "Inactive" },
  ],
  [
    { key: "name", label: t("name") },
    { key: "type", label: t("type") },
    { key: "status", label: t("status") },
  ]
);
```

### prompts() calls

For every `prompts()` call, the `message`, `description`, `placeholder` and `choices[].title` properties must use `t()` where they contain user-visible text:

```typescript
// ✅ Correct
const res = await prompts({
  type: "select",
  name: "value",
  message: t("selectEnvironment"),
  description: t("selectEnvironmentDescription"),
  choices: [
    { title: t("choiceProduction"), value: "prod" },
    { title: t("choiceSandbox"), value: "sandbox" },
  ],
});

// ❌ Wrong – hardcoded strings
const res = await prompts({
  type: "select",
  name: "value",
  message: "Select environment",
  description: "Choose the target environment",
  choices: [{ title: "Production", value: "prod" }],
});
```

### sendReportFileMessage calls

For every `sendReportFileMessage()` the second argument (message) must use `t()` if it contains user-visible text:

```typescript
WebSocketClient.sendReportFileMessage(
  slackIntegrationUrl,
  t("slackIntegration"),
  "docUrl"
);
```

### WebSocketClient.sendProgressStartMessage() calls

For every `WebSocketClient.sendProgressStartMessage()` call, the first argument (message) must use `t()` if it contains user-visible text:

```typescript
WebSocketClient.sendProgressStartMessage(
  t("collectingInstalledPackagesData"),
  packages.length
);
```

### Markdown table headers

Do not put the whole markdown table header in a translation key. Instead, only translate the column names and concatenate them in the code:

```typescript
const header = `| ${t("name")} | ${t("type")} | ${t("description")} |`;
```

## AI Integration Notes

- Supports multiple AI providers (Anthropic, Google GenAI, Ollama)
- Prompt templates are versioned and localizable
- AI features are used for documentation generation and error solving
- Custom prompts can be overridden via configuration files

## Documentation

- Main docs at <https://sfdx-hardis.cloudity.com>
- Command documentation auto-generated via `yarn build:doc`
- Uses MkDocs for documentation site generation
- Supports AI-generated documentation features
- Each command must have a `description` property with command behavior and technical explanations

Example:

```typescript
  public static description = `
## Command Behavior

**Checks the current usage of various Salesforce org limits and sends notifications if thresholds are exceeded.**

This command is a critical component of proactive Salesforce org management, helping administrators and developers monitor resource consumption and prevent hitting critical limits that could impact performance or functionality. It provides early warnings when limits are approaching their capacity.

Key functionalities:

- **Limit Retrieval:** Fetches a comprehensive list of all Salesforce org limits using the Salesforce CLI.
- **Usage Calculation:** Calculates the percentage of each limit that is currently being used.
- **Threshold-Based Alerting:** Assigns a severity (success, warning, or error) to each limit based on configurable thresholds:
  - **Warning:** If usage exceeds 50% (configurable via \`LIMIT_THRESHOLD_WARNING\` environment variable).
  - **Error:** If usage exceeds 75% (configurable via \`LIMIT_THRESHOLD_ERROR\` environment variable).
- **CSV Report Generation:** Generates a CSV file containing all org limits, their current usage, maximum allowed, and calculated percentage used, along with the assigned severity.
- **Notifications:** Sends notifications to configured channels (Grafana, Slack, MS Teams) with a summary of limits that have exceeded the warning or error thresholds.

This command is part of [sfdx-hardis Monitoring](${CONSTANTS.DOC_URL_ROOT}/salesforce-monitoring-org-limits/) and can output Grafana, Slack and MsTeams Notifications.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Salesforce CLI Integration:** It executes the \`sf org limits list\` command to retrieve the current org limits. It parses the JSON output of this command.
- **Data Processing:** It iterates through the retrieved limits, calculates the \`used\` and \`percentUsed\` values, and assigns a \`severity\` (success, warning, error) based on the configured thresholds.
- **Environment Variable Configuration:** Reads \`LIMIT_THRESHOLD_WARNING\` and \`LIMIT_THRESHOLD_ERROR\` environment variables to set the warning and error thresholds for limit usage.
- **Report Generation:** It uses \`generateCsvFile\` to create the CSV report of org limits.
- **Notification Integration:** It integrates with the \`NotifProvider\` to send notifications, including attachments of the generated CSV report and detailed metrics for each limit, which can be consumed by monitoring dashboards like Grafana.
- **Exit Code Management:** Sets the process exit code to 1 if any limit is in an 'error' state, indicating a critical issue.
</details>
`;

```

## Special Considerations

- Large codebase with 300+ commands
- Enterprise-grade tool used in production environments
- Multi-platform support (Windows, macOS, Linux)
- Docker container support available
- VS Code extension available for UI interaction

When working on this project, always consider the enterprise nature of the tool and maintain high code quality standards.

## Copilot behavior

- Do not ask if I want to continue to iterate: ALWAYS continue to iterate until the task is complete.
- Build commands using git bash for windows formatting.

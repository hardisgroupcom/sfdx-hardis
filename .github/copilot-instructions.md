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
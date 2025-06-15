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

- Main docs at https://sfdx-hardis.cloudity.com
- Command documentation auto-generated via `yarn build:doc`
- Uses MkDocs for documentation site generation
- Supports AI-generated documentation features

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
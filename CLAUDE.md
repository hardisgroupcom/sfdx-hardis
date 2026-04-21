# sfdx-hardis

Salesforce DevOps toolbox by Cloudity -- CI/CD pipelines, metadata backup/monitoring, project documentation generation. Open-source, enterprise-grade, multi-platform.

## Quick Reference

| Command | Description |
|---------|-------------|
| `yarn build` | Full build (compile + lint + JSON schema doc via wireit) |
| `yarn compile` | TypeScript compilation only |
| `yarn lint` | ESLint on src/ and test/ |
| `yarn test` | Full test suite (CI-gated) |
| `yarn test:only` | Unit tests only (CI-gated) |
| `yarn test:nuts` | Integration tests (long timeout, parallel) |
| `yarn format` | Prettier on src/test/schemas |
| `yarn clean` | sf-clean |
| `yarn build:doc` | Auto-generate command documentation |
| `./bin/dev.js hardis:<cat>:<action>` | Test a command locally (no build needed) |

**Package manager**: Yarn only. Do not use npm. Lock file: `yarn.lock`.

## Contribution Workflow

1. `/analyze` -- Gather requirements, ask questions until the problem is fully understood
2. `/design` -- Design the solution and write a technical specification
3. `/implement` -- Implement the changes in source code
4. `/test` -- Build, lint, and run tests

## Behavior Preferences

- Always continue iterating until the task is complete -- do not ask to continue.
- Use git bash for Windows formatting when building commands.

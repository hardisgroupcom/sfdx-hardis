---
name: test
description: Build, lint, and run tests to verify the implementation. Fourth step of the contribution workflow, use after /implement.
disable-model-invocation: true
allowed-tools: Read Glob Grep Write Edit Bash
argument-hint: "[additional context]"
model: sonnet
---

You are a QA engineer for the **sfdx-hardis** project.

Verify the implementation by building, linting, and running tests.

> Related agent: this skill mirrors the `test` subagent (same process, also on Sonnet - running build/lint/test and fixing mechanical errors is medium-complexity work).

## Process

1. **Compile**: Run `yarn compile` to check TypeScript compilation.
2. **Lint**: Run `yarn lint` to check for ESLint violations.
3. **Fix issues**: If compilation or linting fails, fix the errors and re-run.
4. **Test locally**: If the change involves a command, test it with:
   ```bash
   ./bin/dev.js hardis:<category>:<action> [flags]
   ```
5. **Report results**: Summarize what passed and what failed.

## Common Issues

- Missing `.js` extensions in imports -> add them
- i18n keys not in all locale files -> add missing keys
- Type errors -> fix TypeScript types
- Lint errors -> follow ESLint rules

Continue fixing and re-running until all checks pass. Do not stop to ask whether to continue.

$ARGUMENTS

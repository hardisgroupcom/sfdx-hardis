---
name: implement
description: Implement code changes following the technical specification. Third step of the contribution workflow, use after /design.
disable-model-invocation: true
allowed-tools: Read Glob Grep Write Edit Bash
argument-hint: "[additional context]"
---

You are a developer working on the **sfdx-hardis** project.

Implement the changes according to the design from the prior `/design` conversation.

Read `.claude/rules/` for coding conventions, i18n rules, and translation rules before making changes.

## Process

1. **Review the design**: Understand what needs to be implemented from the prior `/design` conversation.
2. **Implement changes** following project conventions:
   - Use `.js` import extensions
   - Use `uxLog()` with `chalk` for logging (no emojis at line start)
   - Use `t()` for all user-visible strings
   - Use `fs-extra` for file operations
   - Use `prompts()` for user input
   - Follow the provider pattern for external integrations
3. **Add translations**: If new i18n keys were introduced, add them to **all 9 locale files** (`en`, `de`, `es`, `fr`, `it`, `ja`, `nl`, `pl`, `pt-BR`), sorted alphabetically.
4. **Update JSON schema**: If a config property is added or modified (anything read via `getConfig()`), update `config/sfdx-hardis.jsonschema.json` to match. Each property needs `$id`, `description`, `title`, `type`, and optionally `default`, `enum`, `examples`, `docUrl`.
5. **Verify patterns**: Ensure new code matches existing patterns in the codebase.
6. **Update CHANGELOG.md**: Add a bullet point under the `## [beta] (master)` section describing the change. Follow the existing style:
   - Start with a short description of the change.
   - If a new command was added, include a link: `[hardis:topic:action](https://sfdx-hardis.cloudity.com/hardis/topic/action/)`.
   - If an existing command was modified, reference it the same way.
   - Keep it concise (one or two lines per change).

Continue iterating until all changes from the design are implemented. Do not stop to ask whether to continue.

$ARGUMENTS

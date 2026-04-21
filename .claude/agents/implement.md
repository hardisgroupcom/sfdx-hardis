---
name: implement
description: Implement code changes following the technical specification. Use after /design.
tools: Read, Grep, Glob, Edit, Write, Bash
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
4. **Verify patterns**: Ensure new code matches existing patterns in the codebase.

Continue iterating until all changes from the design are implemented. Do not stop to ask whether to continue.

---
name: implement
description: Implement a feature, bug fix, or code change in sfdx-hardis. Use whenever the user asks to add a feature, fix a bug, implement something, or make a code change - with or without a prior /design phase.
disable-model-invocation: true
allowed-tools: Read Glob Grep Write Edit Bash
argument-hint: "[feature or change to implement]"
---

You are a developer working on the **sfdx-hardis** project.

Implement the requested changes. If a prior `/design` conversation exists, follow that specification. Otherwise, derive the implementation plan from the user's request and the existing codebase - explore relevant files with Glob/Grep before writing any code.

Read `.claude/rules/` for coding conventions, i18n rules, and translation rules before making changes.

## Process

1. **Understand what to implement**: If a `/design` spec exists in the conversation, follow it. Otherwise, read the user's request, grep for relevant existing code, and form a clear implementation plan before writing anything.
2. **Implement changes** following project conventions:
   - Use `.js` import extensions
   - Use `uxLog()` with `chalk` for logging (no emojis at line start)
   - Use `t()` for all user-visible strings
   - Use `fs-extra` for file operations
   - Use `prompts()` for user input
   - Follow the provider pattern for external integrations
   - In `src/commands/**` files, keep only the command class declaration in the file body; move interfaces, types, and helper functions to sibling utility modules.
   - Allowed exception: top-level `Messages.importMessagesDirectoryFromMetaUrl(import.meta.url)` and `const messages = Messages.loadMessages(...)` can remain in command files.
3. **Add translations**: If new i18n keys were introduced, add them to **all 9 locale files** (`en`, `de`, `es`, `fr`, `it`, `ja`, `nl`, `pl`, `pt-BR`), sorted alphabetically.
4. **Update command description**: If you add, remove, or change the behavior of a command in `src/commands/**`, update its static `description` property to accurately reflect the new behavior. Follow the format in the `documentation` skill: `## Command Behavior` section listing key features, and a `<details>Technical explanations</details>` block. If the command gains or loses an `--agent` flag, update the `### Agent Mode` section accordingly and update `docs/salesforce-agentic-automation.md`.
5. **Update JSON schema**: If a config property is added or modified (anything read via `getConfig()`), update `config/sfdx-hardis.jsonschema.json` to match. Each property needs `$id`, `description`, `title`, `type`, and optionally `default`, `enum`, `examples`, `docUrl`.
6. **Verify patterns**: Ensure new code matches existing patterns in the codebase.
7. **Update CHANGELOG.md**: Add a bullet point under the `## [beta] (master)` section describing the change. Follow the existing style:
   - Write for **end users**, not developers. Describe what changed from the user's perspective - what they can now do, what was fixed, what behaves differently.
   - Omit implementation details: no class names, internal method names, hook names, i18n keys, TypeScript types, or file paths unless they are user-visible config keys or flag names.
   - If a new command was added, include a link: `[hardis:topic:action](https://sfdx-hardis.cloudity.com/hardis/topic/action/)`.
   - If an existing command was modified, reference it the same way.
   - One short sentence per change. Two sentences maximum only when a second sentence adds essential user-facing context.

Continue iterating until all changes from the design are implemented. Do not stop to ask whether to continue.

$ARGUMENTS

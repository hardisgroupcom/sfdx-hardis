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
7. **Update CHANGELOG.md**: Add a bullet under `## [beta] (master)`. **Be radically concise: announce the feature in ONE short line per entry, nothing more.** Readers who want details click the command's doc URL.
   - **One line per entry.** No sub-bullets, no enumerations of flags / env vars / config keys / behavior details. Those live in the command's `description` and the auto-generated docs page.
   - Write for **end users**, not developers. State what they can now do (or what was fixed) - omit class names, method names, file paths, i18n keys, TypeScript types, flag names, default-value numbers, status codes, internal field names, Setup paths.
   - If a new command was added, include a link: `[hardis:topic:action](https://sfdx-hardis.cloudity.com/hardis/topic/action/)`. If an existing command was modified, reference it the same way.
   - Avoid run-on sentences. If the entry needs commas or "and" three times, you are over-explaining - trim until it fits one line.
   - Example - good:
     ```
     - New [hardis:org:diagnose:mfa](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/mfa/): Audit MFA configuration and prepare for Salesforce's July 1 2026 phishing-resistant MFA enforcement.
     ```
   - Example - too verbose (do NOT do this):
     ```
     - New [hardis:org:diagnose:mfa](...): Audit MFA.
       - Primary check: phishing-resistant MFA readiness via VerificationHistory.
       - Five additional checks: org-wide MFA enforcement, ...
       - New `--lookback-days`, `--ignore-users`, `--privileged-permissions` flags.
       - New `monitoringMfaIgnoreUsers` config key.
       - Wired into monitor:all at weekly frequency.
     ```
     All the bullets above belong in the command's `description` and the docs page, not the changelog.
   - Exception: a sub-bullet is acceptable ONLY when a single behavior change has a critical user-visible aspect that cannot wait for the docs (e.g. a breaking migration, a required follow-up action). Default to no sub-bullets.

Continue iterating until all changes from the design are implemented. Do not stop to ask whether to continue.

$ARGUMENTS

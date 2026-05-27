---
name: changelog
description: Style rules for updating CHANGELOG.md entries. Use whenever the user asks to update, add to, or write entries in CHANGELOG.md.
user-invocable: false
---

# CHANGELOG Style

CHANGELOG.md entries are read by **end users** (Salesforce admins, devs, ops) deciding whether to upgrade. They are not internal dev notes.

## Rules

- **Stay concise.** One short bullet per change. One sentence is the target. No paragraphs.
- **Write for end users, not developers.** Describe the user-visible behavior or capability, not the implementation.
  - YES: "More engaging intro on the generated documentation home page."
  - NO: "The `welcomeToDocumentation` i18n key now teases what is browsable..."
  - NO: "Translated to all 9 locales (de, en, es, fr, it, ja, nl, pl, pt-BR)." (mention only if it is the change itself, e.g. "Added German translations")
- **Skip implementation details** unless they directly affect the user: file paths, function names, i18n keys, internal flags, refactor mechanics.
- **Link the command** when the entry applies to a specific command, using the standard format `[hardis:topic:action](https://sfdx-hardis.cloudity.com/hardis/topic/action/)`.
- **Add entries under `## [beta] (main)`** at the top of the file. Do not create version sections - releases set those.

## Pattern

```markdown
- [hardis:topic:action](https://sfdx-hardis.cloudity.com/hardis/topic/action/): <one short sentence about user-visible change>.
- <Site / generic change>: <one short sentence>.
```

If a single change has genuinely independent user-facing facets, use nested bullets - but only when each sub-bullet is itself end-user relevant (a new flag, a new channel, a new default). Never use sub-bullets to list affected files or locales.

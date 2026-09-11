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
- **Always group updates by command.** A command must appear at most once in a section. If it already has an entry (or you are adding several changes to the same command), write the command link once and put each change as a nested bullet under it - never repeat the same command link on multiple top-level lines. A single change stays on one line: `[command](url): <change>.`
- **Group with bullets, never with a header.** The command link is a top-level bullet and its changes are nested bullets under it. Never open a `###` (or any other) header for a command, however many changes it has.
- **Add entries under `## [beta] (main)`** at the top of the file. Do not create version sections - releases set those.

## Pattern

Single change for a command:

```markdown
- [hardis:topic:action](https://sfdx-hardis.cloudity.com/hardis/topic/action/): <one short sentence about user-visible change>.
- <Site / generic change>: <one short sentence>.
```

Multiple changes for the same command - group them under one command link:

```markdown
- [hardis:topic:action](https://sfdx-hardis.cloudity.com/hardis/topic/action/):
  - <one short sentence about the first user-visible change>.
  - <one short sentence about the second user-visible change>.
```

Each nested bullet must be end-user relevant (a new flag, a new channel, a new default, a fixed behavior). Never use sub-bullets to list affected files or locales.

Never do this, even when a command has many changes:

```markdown
### [hardis:topic:action](https://sfdx-hardis.cloudity.com/hardis/topic/action/)

- <change>.
- <change>.
```

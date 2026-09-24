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
- **The same goes for a feature.** Changes to one feature that spans several commands (promotion branches, backpromote, monitoring, the VS Code DevOps Pipeline...) share one top-level bullet with the feature's doc link, and each change is a nested bullet that links the command it touches. Before adding an entry, read the whole beta section: if its command or its feature already has a line, add to that line (turning it into a group if needed) instead of writing a new one.
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

Several changes to the same feature, across its commands:

```markdown
- [Promotion branches](https://sfdx-hardis.cloudity.com/salesforce-devops-promotion-branches/) (Beta):
  - New `someProperty` property: <what it lets the user do>.
  - [hardis:project:promotion:create](https://sfdx-hardis.cloudity.com/hardis/project/promotion/create/): <change>.
```

Each nested bullet must be end-user relevant (a new flag, a new channel, a new default, a fixed behavior). Never use sub-bullets to list affected files or locales.

Never do this, even when a command has many changes:

```markdown
### [hardis:topic:action](https://sfdx-hardis.cloudity.com/hardis/topic/action/)

- <change>.
- <change>.
```

## Keep the Pull Request description in sync

A CHANGELOG entry is rarely the only thing a change owes its readers. Whenever you **add work to a Pull Request that is already open**, update its description in the same pass:

- The description must describe **what the PR contains now**, not what it contained when it was opened. A reviewer reads the description first, and a stale one sends them looking for things that moved or are no longer there.
- Do it as part of finishing the work, not as a follow-up: a PR whose scope grew silently is the one that gets reviewed against the wrong expectations.
- Mention what changed and, when a decision was made during the work (a default that flipped, an option that was dropped, a finding that turned out to be wrong), say so. Those are what a reviewer needs and cannot see from the diff.
- **Always edit the description with the REST API, never `gh pr edit`:**
  `gh api -X PATCH repos/<owner>/<repo>/pulls/<number> -F body=@<file.md>`
  `gh pr edit` fails with a `projectCards` GraphQL error on repositories that still have Projects (classic), and it fails *silently enough* to look like it worked: it prints the error but leaves the description untouched. Write the body to a file and PATCH it.

The same applies to the PR title when the scope no longer matches it.

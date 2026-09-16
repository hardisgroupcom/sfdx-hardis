---
name: training-update
description: Perform the edits in the sibling sfdx-hardis-training repository after training-impact found an impact, or when a lab has to change for its own reasons. Covers the lab text, training-universe.json, the audit rules, the link map, the Helios screenshot fixtures and the screenshot capture. Use it when the user says "update the training", "fix the labs", "regenerate the training screenshots", or when a training Pull Request has to be opened.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Updating the training

Load this once [[training-impact]] has said there is an impact, or when a lab has to change for its
own reasons. It does the editing; the other skill does the deciding.

## Before anything

```bash
[ -d ../sfdx-hardis-training ] || git clone https://github.com/hardisgroupcom/sfdx-hardis-training.git ../sfdx-hardis-training
cd ../sfdx-hardis-training
git checkout main && git pull
git checkout -b fix/<what-changed>
```

The sibling path is fixed and never configurable. Same for `../vscode-sfdx-hardis` when screenshots
have to be regenerated.

## What lives where

| What                                       | Where                                                                            | Generated?                                     |
|--------------------------------------------|----------------------------------------------------------------------------------|------------------------------------------------|
| The lab text                               | `labs/en/level-N/lab-NN-*.md`                                                    | No, written by hand                            |
| The fiction: stories, branches, orgs, cast | `training-universe.json`                                                         | No, the source of truth                        |
| The backlog, the link map, the manifest    | `BACKLOG.md`, `labs/link-map.en.md`, `training-manifest.json`                    | **Yes**, `scripts/build/universe.mjs`          |
| The audit rules                            | `scripts/verify/rules.mjs`                                                       | No                                             |
| The seed data                              | `scripts/data/HeliosBaseline/*.csv`                                              | **Yes**, `scripts/build/data.mjs`              |
| The screenshot fixtures                    | `../vscode-sfdx-hardis/test/fixtures/screenshot/helios/` and `training-project/` | **Yes**, `scripts/build/mocks.mjs`             |
| The screenshots                            | `labs/_assets/vscode/*.png`                                                      | **Yes**, the extension harness                 |
| The site sources                           | `site-src/`                                                                      | **Yes**, `scripts/build/site.mjs`, git-ignored |

**Never edit a generated file.** Change its source and re-run the generator. CI fails on drift
(`node scripts/build/universe.mjs --check`).

## Editing a lab

Every lab carries front matter that drives the manifest and the checks:

```yaml
---
id: l2-lab-06-conflicts
level: 2
lab: 6
lang: en
source_rev: ""
screenshots:
  - vscode/devops-pipeline
depends_on:
  commands: [hardis:work:save, hardis:work:refresh]
  flags: []
  config: [overwriteMode]
  panels: [pipeline]
  docs: [salesforce-devops-work-on-user-story-profiles]
---
```

When you change what a lab relies on, **change `depends_on` too**. It is what makes the next impact
check work, and it is the one thing easy to forget.

House style for the lab body, in order: `The situation`, `Before you start`, `Steps`,
`What you should see`, `If it goes wrong`, `Check your work`, `Go deeper`.

Three rules the labs are written under, and they are not negotiable:

1. **Clicks, not code.** Every action is a button in the extension. A panel exists for almost
   everything: check `src/webviews/lwc-ui/modules/s/` in the extension before writing a command
   block. A lab that reaches for a terminal when a panel would do is a defect in the lab
2. **Authenticating to an org is always Orgs Manager.** Never `sf org login web` in a lab, at any
   level, for any org
3. **Under the hood, every time.** Each significant step closes with a `<details>` block naming the
   exact command, the files it wrote, and the one decision the tool made that the learner could not
   see

## Changing the fiction

Edit `training-universe.json`, never a lab, when the change is about a User Story, a branch, an org
or a character. Then:

```bash
node scripts/build/universe.mjs
```

It regenerates the backlog, the link map and the manifest, and **fails when a lab mentions a story
id, an org or a branch the universe does not define**. That check is what stops the labs and the
screenshots telling two different stories.

## Changing an audit rule

`scripts/verify/rules.mjs` holds every rule, used by both `Check my work` and the badge claim.

Two hard rules when editing one:

1. **Assert outcomes, never procedures.** A learner who rebased, squashed or resolved a conflict in
   the GitHub web editor did the work and must pass. Never assert "a merge commit with two parents
   exists"
2. **A failure message names the lab, what was looked for, and where.** It is the only support
   channel a learner has

Test both paths after any change:

```bash
node scripts/verify/check.mjs --level 2
node scripts/verify/audit.mjs --level 2 --dir <a clone> --handle test
```

## Regenerating the screenshots

Only when a panel actually changed. It is a local Windows run, because it drives a real VS Code
window through PowerShell.

```bash
# 1. the fixtures, from the training repository
cd ../sfdx-hardis-training
node scripts/build/mocks.mjs

# 2. the capture, from the extension repository
cd ../vscode-sfdx-hardis
yarn dev && yarn compile
SF_MOCK_UNIVERSE=helios \
SFDX_HARDIS_DOC_SCREENSHOTS_DIR=../sfdx-hardis-training/labs/_assets/vscode \
yarn screenshots [names]
```

Pass only the names you need: the full batch takes about fifteen minutes.

**`SF_MOCK_UNIVERSE` unset must keep the product documentation screenshots byte for byte
unchanged.** That is the invariant of the whole fixture design. Prove it after touching anything in
the harness:

```bash
cd ../vscode-sfdx-hardis
yarn screenshots            # writes doc-screenshots/, the MyCompany-CRM universe
git status --porcelain doc-screenshots
```

Anything modified there means the training work broke the product images.

Then look at the images. A screenshot that shows the wrong org, an unrelated project or a stale
Pull Request is worse than no screenshot, because it teaches the learner that the picture is
decoration.

## Before opening the Pull Request

```bash
cd ../sfdx-hardis-training
node scripts/build/universe.mjs --check   # generated files up to date, fiction consistent
node scripts/verify/check-links.mjs       # every link resolves
node scripts/build/site.mjs               # the site assembles
```

## The Pull Request

State which labs were re-verified, and how. "Re-read" is not re-verified: a lab is re-verified when
somebody walked its steps, or when its audit rule was run against a repository in that state.

Cross-link it with the CLI and extension Pull Requests of the same change.

Keep the running **Found while training** list in the training Pull Request description: anything
the exercise turned up in the CLI or the extension, with where it was fixed. A finding that is
neither fixed nor written down is the only unacceptable outcome.

## Related

- [[training-impact]] decides whether any of this is needed
- The `vscode-sfdx-hardis` skill, for the extension side of the same change

---
name: training-update
description: Perform the edits in the sibling sfdx-hardis-training repository after training-impact found an impact, or when a lab has to change for its own reasons. Covers the lab text, training-universe.json, the audit rules, the link map, the Helios screenshot fixtures, and the screenshot rules: capture, web captures, numbered pills and verification. Use it when the user says "update the training", "fix the labs", "regenerate the training screenshots", "annotate a screenshot", or when a training Pull Request has to be opened.
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

| What                                       | Where                                                                            | Generated?                                      |
|--------------------------------------------|----------------------------------------------------------------------------------|-------------------------------------------------|
| The lab text                               | `labs/en/level-N/lab-NN-*.md`                                                    | No, written by hand                             |
| The fiction: stories, branches, orgs, cast | `training-universe.json`                                                         | No, the source of truth                         |
| The backlog, the link map, the manifest    | `BACKLOG.md`, `labs/link-map.en.md`, `training-manifest.json`                    | **Yes**, `scripts/build/universe.mjs`           |
| The audit rules                            | `scripts/verify/rules.mjs`                                                       | No                                              |
| The seed data                              | `scripts/data/HeliosBaseline/*.csv`                                              | **Yes**, `scripts/build/data.mjs`               |
| The screenshot fixtures                    | `../vscode-sfdx-hardis/test/fixtures/screenshot/helios/` and `training-project/` | **Yes**, `scripts/build/mocks.mjs`              |
| The raw panel screenshots                  | `labs/_assets/vscode/*.png`                                                      | **Yes**, the extension harness                  |
| The raw web screenshots                    | `labs/_assets/web/*.png`                                                         | **Yes**, `scripts/build/capture-web.mjs`        |
| The capture and annotation specs           | `labs/_assets/web-captures.json`, `labs/_assets/annotations.json`                | No, written by hand                             |
| The annotated screenshots labs link        | `labs/_assets/annotated/`                                                        | **Yes**, `scripts/build/annotate.mjs`           |
| The raw Salesforce screenshots             | `labs/_assets/salesforce/*.png`                                                  | **Yes**, `scripts/build/capture-salesforce.mjs` |
| The site sources                           | `site-src/`                                                                      | **Yes**, `scripts/build/site.mjs`, git-ignored  |
| The site theme                             | `site-theme/`                                                                    | No, copied into the site by `site.mjs`          |
| What a learner starts each level from      | `scripts/start-states/level-N/`                                                  | No, written by hand                             |
| The teammate Pull Requests                 | `scripts/simulate/<story>/`                                                      | No, written by hand                             |

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

## Two rules about the reader, and they are hard rules

**Never send anybody to a terminal.** Not once, in any level. Every action a lab asks for is a click
in a VS Code sfdx-hardis panel, a Training menu entry on the Welcome page, a button in the GitHub web
UI, or typing into a file in the editor. A command may only appear inside a collapsed
`<details>` block titled "Under the hood", as an explanation of what a button did, never as an
instruction. There is no fenced ```bash block outside such a block anywhere in the course, and adding
one is a regression.

When a step has no button, that is a finding, not a licence: either the product has a click nobody
named, or the product is missing one. Two examples that were fixed rather than documented: connecting
an org could not set an alias, so `hardis:org:select` gained `--alias` and a prompt; setting up a
fork by hand took a dozen forms, so `Training > Set up my pipeline` does it.

```bash
# The check. It must print nothing.
grep -rniE "from a terminal|open a terminal|in a terminal" labs/en/
```

**Levels 1 and 2 are for admins as much as for developers.** The main narrative must not assume
developer knowledge. Raw XML, git internals, Apex interfaces, YAML structure and wildcard patterns
either get a plain-English gloss where they first appear, or they move into a `<details>` block. Code
a lab contains is there to be **copied and read**, never written from scratch: say so. Level 3 is for
release managers and may be as technical as it needs to be.

The tells that a Level 1 or 2 paragraph has drifted: a command name used as an explanation
(`hardis:work:save` generates the package from the git diff), a file path the reader has no reason to
know, an unglossed term (idempotent, working tree, soft reset, grep, `@testSetup`), or a step that
asks the reader to hand-edit metadata that a panel can edit.

## Level 1 lab 0 stands on its own

It installs the tools and nothing else: Git, VS Code, Node, the GitHub CLI, the extension pack, and
the Setup panel installing the Salesforce CLI. Somebody joining a real project can do that lab and
stop, and the lab says so. Everything training-specific, the two free orgs, the clone, the pipeline,
the seeded data, belongs to lab 1. Keep that line where it is: a tool that belongs on every
Salesforce workstation goes in lab 0, anything that only makes sense for Helios goes in lab 1.

## Screenshots

The audience has no Salesforce background and no git background. A step it cannot see is a step it
cannot do. The rules below are hard rules, not preferences.

### What a lab must show

1. **Every step that tells a learner to click something shows it.** A step that names a button, a
   panel, a tab or a field and carries no screenshot of that screen is not finished. "Click New
   User Story in the DevOps Pipeline panel" needs a picture with that button marked
2. **Screenshots carry numbered pills, and the step text references the numbers.** That is what
   stops the prose and the picture drifting apart. Pills are drawn by
   `node scripts/build/annotate.mjs` from `labs/_assets/annotations.json` into
   `labs/_assets/annotated/`, and labs reference the annotated copy, never the raw one
3. **`labs/_assets/annotated/` is generated.** Never retouch an image there by hand: change the
   spec and re-run the generator
4. **A pill never covers anything the learner has to read**: text, a label, a field value, an icon.
   Put it outside the highlighted box, which is what the `px` / `py` keys of the spec are for.
   After drawing, look at the result and move any pill that landed on something

### Verify every screenshot twice, by opening the image

Both passes mean actually looking at the file, not at the file name:

1. **At capture.** Is it the right screen? Is it cropped so the relevant part is legible? Does it
   leak anything personal: a real username, an org id, an unrelated organisation name, a browser
   banner
2. **After the pills are drawn.** Is every pill on the element the text says it is? Does any pill
   hide something

A screenshot that has not been looked at has not been verified.

### Two capture paths, and nothing else

**VS Code panels** come from the extension's own harness, in the sibling clone. It drives a VS Code
instance it owns. Regenerate only when a panel actually changed.

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

**Web pages** come from `scripts/build/capture-web.mjs`, declared in `labs/_assets/web-captures.json`,
driven by Playwright over CDP against a Chrome started with `--remote-debugging-port=9222`. A page
that has to be seen signed out is declared `"fresh": true` and gets its own clean Chrome profile.

```bash
cd ../sfdx-hardis-training
node scripts/build/capture-web.mjs [names]
node scripts/build/annotate.mjs
```

**Never call `browser.close()` on a CDP connection.** `chromium.connectOverCDP` attaches to the
user's running browser: closing it closes *their* browser, with everything they had open. Close only
the pages the script opened. A capture that needs a browser of its own uses
`launchPersistentContext` with its own `--user-data-dir`, and closes that context. This has happened
once: the user lost their session and their CDP Chrome, which cannot simply be relaunched because
Chrome refuses `--remote-debugging-port` on the default profile.

**Never automate the desktop to take a screenshot.** No `SendKeys`, no `SetForegroundWindow`, and
never kill a window matched by its title. Done once, it took over the user's own VS Code window,
typed into it, closed it, and the image it produced contained the user's real org usernames.

### Prove the product images did not move

**`SF_MOCK_UNIVERSE` unset must keep the product documentation screenshots byte for byte
unchanged.** That is the invariant of the whole fixture design. Prove it after any screenshot work:

```bash
cd ../vscode-sfdx-hardis
yarn screenshots            # writes doc-screenshots/, the MyCompany-CRM universe
git status --porcelain doc-screenshots
```

Empty output, or the training work broke the product images.

### Third-party screens rot faster than the rest

GitHub, the Salesforce signup, an installer page: they change without warning, and the lab still
reads fine while the clicks no longer exist. When a lab describes such a screen, re-check the
screen against the live page before trusting the text. Two found the hard way:

- GitHub ticks "Copy the main branch only" by default, and a lab said to leave the defaults alone,
  which produced a fork with a single branch
- the Salesforce Developer Edition signup no longer asks for a username at all

A screenshot that shows the wrong org, an unrelated project or a stale Pull Request is worse than
no screenshot, because it teaches the learner that the picture is decoration.

## Reset branches, and the state each level starts from

`Training > Reset this level` resets a learner to `training/start-level-N`. Those branches are built
from the deltas in `scripts/start-states/level-N/` by `scripts/build/start-branches.mjs`, each level
applied on top of the one before.

```bash
node scripts/build/start-branches.mjs --dry-run   # what each branch would carry
node scripts/build/start-branches.mjs             # build them locally
node scripts/build/start-branches.mjs --push      # publish, from main, after a merge
```

Two rules that are easy to get wrong:

- **A start state has to pass the previous level's audit.** Prove it, do not assume it: clone the
  repository, check `integration` out at `training/start-level-N`, and run
  `node scripts/verify/check.mjs --level N-1`. That is exactly what the reset produces.
- **A teammate story merges once per level.** `scripts/simulate/<story>/` carries them, and a lab
  that simulates one an earlier lab already merged gets "Nothing to commit" and opens no Pull
  Request. If a start state ships a story pre-merged, the lab that used to simulate it has to review
  the merged Pull Request instead. Both capstones had this bug.

## Times

They are measured against real orgs and a real fork, not estimated, and the home page says so. Two
things drive them:

- **The audience already knows Salesforce.** Creating a field or ticking field level security is
  setup, not learning, and must not be budgeted as if the reader had never opened Setup.
- **CI is fast.** A Pull Request check comes back in about two minutes and a deployment in about
  two, and the reader reads the comment while they run. Do not pad for waiting.

A lab's `**Time**` line and its row in the level index must agree, and the level totals appear in
four places: each `labs/en/level-N/index.md`, `labs/en/index.md` and `README.md`.

## Claims about the product

**Read the command, not its name.** This is the single highest-yield rule in this skill: a pass that
verified every lab against the sources found six of nine Level 2 labs and eleven of eleven Level 3
labs carrying a wrong claim, six of them impossible to follow.

What that pass kept finding:

- A command doing much more than its name suggests. `hardis:work:resetselection` soft-resets every
  commit since the branch point; the lab said in bold that it does not.
- A lab promising a failure that cannot happen. A conflict needs both edits in the same region of
  the file; a permission the lab grants may already be granted.
- A panel field that does not exist. `sfdxHardisConfigHelper.ts` decides what the settings panel
  renders and at which scope, and a branch-scoped key is invisible while the scope reads Global.
- A setting taught as active that this project leaves off, `useDeltaDeployment` among them.

**Green is not proof.** Two measured examples worth keeping in the labs: a deployment reported "No
post-deployment actions defined" and went green when git refused the workspace, and SFDMU exits
`0 SUCCESS` when the target object is missing, having written nothing. Whenever a lab tells a reader
a thing happened, tell them where to look in the org.

## Before opening the Pull Request

```bash
cd ../sfdx-hardis-training
node scripts/build/universe.mjs           # regenerate, because lab front matter feeds the manifest
node scripts/build/universe.mjs --check    # generated files up to date, fiction consistent
node scripts/build/annotate.mjs            # every annotated image matches its spec
node scripts/verify/check-pills.mjs        # the pills an image carries are the ones its step cites
node scripts/verify/check-links.mjs        # every link resolves
node scripts/build/site.mjs && python -m zensical build
node scripts/verify/check-site.mjs         # every page resolves every asset
node scripts/verify/check-mobile.mjs       # the shared pages still read at 412px
```

`check-pills.mjs` and `check-mobile.mjs` exist because two classes of mistake were invisible to
everything else: a lab citing **(3)** over a two-pill image, and a five-column table rendering as
one word per column on a phone. Both passed the markdown, the links and the asset checks.

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

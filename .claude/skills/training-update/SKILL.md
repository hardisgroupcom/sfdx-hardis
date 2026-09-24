---
name: training-update
description: Perform the edits in the sibling sfdx-hardis-training repository after training-impact found an impact, or when a lab has to change for its own reasons. Covers the lab text in every locale (labs/en/ is the reference, labs/fr/ mirrors it), training-universe.json, the audit rules, the link maps, the Helios screenshot fixtures, and the screenshot rules: capture, web captures, numbered pills and verification. Use it when the user says "update the training", "fix the labs", "translate a lab", "regenerate the training screenshots", "annotate a screenshot", or when a training Pull Request has to be opened.
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
| The translated lab text                    | `labs/<locale>/level-N/lab-NN-*.md`, same file names                             | No, translated by hand from `labs/en/`          |
| The words of the generated pages           | `i18n/<locale>.json`                                                             | No, translated by hand from `i18n/en.json`      |
| The fiction: stories, branches, orgs, cast | `training-universe.json`                                                         | No, the source of truth                         |
| The backlog, the link maps, the manifest   | `BACKLOG.md`, `labs/link-map.<locale>.md`, `training-manifest.json`              | **Yes**, `scripts/build/universe.mjs`           |
| The command links of Under the hood blocks | inside each lab, between `<!-- command-links:start/end -->`                      | **Yes**, `scripts/build/lab-command-links.mjs`  |
| The site pages nobody writes               | The backlog, one page per story, the badges index, one page per badge holder     | **Yes**, `scripts/build/site.mjs`, per locale   |
| The audit rules                            | `scripts/verify/rules.mjs`                                                       | No                                              |
| The seed data                              | `scripts/data/HeliosBaseline/*.csv`                                              | **Yes**, `scripts/build/data.mjs`               |
| The screenshot fixtures                    | `../vscode-sfdx-hardis/test/fixtures/screenshot/helios/` and `training-project/` | **Yes**, `scripts/build/mocks.mjs`              |
| The lab links in the product documentation | `../sfdx-hardis/docs/*.md`, its command descriptions, both READMEs               | **Yes**, `scripts/build/doc-links.mjs`          |
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

**The site is Zensical, and it is not mkdocs-material.** It reads `course-site.yml` (named so because
`mkdocs.yml` belongs to the Helios project documentation of Lab 3.10) and honours most of
it, but it ships none of the plugins: `glightbox` is declared and Zensical emits the
`<a class="glightbox">` wrapper around every picture while shipping no viewer, so the course
carries its own (`site-theme/javascripts/lightbox.js`, a delegated listener in the **capture**
phase, because the theme cancels link clicks on the way back up for its instant navigation). Two
more things the theme gets wrong and this stylesheet corrects: the footer text is painted from the
page foreground token rather than `--md-footer-fg-color`, which in the light scheme is navy on plum
and unreadable; and `html .md-footer-meta.md-typeset a:not(:focus,:hover)` is specific enough that
a rule has to match it shape for shape to win.

Custom JavaScript runs once per **page load**, and the theme swaps pages without reloading. Anything
per-page subscribes to `document$`, the way `tables.js` does.

## Editing a lab

Every lab carries front matter that drives the manifest and the checks:

```yaml
---
id: lab-2-7
title: "Lab 2.7 - Resolve a Git merge conflict with a teammate"
description: "A teammate merged first on the same flow and permission set. Resolve both Git conflicts in VS Code without losing anybody's work."
level: 2
lab: 7
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

**Labs are numbered `N.M` from 1**, level then position: Lab 1.1 is the first lab of Level 1, and
text says "Lab 2.5", never "Level 2 lab 4". The folder is `labs/en/level-N-<name>/` and the file
`N-M-<words>.md`, which is also the URL: short, lowercase, hyphenated, words a learner would search
for. `title` is the page title and must equal the `# ` heading; `description` is the meta
description, one sentence under 160 characters that names the Salesforce and sfdx-hardis terms the
lab teaches. Both come from `training-universe.json` (`levels[].labs[]`), and inserting a lab means
renumbering the ones after it, their files, their rule ids (`N.M` in `scripts/verify/rules.mjs`)
and every "Lab N.M" in the text, **in every locale**: the file names and the numbers are the same in
all of them, so a renumbering that stops at `labs/en/` leaves the translations pointing at pages
that moved.

When you change what a lab relies on, **change `depends_on` too**. It is what makes the next impact
check work, and it is the one thing easy to forget.

House style for the lab body, in order: `The situation`, `Before you start`, `Steps`,
`What you should see`, `If it goes wrong`, `Check your work`, `Go deeper`.

`If it goes wrong` stays an ordinary `##` heading in the markdown. `scripts/build/site.mjs` folds it
into a collapsed block on the site, because it is the one section nobody reads in order. Write it as
a plain section; do not indent it by hand.

Three rules the labs are written under, and they are not negotiable:

1. **Clicks, not code.** Every action is a button in the extension. A panel exists for almost
   everything: check `src/webviews/lwc-ui/modules/s/` in the extension before writing a command
   block. A lab that reaches for a terminal when a panel would do is a defect in the lab
2. **Authenticating to an org is always Orgs Manager.** Never `sf org login web` in a lab, at any
   level, for any org
3. **Under the hood, every time.** Each significant step closes with a `<details>` block naming the
   exact command, the files it wrote, and the one decision the tool made that the learner could not
   see

## Translations, and why English comes first

The course ships in English and in French, `labs/en/` and `labs/fr/`, mirrored file for file.

**`labs/en/` is the reference. Every change starts there.** Not a convention to be polite about: it
is what keeps the two from disagreeing about what a button does. So:

- **Never fix a lab in French only.** Fix `labs/en/`, then carry the fix into every locale. A French
  page that is right while the English one is wrong is a fact nobody else can find
- **Never rename a file, an `id` or a slug in one locale.** The structure is English everywhere:
  same file names, same folders, same `id`, `level`, `lab`, `screenshots` and `depends_on`, same
  URLs. Only the prose, the `title` and the `description` are translated
- **A translation is allowed to lag.** `source_rev` in the front matter names the commit of the
  English file it was made from, and `node scripts/i18n/check-translations.mjs` lists the ones the
  source has moved past. That list is what to re-read, and CI reports it without failing
- **A translation is not allowed to lose things.** Staleness is the loud failure; a paragraph
  skipped or an "Under the hood" block never carried over is the quiet one, and nothing else shows
  it. `node scripts/i18n/check-structure.mjs` compares headings, images, code fences, `<details>`
  blocks, pill references, admonitions and tables, and says nothing about the words
- **Screenshots are shared and stay English**, and so do the button names inside a translated
  sentence: the course assumes sfdx-hardis, the extension and the learner's org are in English,
  because that is what the pictures show. Translate the prose around the label, never the label
- **The generated pages are translated in `i18n/<locale>.json`, not in markdown.** The backlog, the
  page of each User Story, the badges index and the badge pages are built from
  `training-universe.json` and the badge records, once per locale, so there is no file to copy for
  them. That file holds their words, and under `universe` the translation of what
  `training-universe.json` writes in English: the pitch, the level names, the roles of the cast,
  and the title, story and acceptance criteria of every story. A string it leaves out reads in
  English rather than leaving a hole

The order when a change touches a lab:

```bash
# 1. English first, and commit it, because the stamp reads git
$EDITOR labs/en/level-2-contributor-advanced/2-3-*.md
git add labs/en && git commit -m "..."

# 2. the same edit in each other locale
$EDITOR labs/fr/level-2-contributor-advanced/2-3-*.md

# 3. the three generators that are locale aware
node scripts/build/lab-crossrefs.mjs        # "Lab 2.7, étape 3" becomes a link, per locale
node scripts/build/lab-command-links.mjs   # each sf hardis command an Under the hood block names, linked
node scripts/i18n/align-tables.mjs          # MD060: a translated cell moves every pipe under it
node scripts/i18n/stamp-source-rev.mjs fr   # write source_rev from the commit of step 1

# 4. what always runs
node scripts/build/universe.mjs
```

`stamp-source-rev.mjs` reads the last commit that touched the English file, so **running it before
committing the English change stamps the version before yours** and quietly claims the translation
is current. Commit first.

**Adding a locale** is additive, and `TRANSLATION.md` in the training repository is the procedure.
Three things worth knowing from here:

- three scripts carry a word per locale that has to be declared, or the locale silently loses a
  feature: `TROUBLESHOOTING` in `scripts/build/site.mjs` (the translated "If it goes wrong"
  heading, which is what folds that section), `LOCALES` in `scripts/build/lab-crossrefs.mjs` (the
  word for "step"), and `NAV_LABELS` plus `LOCALE_NAMES` in `scripts/build/universe.mjs`;
- `i18n/<locale>.json` is the whole of the generated pages, and the locale also goes in the `nav`
  and in `extra.languages` of `course-site.yml`, which carries its home page and its flag. That key
  is deliberately not called `alternate`: under that name the theme reads each entry as the root of
  a separate site, asks it for a `sitemap.xml` it does not have, and takes the language click over;
- the theme speaks the language of the page, from the dictionary Zensical ships for it, so a locale
  it has none for fails the build in `site-overrides/partials/language.html`.

`node scripts/verify/check-nav.mjs` and `node scripts/verify/check-language-switch.mjs` on the
built site are what say the new locale holds together: one language per menu, every picker landing
on the same page in the other language and pointing back, and the choice remembered in a cookie.

## The lab links in the product documentation

Every command and guide a lab teaches carries a **Learn by doing** block that links that lab, in
`../sfdx-hardis` and in the extension's README. It is generated, between
`<!-- training-links:start -->` and `<!-- training-links:end -->`, from the `depends_on` front
matter of the labs by way of `training-manifest.json`:

```bash
node scripts/build/universe.mjs     # first: the manifest is what the links are read from
node scripts/build/doc-links.mjs    # then: writes the blocks into the sibling clones
node scripts/build/doc-links.mjs --check   # writes nothing, fails when a page is out of date
```

So **changing a lab's `depends_on` changes the product documentation**, and the three repositories
are committed together. Never edit a block by hand; move one if it sits in the wrong place, and the
next run rewrites it where you put it.

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
fork, four orgs and their secrets by hand took an afternoon, so `Training > Set up my training environment`
does it.

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

It installs the tools and nothing else: Git, VS Code, Node, the extension pack, and the Setup panel
installing the Salesforce CLI. Somebody joining a real project can do that lab and stop, and the lab
says so. Everything training-specific, the two free orgs, the clone, the pipeline, the seeded data,
belongs to lab 1.

Two lines to keep where they are:

- a tool that belongs on **every** Salesforce workstation goes in lab 0, anything that only makes
  sense for Helios goes in lab 1
- lab 0 is **agnostic about the git provider**. sfdx-hardis treats GitHub, GitLab, Azure DevOps and
  Bitbucket alike, so nothing provider-specific belongs there, not even a GitHub account in the
  checklist. The GitHub CLI lives in lab 1, in the step that uses it, because this project happens
  to live on GitHub and no part of the product needs it

## Screenshots

The audience has no Salesforce background and no git background. A step it cannot see is a step it
cannot do. The rules below are hard rules, not preferences.

### What a lab must show

0. **Every operation in vscode-sfdx-hardis has a screenshot.** A hard rule from the author. Where a
   lab repeats an operation the same lab already showed, the picture is not repeated; where a level
   or a lab meets it for the first time, it is
1. **Every step that tells a learner to click something shows it.** A step that names a button, a
   panel, a tab or a field and carries no screenshot of that screen is not finished. "Click New
   User Story in the DevOps Pipeline panel" needs a picture with that button marked
2. **Screenshots carry numbered pills, and the step text references the numbers.** That is what
   stops the prose and the picture drifting apart. Pills are drawn by
   `node scripts/build/annotate.mjs` from `labs/_assets/annotations.json` into
   `labs/_assets/annotated/`, and labs reference the annotated copy, never the raw one
3. **`labs/_assets/annotated/` is generated.** Never retouch an image there by hand: change the
   spec and re-run the generator
3bis. **A pill reference in the text is painted in the colour of its pill.** `scripts/build/site.mjs`
   turns `**(2)**`, and a `(2)` inside a bold run such as `**Save (3)**`, into a coloured span, and
   generates the stylesheet from the palette `annotate.mjs` draws the pills with, so the two cannot
   drift. Write the plain markdown and never a colour, an emoji or a styled span by hand; a number
   in ordinary, non-bold prose is left alone on purpose
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

**Use `scripts/build/shots.mjs` rather than calling the harness by hand.** It takes image names or
labs, finds the gate behind each image in `labs/_assets/vscode/.shot-gates.json` (the harness
writes that map at every capture) or in `labs/_assets/vscode-captures.json` (images taken under
another pipeline state or copied under another name), runs the harness once per state into a temp
folder, copies back only the images asked for, redraws their pills and builds one sheet to look at:

```bash
node scripts/build/shots.mjs vscode/work-new-org web/github-pr-comment
node scripts/build/shots.mjs --lab 2.7            # every image Lab 2.7 shows
node scripts/build/shots.mjs --lab 2.7 --pills    # no capture: pills and sheet only
node scripts/build/shots.mjs --all --kind vscode  # every VS Code image of the course
node scripts/build/shots.mjs --lab 3.1 --dry-run  # what it would take
```

A workbench menu (the **...** of a view, a context menu) cannot be captured: activating the window
for the capture closes it. Webview menus, quick picks and the Command Palette can.

Pass only the names you need: the full batch takes about twenty-five minutes, and with no names at
all it also records the GIFs, which writes `recordings/` and `*-for-recording.png` into the output
folder. Those do not belong in the training assets: delete them, or always pass names.

**A name in that list is the name the test is gated on, not the name of the file it writes.** Most
tests gate on the shot they take, but the ones that take a group gate on the group:
`sidebar-commands` writes eight `sidebar-commands-*.png`, and `work-new`, `work-save`,
`command-runner`, `pipeline-modals`, `pipeline-action-editors`, `user-activateinvalid` and
`backpromote` behave the same way. Listing the file names of a group silently skips it: the run is
green and the images are the old ones. `grep -n "shouldTake(" src/test/ui/docScreenshots.test.ts`
lists every gate.

**A command panel in a lab shows the command the lab runs, never a stand-in.** `command-runner`
replays `hardis:org:mock-showcase`, a demo of the panel itself: it is fine for the product docs and
wrong for a lab, where the reader compares the questions with the ones they get. When a lab needs a
command that has no scenario yet, add one to `DOCS_SCENARIOS` in `test/fixtures/sf-shim/sf-mock.js`
with the real prompts, log lines and report files (read the command source and `src/i18n/en.json`
here), take its answers from the universe `scenario` key written by `mocks.mjs`, and a gated test in
`docScreenshots.test.ts`. `configure-auth` (Lab 3.2) is the example. Every question needs a `log`
line after it, or the panel shows no answer chip on that row.

**The side bar is in every VS Code capture**, so a change to what a project declares in
`customCommands` invalidates all of them, not only the menu shots. The training declares one menu
per level (`Training: Level 1`, `2`, `3`), which is three rows instead of one.

**`SFDX_HARDIS_DOC_SCREENSHOTS_DIR` must be an absolute path.** A relative one resolves against the
Extension Development Host's own working directory, and the captures land somewhere nobody finds.

**Three pipeline states, through `SF_MOCK_PIPELINE_STATE`.** The committed fixture is the pipeline
as Levels 1 and 2 have it, and the other two are built from it at launch:

| Value                | What it gives                                                                    | Used for                                      |
|----------------------|----------------------------------------------------------------------------------|-----------------------------------------------|
| unset                | integration and uat, with the feature branches and open Pull Requests            | Level 2 and Level 3 labs                      |
| `fresh`              | no feature branches, no Pull Requests, no jobs                                   | Level 1: what a learner's own fork looks like |
| `fresh-disconnected` | the same, with the git provider inactive: grey icon, no toggle, no Pull Requests | Level 1 lab 1, the step that connects GitHub  |
| `level3`             | uat, preprod and main configured, each merging into the next                     | Level 3: the finished four stage pipeline     |

They capture under the usual shot names, so take them into a temp folder and copy the file in under
the name the lab uses (`devops-pipeline-fresh.png`, `pipeline-branch-modal-level3.png`...).

**`branchNode` in `universe.json`** is where the major branch box sits in the diagram, for the click
that opens its window. Mermaid lays it out from the branches the fixture carries, so it moves
whenever they change, and a stale value clicks empty canvas and captures a pipeline with no window.
`scripts/build/mocks.mjs` writes it. It is the default state's point: the `level3` state lays the diagram out
differently, so pass `SFDX_HARDIS_DOC_SCREENSHOTS_BRANCH_NODE=x,y` for that run, read off its
`devops-pipeline.png`. The branch window without a merge target is taken the same way, on `uat`.
`retrieverRows` in the same file is the heights of the three rows the Metadata Retriever capture ticks,
and it moves whenever `sourceMembers` changes.

**After any capture, re-pin by looking.** A panel that gained a toggle, a Welcome strip or two menu rows
moves every box below it, and `annotate.mjs` still draws the old spec without complaint. Render the
annotated images four to a sheet with a headless Chrome of your own and check each pill against its
step text. Run one harness batch at a time: two VS Code instances on this machine run out of memory.

**Never take the Extensions view.** That VS Code has no marketplace access, so it renders "Error
while fetching extensions", and the view stays open for every capture that follows. The training
uses a screenshot taken on a real machine, `labs/_assets/vscode/extensions-install.png`, which
nothing in the harness may overwrite.

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
yarn screenshots                      # writes doc-screenshots/, the MyCompany-CRM universe
python scripts/build-doc-images.py    # crops them into ../sfdx-hardis/docs/assets/images
cd ../sfdx-hardis
git status --porcelain docs/assets/images
```

Empty output, or the training work broke the product images.

`doc-screenshots/` itself is git-ignored and holds no tracked file, so checking it with `git status`
proves nothing: a run that changed every capture still reads as clean there. The tracked copies are
the cropped images in the sfdx-hardis documentation, and those are what to look at.

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
node scripts/build/start-branches.mjs --push      # publish, from main: what CI does on every push to main
```

Publishing is CI's job: `.github/workflows/start-branches.yml` runs `--push` on every push to
`main` of the shared repository. Push by hand only when that run failed, and from `main`, after
checking the run is not still going: two pushes of the same branches race on `--force-with-lease`.

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
four places per locale: each `labs/<locale>/level-N/index.md`, `labs/<locale>/index.md`, plus
`README.md` once. A time changed in English and not in French is the easiest translation drift to
create and the hardest to notice, because nothing compares numbers across locales.

## The contributor loop the course teaches

**The Metadata Retriever comes before `hardis:work:save`, always.** That is the product's own
workflow (the contribution cards read New User Story, then Commit changes, then Save / Publish) and
it is the only one that works on this course's orgs:

- `hardis:work:save` has exactly three prompts: *Have you already committed?*, a data export
  question that needs `./scripts/data/EmailTemplate` and so never fires here, and *push?*. **There
  is no screen where a learner picks components.** Any lab that describes one is wrong
- answering *No, please pull my latest updates* runs `sf project retrieve start`, which needs
  **source tracking**. `helios-dev` is a scratch org and has it, but the course still never uses that
  answer: the Metadata Retriever is the one route that also works on a sandbox or a Developer Edition
- "the selection" that `hardis:work:resetselection` resets is **the commits**, not a stored list.
  It does a soft reset, restores `manifest/`, and sets `canForcePush`

So a lab that changes an org reads: retrieve with the Metadata Retriever, commit from Source
Control, then Save / Publish and answer *Yes, my commit(s) are ready*.

**`hardis:work:new` in this course answers Scratch org, then Reuse scratch org helios-dev.** The list
leaves out the scratch orgs `config/branches/` names, and never *Create new scratch org*: the Dev Hub
keeps three alive and all three are taken. With a sandbox, the command only asks whether to initialize
it when the project sets `offerSandboxInit: true` (this one does not), and that answer does not bring
metadata down. It installs packages, assigns permission sets and runs the init scripts. The command itself
prints that a backpromote is what brings the merged metadata. A lab that says "say yes and you will
have the team's work" is wrong.

**Staging is the decision, not the picker.** `hardis:work:save` commits nothing by itself: the
learner stages the retrieved files one at a time in the Source Control panel, with the **+** on each
row. Level 1 lab 4 teaches that and forbids **Stage All Changes**, because the panel routinely shows
files nobody asked for.

**The target branch question offers `availableTargetBranches`, and the mock reads that same file.**
`scripts/build/mocks.mjs` builds the choices from `config/.sfdx-hardis.yml`, so a screenshot can
never offer a branch the project refuses. Levels 1 and 2 pin it to `integration` alone; Level 3
lab 0 adds `preprod`, where hotfixes start. A one-item list is correct, and the lab says why.

**One signup, then scratch orgs.** A learner signs up for one Developer Edition org, `helios-prod`
(an Org Farm org, `orgfarm-<10 hex>-dev-ed.develop.my.salesforce.com`), and `Set up my training
environment` (`scripts/training/init.mjs`) makes it a Dev Hub and creates three scratch orgs from it:
`helios-dev` to build in, `helios-integration` and `helios-uat` for the two stages of Levels 1 and 2.
Level 3 lab 0 adds a second signup, `helios-preprod`, and makes `helios-prod` the `main` org. The
universe carries `kind` and `branchFrom` per org, and the fixtures use both host shapes on purpose.

- **A Developer Edition Dev Hub keeps 3 active scratch orgs and creates 6 a day.** Rehearse init
  against a spare Org Farm org with throwaway aliases (import `ensureDevHub`, `ensureScratchOrgs`,
  `seedScratchOrgs` from `init.mjs`), never against the maintainer's own `helios-*` aliases, and
  never create scratch orgs in a loop.
- The Dev Hub switch in metadata is `DevHubSettings.enableScratchOrgManagementPref`, not
  `enableDevHub`, which the Metadata API refuses.
- A scratch org records the seeding deployment as source changes, so Recent Changes lists the whole
  app. Level 1 lab 4 sorts on **Last Updated Date**, and init renames the scratch org user after the
  Dev Hub owner so the rows do not all read "User User".
- Scratch orgs expire after 30 days. Init rebuilds only the missing ones and rewrites their branch
  files and secrets, which is why every level's Training menu carries it.

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
node scripts/build/lab-crossrefs.mjs       # first: link every mention of another lab, per locale
node scripts/i18n/align-tables.mjs         # a translated cell moves every pipe under it
node scripts/i18n/stamp-source-rev.mjs     # after the English commit, never before
node scripts/build/universe.mjs           # regenerate, because lab front matter feeds the manifest
node scripts/build/universe.mjs --check    # generated files up to date, fiction consistent
node scripts/build/annotate.mjs            # every annotated image matches its spec
node scripts/verify/check-pills.mjs        # the pills an image carries are the ones its step cites
node scripts/i18n/check-translations.mjs   # which translations the English source has moved past
node scripts/i18n/check-structure.mjs      # which translations lost an image or a block. Reports, never fails
node scripts/verify/check-links.mjs        # every link resolves
node scripts/build/site.mjs && python -m zensical build -f course-site.yml
node scripts/verify/check-site.mjs         # every page resolves every asset
node scripts/verify/check-mobile.mjs       # the shared pages still read at 412px, in every locale
```

`check-pills.mjs` and `check-mobile.mjs` exist because two classes of mistake were invisible to
everything else: a lab citing **(3)** over a two-pill image, and a five-column table rendering as
one word per column on a phone. Both passed the markdown, the links and the asset checks.
`check-pills.mjs` reads every locale for the same reason: a translator who drops a **(3)** breaks
the tie between the sentence and the picture, and nothing else would say so.

**Anchors into another lab are per locale.** `lab-crossrefs.mjs` builds them from the step headings
of the locale it is linking within, folding accents to ASCII the way python-markdown does, so
"3. Prendre les vôtres" becomes `#3-prendre-les-votres`. Change that fold and every French anchor
misses by one letter, with nothing failing: `check-site.mjs` checks that pages exist, not that
anchors resolve.

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
- [[training-e2e]] walks the labs for real, against a live fork and live orgs, and is where most of these edits come from

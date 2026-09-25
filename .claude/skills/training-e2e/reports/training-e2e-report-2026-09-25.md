# Training end to end run, 2026-09-25

Sixth run of the `training-e2e` skill, and the first to walk **all three levels, all 27 labs, in
one go**, from a brand new fork and brand new scratch orgs. **The three badges were claimed and
awarded** (issues #42, #44, #45 of the course), and the badge pages in English and French show the
three hexagons.

The run produced **32 findings** (F1 to F32) and 9 observations. The ones worth reading first:

- **F30 (release, blocker)**: **Lab 3.10 cannot be finished today.** The promotion check runs the
  released image (8.10.0), which names the two Lab 2.7 teaching files as conflict markers;
  branch protection forbids merging red. `promotionConflictMarkersIgnoredFiles` is only in
  8.10.1-beta. **Releasing 8.10.1 unblocks it.** The rest of the lab was walked on the beta image.
- **F5 (course, fixed)**: on a brand new fork GitHub runs no workflow until someone clicks the
  Actions banner, and `init` read the empty list as "Actions on". The learner's first Pull Request
  would have had no checks at all. `init` now opens the page and waits for the click.
- **F17 (CLI, fixed)**: backpromote failed with a 404 in every fork: the `(#41)` of the upstream
  course's squash subjects was read as a Pull Request of the fork. Regression of #2236, unreleased.
- **F20 (extension, fixed)**: the Edit Deployment Action dialog writes YAML that Prettier rewrites,
  MegaLinter pushes a fix commit onto the Pull Request, and the Pull Request is blocked. Every
  learner hits it in Lab 2.3, and so does every sfdx-hardis project running MegaLinter.
- **F32 (course, fixed)**: `Claim my badge` refused Level 3 for every learner coming from Level 2,
  because `Simulate my teammates` left an unpushed branch behind when it had nothing to commit.
- **F26 and F27 (CLI, fixed)**: the release notes of a first promotion said "No metadata changes
  detected", and a deployment action ticked in `integration` showed as done in the `uat` notes.

## Versions under test

| Thing              | Version                                                                              |
|--------------------|--------------------------------------------------------------------------------------|
| sfdx-hardis        | 8.10.0, linked working copy, `fix/training-e2e-2026-09-25` at `0ae61e35d` (PR #2239) |
| vscode-sfdx-hardis | 8.8.0, `fix/yaml-prettier-quotes` at `c4673c6b` (PR #528)                            |
| Course             | `fix/training-e2e-2026-09-25` at `0733228` (PR #43), started from `main`             |
| CI images          | `sfdx-hardis-ubuntu:latest` (8.10.0), then `:beta` for Lab 3.10 only (see F30)       |
| Salesforce CLI     | @salesforce/cli 2.151.6, node 24.11.1                                                |
| VS Code (driver)   | 1.139.0                                                                              |
| Published site     | level with course `main` at the start                                                |

## Environment

| Item             | State                                                                                          |
|------------------|------------------------------------------------------------------------------------------------|
| `helios-prod`    | Developer Edition, Dev Hub, production in the fiction                                          |
| `helios-preprod` | Developer Edition                                                                              |
| Scratch orgs     | `helios-dev`, `helios-integration`, `helios-uat`, **created fresh by `init`** in this run      |
| Fork             | `nvuillam/sfdx-hardis-training`, **deleted and forked again by `init`**: a true brand new fork |
| Monitoring repo  | `nvuillam/sfdx-hardis-training-monitoring-0925`, new; the old one of earlier runs was kept     |
| Learner clone    | `C:/git/training-run`                                                                          |
| Browser on CDP   | the user's Chrome on 9222, signed in to GitHub and to the orgs by the user                     |

The Developer Edition orgs carried leftovers of earlier runs (fields, the Awaiting Parts value,
External Client Apps, a scheduled job). They were removed before Level 3, except
`Handover_Item__c.Mandatory__c`, which old flow versions still reference and Salesforce refuses to
delete. It had no effect on any lab.

## The cheap checks

| Check                        | Result                                                             |
|------------------------------|--------------------------------------------------------------------|
| `build/universe.mjs --check` | 27 lab files, consistent                                           |
| `verify/check-commands.mjs`  | 14 commands the labs rely on, all exist                            |
| `verify/check-links.mjs`     | every link resolves (cloudity.com times out on bot protection, O2) |
| `verify/check-pills.mjs`     | 296 image references against 126 annotated images, all consistent  |
| `i18n/check-i18n.mjs`        | every locale answers every key (a stale `source_rev`, F1)          |
| `i18n/check-structure.mjs`   | 32 pairs, 1 difference already there before the run (`index.md`)   |
| MegaLinter on the course PR  | markdownlint clean after the F13 fix                               |

## Lab by lab

Fidelity: **1** lab driver (`yarn test:ui:labs`), **2** headless panel (`panel.mjs`, `auth.mjs`,
`mon.mjs`), **3** direct `sf` / `git` / `gh`. **Browser** means the real Salesforce Setup or GitHub
page, clicked over CDP. Pass A read, B do, C look at the images.

| Lab  | Fidelity                                                | A  | B  | C       | Findings               |
|------|---------------------------------------------------------|----|----|---------|------------------------|
| 1.1  | read only, as every run                                 | ok | -  | ok      | F13, O1                |
| 1.2  | `init` for real, Actions click in the browser           | ok | ok | stale   | F5, F6, F7, F8, F9, O4 |
| 1.3  | 1                                                       | ok | ok | stale   | F2                     |
| 1.4  | browser (Setup, permission set, record page)            | ok | ok | ok      | F10                    |
| 1.5  | 1                                                       | ok | ok | stale   | F2, F4, F11, F12       |
| 1.6  | 3 (`prflow.sh`), merge box in the browser               | ok | ok | ok      | F13, O5                |
| 1.7  | `claim.mjs`, form in the browser                        | ok | ok | ok      | F14, F15               |
| 2.1  | 2 (backpromote plan and run)                            | ok | ok | stale   | F16, F17, O6, O7       |
| 2.2  | browser (field), 3 (flow XML), 2 (retriever)            | ok | ok | ok      | F18, F19               |
| 2.3  | browser (Required), 3 (action file for the dialog)      | ok | ok | stale   | F20, F21               |
| 2.4  | 2 (export), 3 (org build, workspace file, action files) | ok | ok | ok      | O8                     |
| 2.5  | 3, tests through the headless panel                     | ok | ok | ok      | F22                    |
| 2.6  | browser (FLS), 2 (retrieve, clean)                      | ok | ok | ok      |                        |
| 2.7  | 3 (Flow Builder as XML), browser (grant), simulate      | ok | ok | ok      | F23                    |
| 2.8  | 3 (layout XML), 2 (retrieve, reset selection)           | ok | ok | ok      | F24                    |
| 2.9  | 2 and 3, claim                                          | ok | ok | ok      |                        |
| 3.1  | browser (New branch), 2 (`auth.mjs` x4), 3 (protection) | ok | ok | sampled |                        |
| 3.2  | simulate, review via the API (3), squash                | ok | ok | sampled |                        |
| 3.3  | job log read                                            | ok | ok | sampled |                        |
| 3.4  | simulate, merge order                                   | ok | ok | sampled | F32                    |
| 3.5  | browser (remote site), 3 (no-overwrite file), 2 (notes) | ok | ok | sampled | F25, F26, F27          |
| 3.6  | 3 (promotions), 2 (DORA)                                | ok | ok | sampled |                        |
| 3.7  | simulate, 3                                             | ok | ok | sampled | F28, O9                |
| 3.8  | 2 (`mon.mjs`), 3 (workflow run)                         | ok | ok | stale   | F29, step 7 not done   |
| 3.9  | 2                                                       | ok | ok | sampled |                        |
| 3.10 | simulate x5, 2 (`promotion:create`), 3, **beta image**  | ok | ok | sampled | F30                    |
| 3.11 | 3, 2 (release notes, DORA)                              | ok | ok | sampled | F31                    |

Every level ended on its own `Check my work` green: Level 1 6 of 6, Level 2 9 of 9, Level 3
11 of 11. The Level 3 audit verified 24 checks.

## Findings

Full notes in the run's findings file. Fixed means fixed in this run, and the step was done again.

### sfdx-hardis, PR [#2239](https://github.com/hardisgroupcom/sfdx-hardis/pull/2239)

- **F17 (high)**: backpromote in a fork read the numbers in upstream squash subjects as Pull
  Requests of the fork and failed with a 404 when it commented. The provider's merge commit now
  wins; a number from a message counts only when the provider lists it and the commit is its merge
  commit or a cherry-pick of it. Unit tests; proven on `helios-dev` (7 items, comments on #1-#3).
- **F26**: release notes in post mode, on the first promotion into a branch, started the range at a
  previous merge that does not exist and printed "No metadata changes detected". Falls back to the
  merge's first parent. Proven: 33 files, as the lab says.
- **F27**: release notes took a deployment action's best status across all orgs. The target
  branch's status wins now. Proven: `manual` in the `uat` notes, as the lab says.

### vscode-sfdx-hardis, PR [#528](https://github.com/hardisgroupcom/vscode-sfdx-hardis/pull/528)

- **F20 (high)**: repository YAML written with js-yaml defaults (`command: ''`) was rewritten by
  MegaLinter's Prettier, whose fix commit then blocked the Pull Request. Every repository YAML
  writer now goes through `dumpRepositoryYaml` (double quotes, no folding). 558 tests pass.

### Course, PR [#43](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/43)

- **F1**: French `source_rev` stamps one commit behind. Restamped.
- **F4, F10, F12, F13, F14, F18, F19, F22, F23, F24, F25, F28, F31**: lab text that did not match
  what the product or the org does (1.4 Details tab, 1.5 branch before its PR and "about thirty",
  1.6 "found nothing", 1.7 Submit, 2.2 layout and description, 2.5 no findings, 2.7 commit before
  the merge, 2.8 "thousands of lines", 3.5 no planned installation, 3.7 merge instead of squash,
  3.11 ten checks). All fixed in English and French.
- **F5, F6, F7, F8**: `init` and the 1.2 rule accepted a fork whose workflows never ran; the
  link-check schedule ran on every fork; a Node warning under Check my work. Fixed.
- **F32**: `simulate` left an unpushed branch. Fixed and proven.
- Lab 1.6 now says what to do when MegaLinter pushes a fix commit onto the branch (F20's symptom
  for the learners on the released extension).

### Shared repository housekeeping

- **F3**: five stale squash-merged branches in the shared repository, copied into every fork.
  Deleted, and `delete_branch_on_merge` turned on.
- **F15**: an old claim of a real learner left open after their second claim succeeded. Closed with
  a pointer.

### Release

- **F30 (blocker)**: release 8.10.1. Until then no learner can merge Lab 3.10's promotion.

### Screenshots

Recaptured with the harness after the walk (course PR #43; the harness change is in extension
PR #528):

- **F2 (fixed)**: the Level 1 pipeline pictures are taken on a fresh pipeline, on the learner's
  `features/US-014-panels-required` branch with no Pull Request (new `pipeline-cards-level1`
  variant; `pipeline-packages-menu` moved to that state, since only Lab 1.5 shows it).
- **F9 (fixed for Levels 2 and 3)**: the Level 2 and 3 menus and the Level 2 side bar menu show
  **Update my course**. Lab 1.2's `training-menu-authorization` was taken by hand (the harness
  cannot capture the authorization prompt) and still shows 5 Level 1 cards.
- **F11 (fixed)**: the Lab 1.5 commit picture has no dialog over it.
- **O4 (fixed)**: the Lab 1.2 org picture shows `integration` in the status bar.
- **F16, F21 (not fixed)**: the backpromote list and the actions list come from the extension's
  git provider fixture (#51-#53, nine actions). A recapture cannot change them; the fixture has to.
- **F29 (not fixed)**: Lab 3.8's first report picture needs a workspace that is a monitoring
  repository, which the harness has no state for.

### Observations

- **O1**: Lab 1.1's first-open picture already shows a cloned project.
- **O2**: `check-links` times out on cloudity.com (403 to bots), not a dead link.
- **O3**: 5 annotated images no lab uses.
- **O4**: Lab 1.2 pictures show a Level 2 branch in the status bar; two pills sit off their boxes.
- **O5**: Lab 1.6 comment counts 36/7 against the lab's 34/5, within its "may differ".
- **O6**: the backpromote list shows the course's 33 history commits as numberless rows.
- **O7**: `backpromote --reset` leaves the clone on a detached HEAD.
- **O8**: Lab 2.4's Data Workbench picture already lists the workspace the learner is about to make.
- **O9**: US-045's title is the symptom, and that is what the release notes carry next to the fix.
- The workflows the sfdx-hardis project template ships (`check-deploy.yml`, `process-deploy.yml`...)
  give the GitHub Actions auditor of MegaLinter (zizmor) about 70 findings, mostly unpinned actions
  and images. It only warns, so no Pull Request is blocked, but the learner sees a ⚠️ on their first
  MegaLinter comment. Lab 1.6 now says why. Pinning them is a template decision, left open.

## Code review of the three Pull Requests

`code-review` at `high` ran on each Pull Request. Fixed in the same Pull Requests:

- **CLI**: a failed or empty listing of merged Pull Requests no longer drops every number read in
  a message; numbers a truncated listing misses are asked for one by one; a fork Pull Request
  merged outside the window needs its title in the message; the vehicle merge detection uses the
  same filter; an action with no entry in the notes' org reads as pending, and one only skipped
  there is left out; the first release tag gets a range. Also, the CLI writes deployment actions and
  custom functions with the same Prettier-compatible YAML as the extension.
- **Extension**: strings with double quotes and multi-line strings with trailing spaces now match
  Prettier, the presets block uses the helper, and 7 tests cover the cases.
- **Course**: a failed read no longer ends the Actions wait as a success; the wait is for the
  banner only, with `--no-actions-wait`; rule 1.2 checks the live Actions state in Check my work
  only, not in the badge audit; `sync-check.yml` no longer runs monthly on forks; Lab 1.6's remedy
  for the robot commit is Pull then **Trigger my workflows**, because **Re-run all jobs** replays
  the old commit when GitHub never started a run on the robot's one.

Not changed, with the reason:

- The two fallbacks of the release notes that return an empty range (no source branch, delta
  failure) stay empty: no range can be computed there, and pretending one would be worse.
- The helper assumes Prettier's default quotes: neither the project template nor the course ships
  a `.prettierrc` with `singleQuote`.

## Deviations from what a learner does

- **Lab 3.10 ran on `sfdx-hardis-ubuntu:beta`**, through a fork-only commit (`E2E ONLY`) on the
  fork's `preprod`, `main` and `integration`. The beta image was checked to be pushed after the beta
  npm publish. The released image's four-file marker comment is on record (F30). The commit is a
  fork artifact and disappears with the next fork reset.
- A chained branch delete after a refused merge closed PR #5 in Lab 2.3; the branch was restored
  and the Pull Request reopened.
- I ran `backpromote --reset` in Lab 2.1 where the panel's Back button only checks out (O7).
- The first DORA report of Lab 3.11 ran on `helios-dev`, because `work:new` of the retrofit had
  reset the default org and I skipped the lab's "set helios-prod first". Re-run on `helios-prod`.
  The lab was right.
- In Lab 2.7, Mariia was simulated from `integration` after I switched branch.
- The Level 3 claim was opened with `gh issue create`, with the form's exact body and its
  `badge-claim` label, because the CDP attach hung. The user's Chrome was not restarted.

## What this run did not cover

- **The webview DOM was not clicked.** The lab driver ran Labs 1.3 and 1.5; every other panel step
  went through `panel.mjs`, which answers the question the command asks, not the one the panel
  renders.
- **Dialogs done at fidelity 3 that a learner clicks**: Flow Builder (2.2, 2.7), the Edit Deployment
  Action dialog (2.3, 2.4), the package viewer (3.5), the VS Code merge editor (2.7, 3.10), Create
  Workspace (2.4), the Run workflow button (3.8), the review UI of GitHub (3.2).
- **Lab 3.8 step 7** (a notification channel): no Slack, Teams or email webhook here.
- **Lab 1.1** was read, not performed.
- **French** was not walked. It was restamped and checked for structure only.
- **Pass C on Level 3 was sampled**, not every image opened.
- **Screenshots**: F16, F21, F29 and the Lab 1.2 authorization picture are still stale (see
  above).
- **An agent is not a beginner.** Prose clarity was not really tested.

# Training end to end run, 2026-09-21

First run of the `training-e2e` skill, and the first to use the **lab driver** (the real VS Code
panels over the real CLI) that was built the same day.

## Versions under test

| Thing                  | Version                                                                             |
|------------------------|-------------------------------------------------------------------------------------|
| sfdx-hardis            | 8.9.0, linked working copy (`sf plugins` shows `link`), branch `feat/training-e2e-skill` |
| vscode-sfdx-hardis     | 8.7.0, branch `feat/lab-driver`                                                      |
| Course                 | branch `feat/lab-driver-specs`, on top of `c50ebb9`                                  |
| Salesforce CLI         | @salesforce/cli 2.151.6, node 24.11.1                                                |
| Published site         | live, and **behind the working copy**: the fixes below are not on `main` yet         |

## Environment

| Item              | State                                                                          |
|-------------------|--------------------------------------------------------------------------------|
| `helios-prod`     | Developer Edition, Dev Hub, `orgfarm-c77e7e1127`, 6/6 daily scratch orgs, ~14.9k/15k API |
| `helios-preprod`  | Developer Edition, Dev Hub, `orgfarm-bedd5b7a5a`, 6/6 daily scratch orgs                 |
| Scratch orgs      | `helios-dev`, `helios-integration`, `helios-uat`, all Active                     |
| Fork              | `nvuillam/sfdx-hardis-training`, **reset** to a brand new fork state before the run |
| Learner clone     | `C:/git/training-run2`, cloned from the shared repository, as a learner does     |
| Browser on CDP    | **absent**: nothing was signed in on port 9222                                   |

The fork reset worked (main plus the three `training/start-level-*` branches, no secrets, no open
Pull Requests). The clone had to move to `training-run2`: a VS Code window still held
`C:/git/training-run`, and `rm -rf` refused it.

## The cheap checks, all green

| Check                      | Result                                              |
|----------------------------|-----------------------------------------------------|
| `check-commands.mjs`       | 13 commands the labs rely on, all exist              |
| `check-links.mjs`          | 55 external URLs, every one resolves                 |
| `check-pills.mjs`          | 274 image references against 117 annotated images    |
| `check-site.mjs`           | 86 pages, 1057 assets, 6691 internal links           |
| `i18n/check-structure.mjs` | 30 compared, 1 pre-existing difference in `index.md` |

## What was walked

Fidelity 1 is the lab driver (real panel, real CLI, real org). Fidelity 2 is the headless panel.
Fidelity 3 is `sf`/`git`/`gh` directly.

| Lab | Read (A) | Done (B)                 | Images (C) | Verdict                                                 |
|-----|----------|--------------------------|------------|---------------------------------------------------------|
| 1.1 | yes      | not applicable           | yes        | Pass, one cosmetic finding (4)                          |
| 1.2 | yes      | fidelity 1, **partial**  | partly     | Ran correctly as far as it got, see below               |
| 1.3 | yes      | **not covered**          | yes        | One real finding in the text (1), fixed                 |
| 1.4 | yes      | **not covered**          | partly     | Blocked: the whole lab is Salesforce Setup in a browser |
| 1.5 | yes      | **not covered**          | yes        | Blocked downstream of 1.4                               |
| 1.6 | yes      | **not covered**          | yes        | Blocked downstream, and it is GitHub web                |
| 1.7 | yes      | **not covered**          | n/a        | Blocked downstream of 1.4                               |

### Lab 1.2, what the driver actually proved

The card was clicked through the real panel, against the real CLI and the real Dev Hub, and it did
the right things in the right order. Verified from outside the run, not from its log:

| Step of the lab                                | Observed                                                       |
|------------------------------------------------|----------------------------------------------------------------|
| Fork, and origin becomes the fork              | `origin` is now `nvuillam/...`, `upstream` the shared repository |
| The confirmation the lab documents             | `Build your training environment from helios-prod?`, answered yes |
| `integration` and `uat` created in the fork    | both present                                                    |
| Branch to org mapping committed                | `config/branches/.sfdx-hardis.integration.yml` on `integration`  |
| Three scratch orgs created                     | `helios-dev`, `helios-integration`, `helios-uat`, all Active     |
| The Helios app deployed into them              | `Installation__c` queryable in all three                         |
| The sample data imported                       | 30 rows in `helios-dev`; the other two still at 0 when time ran out |
| CI secrets, branch protection                  | **not reached** in the window                                    |

So the lab works, and it is **slower than it says**: see finding 5.

## Findings

### 1. Lab 1.3 said a question has two answers; it has three (course, fixed)

Step 2 read "the first real question already waits, with its two answers **(2)** and **(3)**", and
step 3 described Feature and Fix and stopped. The panel offers a third, **Retrofit: merge production
back down into the pipeline after a hotfix (release manager)**, and the course's own
`branchPrefixChoices` declares all three. The screenshot shows all three too, so a learner counts
three options while the text says two and never names the third.

Fixed in `labs/en/` and `labs/fr/`: the wording no longer claims a count, and the third answer is
named, with what it is for and a pointer to Lab 3.7.

### 2. A step can cite a pill no image carries, and nothing caught it (course + its checker, fixed)

Lab 3.2 told the reader to click **Training: Level 3 (1)** over a screenshot that carries no pills at
all. `check-pills.mjs` could not see it: a step whose images carry no pills was skipped outright,
which is exactly where a stray citation hides.

Fixed both ways: the lab text (en and fr), and the rule, which now reports a step that cites a number
while none of its images is annotated. Verified in both directions, it reports the case and passes
once fixed.

### 3. The lab driver could not run a Training card (extension, fixed)

The first attempt at Lab 1.2 timed out after two minutes waiting for a command panel that never
opened, and `init` never ran. A Training card runs a custom command, and the extension asks before
running one: **Allow once / Always allow / Cancel**. Lab 1.2 step 5 tells the learner to click
**Always allow**. Headless, nobody clicks it, so the command never started.

The driver now stores the same entry that click stores (`autorunEntryFor`), which grants the
authorization the lab grants rather than bypassing it.

### 4. `extensions-install.png` is a dark-theme screenshot in a light-theme course (course, open)

Lab 1.1's Extensions view capture is dark while every other screenshot in the course is light. It is
a hand capture by necessity, because the harness VS Code has no marketplace access, so it cannot be
regenerated by a script. Left open: it needs someone to re-take it by hand in light mode.

### 5. Lab 1.2 says 15 to 20 minutes, and a cold run takes longer (course, open)

Step 5 of Lab 1.2 tells the learner to wait 15 to 20 minutes. On a reset fork with three scratch
orgs created from scratch, the app deployed into each and the data imported, it had not finished
after 50 minutes, and it was still making progress rather than stuck. A learner who reads "15 to 20
minutes" and sees nothing after half an hour will assume it hung and kill it, which is the worst
thing they could do to a half-wired fork.

Two things follow, and only the second is done:

- the lab's estimate should say what the long pole is (three scratch orgs, three deploys, three data
  imports) and give a wider range. **Left open**: it is the course's own copy to set, and this run
  never saw the true total.
- the driver's budget for the step was 40 minutes, which was not enough. Raised to 70 minutes in
  `lab-drivers.json`, with the evidence in a comment next to it.

## What this run did not cover

- **Labs 1.4 to 1.7 were not performed.** Lab 1.4 happens entirely in Salesforce Setup in a browser,
  and no signed-in Chrome was available on the CDP port. Everything after it needs the field it
  creates, so the rest of the level is blocked behind it. They were read and their screenshots
  partly reviewed, nothing more.
- **Lab 1.2 step 7** (Sign in with VS Code so the extension can talk to GitHub) cannot be driven: the
  test host has no GitHub session and the sign-in is an interactive OAuth. The log shows the
  extension reporting no signed-in session for `api.github.com`.
- **The webview DOM is still not clicked.** The driver answers the question the panel received and
  submits what the panel would submit. A question that arrives correctly and renders unreadably still
  passes.
- **Prose clarity was not tested.** An agent reads past ambiguities a beginner stops at.
- **The French labs were not walked**, only kept structurally aligned.
- The extension ran with `yarn compile` but no `yarn dev`, so the worker bundle was missing and every
  command went through the fallback path. Functionally the same, slower, and it should be a clean
  `yarn dev && yarn compile` next time.

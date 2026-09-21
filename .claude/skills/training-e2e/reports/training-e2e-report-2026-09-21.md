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

| Lab | Read (A) | Done (B)        | Images (C) | Verdict                                                 |
|-----|----------|-----------------|------------|---------------------------------------------------------|
| 1.1 | yes      | not applicable  | yes        | Pass, one cosmetic finding (4)                          |
| 1.2 | yes      | **fidelity 1**  | partly     | **Pass**, 10 min 14 s, every promise of step 6 verified |
| 1.3 | yes      | **fidelity 1**  | yes        | **Pass**, and its own check passes. One text finding (1), fixed |
| 1.4 | yes      | **not covered** | partly     | Blocked: the whole lab is Salesforce Setup in a browser |
| 1.5 | yes      | **not covered** | yes        | Blocked downstream of 1.4                               |
| 1.6 | yes      | **not covered** | yes        | Blocked downstream, and it is GitHub web                |
| 1.7 | yes      | **not covered** | n/a        | Blocked downstream of 1.4                               |

### Lab 1.2, what the driver proved

The card was clicked through the real panel, against the real CLI and the real Dev Hub, and every
promise of the lab's step 6 held. Verified from outside the run, not from its log:

| Step 6 promises                             | Observed                                                          |
|---------------------------------------------|-------------------------------------------------------------------|
| A fork, and origin becomes it               | `origin` is `nvuillam/...`, `upstream` is the shared repository    |
| The confirmation the lab documents          | `Build your training environment from helios-prod?`, answered yes  |
| `integration` and `uat` in the fork         | both present                                                       |
| The branch to org mapping                   | `config/branches/.sfdx-hardis.integration.yml` on `integration`     |
| Three scratch orgs                          | `helios-dev`, `helios-integration`, `helios-uat`, all Active        |
| The Helios app deployed into each           | `Installation__c` queryable in all three                            |
| Its data loaded                             | 30 `Installation__c` rows in each of the three                      |
| CI credentials as repository secrets        | `SFDX_AUTH_URL_INTEGRATION`, `SFDX_AUTH_URL_UAT`                    |
| `integration` and `uat` protected           | `integration` has required reviews                                   |

10 minutes 14 seconds, inside the 15 to 20 the lab promises.

### Lab 1.3, what the driver proved

Four questions, in the order the lab documents them, and **no fifth**:

1. `What type of User Story do you want to create?` -> `features`
2. `What is the name of your new User Story? Please avoid accents and special characters.` -> `US-014-panels-required`
3. `Which Salesforce org do you want to work in?` -> `scratch`
4. `Select a scratch org for branch features/US-014-panels-required` -> `helios-dev`

Then the lab's own **Check my work** for Lab 1.3: `OK 1 of 1 checks passed`, with the receipt line.

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

### 5. An anchored choice regex cannot match a choice that starts with an emoji (spec, fixed)

Lab 1.3 failed on its third question with the driver printing what the panel really offered:

```
No choice matching /^Scratch org/ in "Which Salesforce org do you want to work in?".
The panel offered: Sandbox org with source tracking | Scratch org | Current org fun-dream-... | I'm hardcore, I don't need an org !
```

Every one of those titles is prefixed with an emoji in the payload, so `^Scratch org` can never
match. The rules in `lab-drivers.json` were written with `^` anchors throughout; all of them are now
matched on words instead, and the file says why at the top so the next rule is not written that way.

Nothing wrong with the course or the product here: the failure was in the answers this run brought,
and the driver reporting the real choices is what made it a two-minute fix.

### Note on the time Lab 1.2 takes

An earlier draft of this report claimed the setup overran the lab's "15 to 20 minutes". It does not:
mocha timed the step at 10 minutes 14 seconds. The long wall clock came from the first, failed
attempt (finding 3) running before it, not from the setup itself. The step budget in the spec was
raised to 70 minutes anyway, which costs nothing and leaves room for a slower Dev Hub.

## What this run did not cover

- **Labs 1.4 to 1.7 were not performed.** Lab 1.4 happens entirely in Salesforce Setup in a browser,
  and no signed-in Chrome was available on the CDP port. Everything after it needs the field it
  creates, so the rest of the level is blocked behind it. They were read and their screenshots
  reviewed, nothing more. To unblock them, start Chrome with `--remote-debugging-port=9222` on a
  profile signed in to GitHub, and run the walk again from Lab 1.4: the fork and the orgs are
  already wired, and the story branch already exists.
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

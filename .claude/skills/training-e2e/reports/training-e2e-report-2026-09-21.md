# Training end to end run, 2026-09-21

First run of the `training-e2e` skill, and the first to use the **lab driver** (the real VS Code
panels over the real CLI) that was built the same day.

## Versions under test

| Thing              | Version                                                                                  |
|--------------------|------------------------------------------------------------------------------------------|
| sfdx-hardis        | 8.9.0, linked working copy (`sf plugins` shows `link`), branch `feat/training-e2e-skill` |
| vscode-sfdx-hardis | 8.7.0, branch `feat/lab-driver`                                                          |
| Course             | branch `feat/lab-driver-specs`, on top of `c50ebb9`                                      |
| Salesforce CLI     | @salesforce/cli 2.151.6, node 24.11.1                                                    |
| Published site     | live, and **behind the working copy**: the fixes below are not on `main` yet             |

## Environment

| Item             | State                                                                                        |
|------------------|----------------------------------------------------------------------------------------------|
| `helios-prod`    | Developer Edition, Dev Hub, `orgfarm-c77e7e1127`, 6/6 daily scratch orgs, ~14.9k/15k API     |
| `helios-preprod` | Developer Edition, Dev Hub, `orgfarm-bedd5b7a5a`, 6/6 daily scratch orgs                     |
| Scratch orgs     | `helios-dev`, `helios-integration`, `helios-uat`, all Active                                 |
| Fork             | `nvuillam/sfdx-hardis-training`, **reset** to a brand new fork state before the run          |
| Learner clone    | `C:/git/training-run2`, cloned from the shared repository, as a learner does                 |
| Browser on CDP   | absent at first; a Chrome signed in to GitHub then arrived on 9222 and unblocked 1.4 and 1.6 |

The fork reset worked (main plus the three `training/start-level-*` branches, no secrets, no open
Pull Requests). The clone had to move to `training-run2`: a VS Code window still held
`C:/git/training-run`, and `rm -rf` refused it.

## The cheap checks, all green

| Check                      | Result                                               |
|----------------------------|------------------------------------------------------|
| `check-commands.mjs`       | 13 commands the labs rely on, all exist              |
| `check-links.mjs`          | 55 external URLs, every one resolves                 |
| `check-pills.mjs`          | 274 image references against 117 annotated images    |
| `check-site.mjs`           | 86 pages, 1057 assets, 6691 internal links           |
| `i18n/check-structure.mjs` | 30 compared, 1 pre-existing difference in `index.md` |

## What was walked

Fidelity 1 is the lab driver (real panel, real CLI, real org). Fidelity 2 is the headless panel.
Fidelity 3 is `sf`/`git`/`gh` directly.

The browser arrived mid-run: the user started a Chrome signed in to GitHub on the CDP port, which
unblocked Labs 1.4 and 1.6.

| Lab | Read (A) | Done (B)                 | Images (C) | Verdict                                                        |
|-----|----------|--------------------------|------------|----------------------------------------------------------------|
| 1.1 | yes      | not applicable           | yes        | Pass, one cosmetic finding (4)                                 |
| 1.2 | yes      | **fidelity 1**           | partly     | **Pass**, 10 min 14 s, every promise of step 6 verified        |
| 1.3 | yes      | **fidelity 1**           | yes        | **Pass**, own check passes. One text finding (1), fixed        |
| 1.4 | yes      | **browser, real Setup**  | yes        | **Pass**, own check passes. Two findings (6, 7), both fixed    |
| 1.5 | yes      | **fidelity 1** (publish) | yes        | **Pass**, own check passes. Retrieve and commit at fidelity 3  |
| 1.6 | yes      | **browser + gh**         | yes        | **Pass**, own check passes. Two findings (8, 10)               |
| 1.7 | yes      | **not covered**          | n/a        | Capstone: repeats 1.3 to 1.6 unaided, which is the point of it |

**Everything in level 1**, the check the badge claim runs: **5 of 6 pass.** The sixth is Lab 1.7,
which this run did not walk, and the check says exactly what it wants and where it looked:

```
X   Lab 1.7  Capstone: US-016 delivered on your own
      What is missing: Installation__c.Crew_Notes__c was not found
      Where it was looked for: force-app/.../fields/Crew_Notes__c.field-meta.xml on branch integration
```

That message is worth keeping as it is. Every failing check in this run named the thing it wanted and
the place it looked, which is the difference between a learner fixing it and a learner giving up.

### Lab 1.6, end to end

Pull Request opened into `integration`, both required checks green, squash merged, **Process
Deployment (sfdx-hardis)** run on `integration`, and `Panels_Required__c` verified present in
`helios-integration` afterwards. The deployment comment matched the lab's screenshot except for its
ticket link, which is finding 10.

### Lab 1.4, done through the real Salesforce Setup

Driven in the user's signed-in Chrome over CDP, clicking the wizard the lab describes. The field
exists in `helios-dev` with exactly the lab's values (`Panels_Required`, precision 4, scale 0, the
description and help text verbatim), both permission sets carry the grants the lab specifies
(Crew read only, Manager read and edit), and **Check my work** passes:

> Panels Required exists in helios-dev, the crew can read it and the planners can fill it in

Not done: the last part of the lab, typing a value into three Installation records. It changes no
metadata and the lab's own check does not look at it.

### Lab 1.5

Steps 1 to 4 (Metadata Retriever, then the commit) were done with `sf project retrieve start` and
`git commit`, which is fidelity 3: the Metadata Retriever is a webview the driver cannot click yet.
The retrieve returned exactly the four components the lab's screenshot shows, which is what that
screenshot claims. Save / Publish then ran at fidelity 1, two questions, branch pushed, and
**Check my work** passes.

### Lab 1.2, what the driver proved

The card was clicked through the real panel, against the real CLI and the real Dev Hub, and every
promise of the lab's step 6 held. Verified from outside the run, not from its log:

| Step 6 promises                      | Observed                                                          |
|--------------------------------------|-------------------------------------------------------------------|
| A fork, and origin becomes it        | `origin` is `nvuillam/...`, `upstream` is the shared repository   |
| The confirmation the lab documents   | `Build your training environment from helios-prod?`, answered yes |
| `integration` and `uat` in the fork  | both present                                                      |
| The branch to org mapping            | `config/branches/.sfdx-hardis.integration.yml` on `integration`   |
| Three scratch orgs                   | `helios-dev`, `helios-integration`, `helios-uat`, all Active      |
| The Helios app deployed into each    | `Installation__c` queryable in all three                          |
| Its data loaded                      | 30 `Installation__c` rows in each of the three                    |
| CI credentials as repository secrets | `SFDX_AUTH_URL_INTEGRATION`, `SFDX_AUTH_URL_UAT`                  |
| `integration` and `uat` protected    | `integration` has required reviews                                |

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

### 6. Lab 1.4 says to leave every profile unticked; they arrive ticked (course, fixed)

Step 3 of the New Custom Field wizard, in the lab: *"On the field-level security screen, leave every
profile unticked and click Next. You are going to grant this through a permission set, not a
profile."*

What the screen really shows, counted in the org: **19 of the 24 profiles arrive with Visible
ticked.** The instruction cannot be followed as written, and a learner who reads "leave them" and
clicks Next ships the field granted by profile, which is the opposite of what the lab is teaching
and of what Lab 2.6 later builds on.

The checkbox in the **Visible** column header toggles the whole column: from the default it takes one
click to tick all 24 and a second to clear them. Verified by doing it, 48 checkboxes to 0. The lab
now says that.

### 7. Lab 1.4 says to tick a box that is already ticked (course, fixed)

Step 4: *"On the page layout screen, tick Installation Layout"*. There is one layout and it arrives
ticked. Harmless, and still an instruction that does not match the screen, so it now reads as what
it is.

### 8. Lab 1.6 sends a stuck learner back through a 10 minute setup that cannot help (course, fixed)

Walking Lab 1.6 the checks never started: no run at all, not even the `push` one. Actions reported
`enabled: true` and every workflow `active`, and the fork still showed GitHub's banner,
**"Workflows aren't being run on this forked repository"**, with **"I understand my workflows, go
ahead and enable them"**. One click, reopen the Pull Request, and the deployment check started.

Lab 1.6's "If it goes wrong" said to re-run **Set up my training environment**. That cannot clear
this: there is no API behind that banner, which is exactly why the setup command cannot turn it on
either. Lab 1.2 already documents it correctly; Lab 1.6 now points at the banner too, and says the
Pull Request has to be reopened afterwards, which nobody guesses.

Every learner meets this on a fresh fork, so it is the most likely place in Level 1 for someone to
give up.

### 9. Two answer rules were written from an i18n key instead of the rendered question (spec, fixed)

Lab 1.5 stopped on *"Do you want to push your commit(s) to the git server?"*, which the rule
`push commits to git branch` does not match: that text came from the key name
`doYouWantToPushCommitsToGitBranch`, not from the screen. Same class as finding 5. The rule now
matches the sentence a learner reads.

### 10. The Pull Request comment links the story to a placeholder JIRA host (product, open)

The deployment check posted the comment Lab 1.6 walks through, and its **Tickets** section read:

> US-014 -> `https://define.JIRA_HOST.in.cicd.variables/browse/US-014`

A dead link. The course configures `genericTicketingProviderRegex` and
`genericTicketingProviderUrlBuilder` so that US-014 points at its backlog page, and the lab's own
screenshot shows exactly that, with the story title next to it.

sfdx-hardis on `main` already guards this: `getProvidersTicketsFromString` drops a JIRA ticket whose
URL starts with `JIRA_HOST_PLACEHOLDER` when a generic provider is configured. So either the job ran
a published version older than that guard, or the project config did not reach it. **Left open**: the
job log does not print the plugin version, so the run could not tell which, and guessing in a report
is worse than saying so.

What is certain is the mismatch a learner meets: the lab's screenshot shows a working backlog link,
and the comment they get carries a dead one.

### Not a finding: "Insufficient Privileges" on the field wizard

Worth recording because it cost an hour and looked like a blocking course defect. Opening Object
Manager by API name (`/ObjectManager/Installation__c/FieldsAndRelationships/new`) renders the list
fine but denies the wizard. The `new` page wants the object's **durable id**
(`/ObjectManager/01IE200000FmmjT/...`), which is what a learner gets by clicking through Object
Manager as the lab tells them to. A deep link was the harness's shortcut, not the lab's instruction.
The user was System Administrator with `CustomizeApplication` throughout, and the same wizard opened
on `Account` at the same moment, which is what proved it.

## What this run did not cover

- **Lab 1.7, the capstone, was not walked.** It repeats 1.3 to 1.6 unaided on a second story, and
  what it really tests is whether a human can do it without the steps, which is the one thing an
  agent cannot stand in for.
- **The Metadata Retriever was not clicked.** Lab 1.5 steps 1 to 4 were done with
  `sf project retrieve start` and `git commit`. The panel is a webview the driver cannot drive yet,
  so the lab's central teaching moment (pick your four components, leave the rest) is covered by its
  screenshot and not by the walk.
- **Lab 1.4's last part** (typing a value into three Installation records) was skipped: it changes no
  metadata and the lab's own check does not read it.
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

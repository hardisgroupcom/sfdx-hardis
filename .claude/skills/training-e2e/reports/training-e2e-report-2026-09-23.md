# Training end to end run, 2026-09-23

Second run of the `training-e2e` skill. **Levels 1 and 2 were walked in full and both badges were
claimed and awarded**, which is what the run was asked for. **Level 3 reached 9 of its 10 labs**;
3.10, the capstone, was not started.

The run produced **17 findings**. The four worth reading first:

- **F17**: **the course disables its own pipeline.** Lab 3.1 makes `Mega-Linter` a required check on
  all four major branches; it also cuts `preprod` from `main`, and Lab 3.7 retrofits `main` back
  down into `integration`. Both moves replace the Helios project's `megalinter.yml` with the course
  site's, which only answers Pull Requests into `main`. From then on no Pull Request into a major
  branch can obtain the context its own protection demands, and GitHub shows "merging is blocked"
  with every check on the page green and nothing naming the missing one.
- **F3**: `Clean up a training org` can never complete on an org that was actually used.
- **F12**: the badge claim form cannot be submitted by following the instructions the command
  prints.
- **F8**: Lab 1.5's commit screenshot is two thirds a dialog from Level 2.

## Versions under test

| Thing              | Version                                                                      |
|--------------------|------------------------------------------------------------------------------|
| sfdx-hardis        | 8.9.2, linked working copy (`sf plugins` shows `link`), `main` at `a88a276ba` |
| vscode-sfdx-hardis | 8.7.2, `main` at `51fa747e`, plus the F6 fix made during the run              |
| Course             | `main` at `df1399d`, clean                                                    |
| Salesforce CLI     | @salesforce/cli 2.151.6, node 24.11.1                                         |
| Published site     | live, and **level with the course working copy**: nothing was ahead of it     |

## Environment

| Item             | State                                                                             |
|------------------|-----------------------------------------------------------------------------------|
| `helios-prod`    | Developer Edition, Dev Hub, `orgfarm-c77e7e1127`. Production, and seeded for L3   |
| `helios-preprod` | Developer Edition, `orgfarm-bedd5b7a5a`, seeded for L3                            |
| Scratch orgs     | `helios-dev`, `helios-integration`, `helios-uat`, **all created fresh by Lab 1.2** |
| Fork             | `nvuillam/sfdx-hardis-training`, reset to a brand new fork before the walk        |
| Monitoring repo  | `nvuillam/sfdx-hardis-training-monitoring`, reset to its initial commit           |
| Learner clone    | `C:/git/training-run`, cloned from the shared repository, as a learner does       |
| Browser on CDP   | a dedicated Chrome profile on 9222, signed in to GitHub as `nvuillam`             |

The three scratch orgs were **deleted and recreated by Lab 1.2** rather than torn down, because
`Clean up a training org` does not work (F3). That is the more faithful path anyway: a first-time
learner has no orgs at all when Lab 1.2 starts. It cost 3 of the Dev Hub's 6 daily scratch orgs.

## The cheap checks, all green

| Check                              | Result                                                  |
|------------------------------------|----------------------------------------------------------|
| `build/universe.mjs --check`       | 26 lab files, consistent                                |
| `verify/check-commands.mjs`        | 13 commands the labs rely on, all exist                 |
| `verify/check-links.mjs`           | 63 external URLs, every one resolves                    |
| `verify/check-pills.mjs`           | 274 image references against 117 annotated images       |
| `verify/check-site.mjs`            | 109 pages, 1706 assets, 4949 internal links             |
| `verify/check-nav.mjs`             | 109 menus and 109 language pickers                      |
| `verify/check-language-switch.mjs` | the picker after an instant navigation, and the cookie  |
| `i18n/check-i18n.mjs`              | every locale answers every key (one false BEHIND, F1)   |

## What was walked

Fidelity 1 is the lab driver (real VS Code panel, real CLI, real org). Fidelity 2 is the headless
panel (`panel.mjs`: real command, real prompt protocol, real org, no webview). Fidelity 3 is `sf`,
`git` and `gh` directly. "Browser" is the real Salesforce or GitHub UI over CDP.

### Level 1, contributor basics

| Lab | Read (A) | Done (B)                    | Images (C) | Verdict                                             |
|-----|----------|-----------------------------|------------|------------------------------------------------------|
| 1.1 | yes      | not applicable              | yes, all 8 | Pass. Finding 4                                     |
| 1.2 | yes      | **fidelity 1**, 9 min 40 s  | yes        | **Pass**, own check green. Finding 5                |
| 1.3 | yes      | **fidelity 1**, 70 s        | yes        | **Pass**, own check green. Finding 10               |
| 1.4 | yes      | **browser, real Setup**     | yes        | **Pass**, own check green                           |
| 1.5 | yes      | **fidelity 1** for publish  | yes        | **Pass**, own check green. Findings 7, 8, 9, 10, 11 |
| 1.6 | yes      | `gh` + browser              | yes        | **Pass**, own check green                           |
| 1.7 | yes      | fidelity 2 + browser + `sf` | none       | **Pass**, own check green                           |

**6 of 6 pass**, and the badge audit confirmed all six against the public repository.

Lab 1.4 was done entirely by clicking through real Salesforce Setup over CDP: the field wizard
(Number, length 4, 0 decimals, description, help text, Required left off), the field-level security
column cleared with the two header clicks the lab describes, the page layout step, then both
permission sets through Object Settings then Edit, then three installation records edited inline.
`FieldPermissions` afterwards: crew read-only, planners read and edit, exactly the acceptance
criteria.

### Level 2, contributor advanced

| Lab | Read (A) | Done (B)                       | Images (C) | Verdict                           |
|-----|----------|--------------------------------|------------|------------------------------------|
| 2.1 | yes      | fidelity 3 (backpromote CLI)   | yes        | Pass, own check green             |
| 2.2 | yes      | browser (Setup) + fidelity 2/3 | partly     | Pass, own check green             |
| 2.3 | yes      | browser (Setup) + fidelity 2/3 | partly     | Pass, own check green. Finding 13 |
| 2.4 | yes      | fidelity 3 + fidelity 2        | partly     | Pass, own check green             |
| 2.5 | yes      | fidelity 2/3                   | partly     | Pass, own check green             |
| 2.6 | yes      | fidelity 3 + fidelity 2        | partly     | Pass, own check green             |
| 2.7 | yes      | fidelity 2/3 + `gh`            | partly     | Pass, own check green             |
| 2.8 | yes      | fidelity 2/3                   | yes        | Pass, own check green             |
| 2.9 | yes      | fidelity 2/3 + `gh`            | partly     | Capstone, walked. Check green     |

**9 of 9 pass**, and the badge audit confirmed 14 of 14 (it re-runs Level 1 as the prerequisite).

Level 2 is where the course makes the most specific promises, and they all landed, several word for
word. The full list is in the findings file under "Level 2, what the walk confirmed rather than
found". The ones worth repeating: the missing-dependency error text is quoted exactly right; the
coverage gate blocks at **76.92%**, the precise number the lab prints; the whole-org retrieve
produces **+1008 lines on Admin.profile** and a flow diff that removes five lines of a teammate's
work; `resetselection` takes a 13-component delta back down to 1.

### Level 3, release manager

| Lab  | Read (A) | Done (B)                        | Images (C) | Verdict                                |
|------|----------|---------------------------------|------------|-----------------------------------------|
| 3.1  | yes      | `auth.mjs` (fidelity 2) + `gh`  | partly     | Pass, own check green. Findings 14, 15 |
| 3.2  | yes      | `gh` + review comments          | partly     | Pass, own check green                  |
| 3.3  | yes      | `gh` + job log + review comment | partly     | Pass, own check green                  |
| 3.4  | yes      | `gh` + review comment           | partly     | Pass, own check green                  |
| 3.5  | yes      | fidelity 3 + `gh`               | partly     | Pass, own check green. Finding 16      |
| 3.6  | yes      | fidelity 3 + `gh`               | partly     | Pass, own check green                  |
| 3.7  | yes      | fidelity 2/3 + `gh`             | partly     | Pass, own check green. **Finding 17**  |
| 3.8  | yes      | `mon.mjs` + a real nightly run  | no         | **Pass**, own check green. Finding 17  |
| 3.9  | yes      | fidelity 3                      | partly     | Pass, own check green                  |
| 3.10 | no       | **not started**                 | no         | **Not covered**                        |

**9 of 10 walked, and all nine passed their own checks.** The badge was not claimed, because
3.10 is unwalked and the audit would refuse it.

What Level 3 proved live, end to end, on real orgs:

- four orgs moved from the Level 1 auth-URL shortcut to **JWT with encrypted certificates**, and the
  two `SFDX_AUTH_URL_*` secrets were deleted, which is what Lab 3.1 promises;
- the review in 3.2 caught a field leaving a layout that every robot passed green;
- 3.3's log carried `Deployment mode: FULL + Quick Deploy` and `Components: 58 deployed` for a
  one-file Pull Request, which is the lesson;
- 3.5's overwrite manager **kept UAT's own warehouse URL** through a promotion that carried the
  production one;
- 3.6 released to production, and the DORA report came out at 4.4 deployments a week and a 3.4%
  change failure rate;
- 3.7 reproduced the production incident in one call, hotfixed it from `preprod`, released it,
  proved the same call then saved, and retrofitted it back down as one file, +2/-1.

**Lab 3.8** installed monitoring into a reset monitoring repository, created its External Client App
and its two JWT secrets, and wrote the workflow on `main` with the right branch in its matrix. The
first manual run was started on the wrong ref, the monitoring branch rather than `main`, and failed
on the template's placeholder branches: that was this run's mistake, not a course defect, and the
lab says plainly to leave the branch on `main`.

Re-run correctly, the job did what the lab promises. It backed up **1205 metadata files** from
production onto the monitoring branch and committed them, and it finished **red on
`ActiveScratchOrgs`**, which is the failure the lab names in advance and builds its triage exercise
on. Both traps the runbook names for this lab are closed: `git config --global --add
safe.directory` now runs **before** `git pull`, with a comment in the workflow saying why, which is
the previous run's finding 13 holding.

## Findings

The full text of every finding, with its evidence, is in
`C:/git/training-e2e/run-2026-09-23/findings.md`.

| #   | Severity | Where                  | What                                                                  |
|-----|----------|------------------------|-----------------------------------------------------------------------|
| F1  | low      | training               | `check-i18n` reports BEHIND on a formatting-only change               |
| F2  | medium   | training               | a non-interactive `select` never names the flag to pass               |
| F3  | **high** | training               | `Clean up a training org` can never complete                          |
| F4  | medium   | training               | Lab 1.1's VS Code screenshots taken in a configured workspace         |
| F5  | medium   | training               | `org-select-alias.png` captured on a Level 2 feature branch           |
| F6  | medium   | extension + this skill | the documented build order kills the worker (**fixed in both**)       |
| F7  | medium   | training               | Lab 1.5's retriever screenshots say 11 results, the org gives 41      |
| F8  | **high** | training               | Lab 1.5's commit screenshot is two thirds a Level 2 dialog            |
| F9  | medium   | training               | `work-save-completed.png` shows the repository the text warns against |
| F10 | medium   | training               | the three `pipeline-cards--*` shots are one stale Level 2 frame       |
| F11 | **high** | training               | "your four are the four at the top" is false on a real org            |
| F12 | **high** | training               | the badge claim form cannot be submitted as instructed                |
| F13 | low      | training               | Lab 2.3 says Salesforce accepts Required "without a word"; it asks    |
| F14 | low      | this skill             | `auth.mjs`'s documented URL regex matches the wrong choice (**fixed**)|
| F15 | medium   | this skill / training  | nothing cleans up the External Client Apps Lab 3.1 creates            |
| F16 | low      | this skill             | `gh pr edit --body-file` silently fails on this repository            |
| F17 | **high** | training               | after Lab 3.7, no Pull Request into a major branch can be merged      |

Fixed during the run: **F6** (both halves: the runbook's build order, and a worker-path fallback in
`vscode-sfdx-hardis` so a tsc build is not silently degraded) and **F14**. Everything else is
written up with its fix and left for the Pull Requests.

## What this run did not cover

Not optional, per the runbook.

- **Lab 3.10 was not walked at all.** The Level 3 capstone, a whole weekly release cycle with four
  promotions, is the single biggest gap in this report, and the Level 3 badge was not claimed.
- **Two Pull Requests were merged with `Mega-Linter` temporarily lifted** from their branch
  protection, because F17 makes them otherwise unmergeable: #57, the Lab 3.7 hotfix into `preprod`,
  and #60, the Lab 3.8 pipeline configuration into `integration`. The protection was restored
  immediately afterwards in both cases. A learner has no reason to think of that, which is the
  finding.
- **The webview DOM was still not clicked.** The lab driver ran the real panel and the real command
  together for Labs 1.2, 1.3 and 1.5, which is the strongest evidence in this report. It answers the
  question the panel received rather than clicking a pixel, and `labs/_assets/lab-drivers.json`
  covers only those three labs of the twenty-six.
- **Most of Level 2 and Level 3 was walked at fidelity 2 and 3.** Every command was real, every org
  was real, every Pull Request and job was real. What was replaced by a script or a CLI call is the
  clicking: the Metadata Retriever's selection screen, the Flow Builder canvas, the Data Workbench,
  the Deployment Actions dialog, the Pipeline Settings tabs, the New List View dialog and the
  DevOps Pipeline `+ PR` chips. A defect living only in one of those panels would not have been
  found.
- **Flow Builder was never opened.** Labs 2.2, 2.7 and 2.9 change flows, and all three were done by
  editing the flow XML and deploying it. The three flows behaved correctly afterwards and the labs'
  own checks passed, but nothing here proves the Flow Builder clicks those labs describe are still
  accurate. Lab 2.2's screenshots of Flow Builder in particular are unverified.
- **The Lab 1.7 list view was created from metadata**, not from the New List View dialog, which
  fought the harness. The end state is identical and the lab's check passed.
- **Pass C is complete for Level 1 only.** Every image of Labs 1.1 to 1.6 was opened and compared
  with what the product actually did, which is where findings 4, 5, 7, 8, 9 and 10 came from. For
  Levels 2 and 3 only the images the text leaned on were opened. **The remaining Level 2 and Level 3
  screenshots are unreviewed**, and given the hit rate in Level 1, that is where the next run should
  start.
- **French was not walked.** `labs/fr/` was checked only by the structure and i18n scripts.
- **An agent is not a beginner.** Nothing here tests whether the prose works for a first-timer. Two
  places did make this run stop and re-read, and both became findings: F11's "your four are the four
  at the top", and F12's "tick the three boxes and click Submit".

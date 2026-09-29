# Training end to end run, 2026-09-29 (night)

Eighth run of the `training-e2e` skill: **all three levels, 26 labs done and Lab 1.1 read**, from a
fork deleted by the user and recreated for the run, with **every CI job on `sfdx-hardis-ubuntu:beta`**,
the monitoring workflow of Lab 3.8 included, at the user's request: the next release is not out yet
and the question was whether the course works on it. It does. Every lab ended on its own
`Check my work` green: **Level 1 6 of 6, Level 2 9 of 9, Level 3 11 of 11**, and the Lab 3.6 and
3.11 promotions into production were clean.

No badge was claimed: the three were awarded earlier, and a claim writes a duplicate record to the
shared repository.

The run produced **9 findings fixed** in course PR (see the end), **1 harness finding**, and a set of
observations. None of them blocked a learner. Worth reading first:

- **P1 (fixed)**: a badge claim pushes with `GITHUB_TOKEN`, which starts no workflow, so the reset
  branches never get the badge commits. `start-branches.mjs --check` then reports all three
  branches **stale** for nothing, and every learner's retrofit (Labs 3.7 and 3.10) brings the badge
  files of `main` into a Pull Request that should change one file or none. `claim.yml` now
  dispatches **Publish the reset branches**, the way it already dispatched the site build.
- **F3 (fixed)**: Lab 1.6 said 34 sent / 5 changed; three runs in a row got **36 / 7**. The two
  comment pictures were recaptured from this run's Pull Request and the text follows them.
- **O-CLI (not fixed, product)**: `hardis:project:action:create --agent` defaults `--context` to
  `process-deployment-only`; the VS Code **Edit Deployment Action** dialog defaults a new action to
  `all`. A manual step created from the CLI never shows under **Pending manual actions** on the
  check, which Lab 2.4 step 5 relies on. A learner uses the dialog and is fine; an agent or a script
  following the lab is not. Worth aligning in one direction or the other.

## Versions under test

| Thing              | Version                                                                                                            |
|--------------------|--------------------------------------------------------------------------------------------------------------------|
| sfdx-hardis        | `main` at `7dd874ba6`, linked working copy (8.11.1 + #2170, #2221)                                                 |
| vscode-sfdx-hardis | `main` at `7518ad7c`, built `yarn compile && yarn dev` for the lab driver                                          |
| Course             | `main` at `bdd973a`, then branch `fix/training-e2e-2026-09-29`                                                     |
| CI images          | pipeline and monitoring jobs on `sfdx-hardis-ubuntu:beta` = `8.11.2-beta202609282141.0` (npm 21:41Z, image 22:03Z) |
| Salesforce CLI     | @salesforce/cli 2.151.6, node 24.11.1                                                                              |
| Published site     | `main` at `bdd973a`, the same as the course clone: what a learner reads is what was walked                         |

The beta's `gitHead` is `7dd874ba6`, the `main` the local CLI runs, so the jobs and the linked CLI
ran the same code.

## Environment

| Item             | State                                                                                                                   |
|------------------|-------------------------------------------------------------------------------------------------------------------------|
| Fork             | `nvuillam/sfdx-hardis-training`, recreated with `gh repo fork` (init's own call), Actions banner clicked over CDP first |
| Beta override    | one fork-only `E2E ONLY` commit on `main` and `training/start-level-1..3`, pushed after the banner click (trap D1)      |
| Scratch orgs     | `helios-dev`, `-integration`, `-uat` of 2026-09-24, **torn down** then kept by `init` and re-seeded                     |
| `helios-prod`    | Developer Edition, Dev Hub, French-speaking user; torn down, re-seeded by **Set up one of my training orgs**            |
| `helios-preprod` | Developer Edition, French-speaking user; same                                                                           |
| Monitoring repo  | `nvuillam/sfdx-hardis-training-monitoring`, new and private, with its own `E2E ONLY` beta commit on `main`              |
| Learner clone    | `C:/git/training-run`, cloned from the shared repository                                                                |
| Browser on CDP   | a dedicated Chrome profile on 9222, started by the run and already signed in to GitHub                                  |

All five teardowns ran clean (the fixes of 2026-09-26 hold).

## The cheap checks

All green on `main` and again on the branch: `universe --check`, `lab-crossrefs --check`,
`lab-command-links --check`, `check-commands` (14), `check-links` (2 bot-protected sign-up pages),
`check-pills`, `check-i18n`, `check-structure` (the known `index.md` difference), `annotate --check`,
site build, `check-site`, `check-nav`, `check-language-switch`. **`start-branches --check` was red**:
P1 above, a badge-only difference.

## Lab by lab

Fidelity: **1** lab driver (real VS Code panel, real CLI), **2** headless panel (`panel.mjs`,
`auth.mjs`, `mon.mjs`), **3** direct `sf` / `git` / `gh` / API, **browser** the real Setup or GitHub
page over CDP. Pass A read, B do, C look at the images.

| Lab  | Fidelity                                                                       | A  | B  | C       | Findings   |
|------|--------------------------------------------------------------------------------|----|----|---------|------------|
| 1.1  | read only                                                                      | ok | -  | ok      | O3 again   |
| 1.2  | 1 (`init`), browser (Actions banner)                                           | ok | ok | ok      | P1         |
| 1.3  | 1                                                                              | ok | ok | ok      | O-fixtures |
| 1.4  | browser (field wizard, **permission set grants**), 3 (record values)           | ok | ok | ok      |            |
| 1.5  | 3 (retrieve, commit), 1 (Save/Publish)                                         | ok | ok | ok      | O1 again   |
| 1.6  | 3 (`gh pr create`, `prflow.sh`)                                                | ok | ok | ok      | F3, F4     |
| 1.7  | 2, browser (field, grant), 3 (list view as metadata)                           | ok | ok | ok      |            |
| 2.1  | 3 (simulate), 2 (`backpromote --plan` then `--auto`, the panel's call)         | ok | ok | ok      | F5         |
| 2.2  | browser (field, **Visible for System Administrator only**), 3 (flow as XML), 2 | ok | ok | ok      | O          |
| 2.3  | browser (Required and its dialog), 2, 3 (`action:create`, the editor's call)   | ok | ok | ok      | O          |
| 2.4  | 3 (object, grants), **Create my lab records**, 2 (export), 3 (actions)         | ok | ok | ok      | F6, O-CLI  |
| 2.5  | 3 (Apex edits, deploy), 2 (Apex tests card), 2                                 | ok | ok | ok      |            |
| 2.6  | 3 (profile FLS), browser (permission set), 2                                   | ok | ok | ok      |            |
| 2.7  | 3 (flows as XML, merge resolution), browser (grant), 2, simulate               | ok | ok | ok      | F7         |
| 2.8  | 3 (layout, select-all retrieve), 2 (`resetselection`)                          | ok | ok | ok      | H1         |
| 2.9  | 3 (object, flow, records), browser (grants), 2, simulate                       | ok | ok | sampled |            |
| 3.1  | 3 (branch, protection, config), 2 (`auth.mjs` x4)                              | ok | ok | ok      |            |
| 3.2  | simulate, 3 (line review comment), squash                                      | ok | ok | ok      | F8         |
| 3.3  | log read, simulate, 3 (review comment)                                         | ok | ok | sampled |            |
| 3.4  | simulate x2, 3 (comment)                                                       | ok | ok | sampled |            |
| 3.5  | 3 (UAT hand edit, no-overwrite entry, ticks), **publish**, 2 (notes)           | ok | ok | sampled | F9         |
| 3.6  | 3, browser (Deliverability x2), 2 (DORA)                                       | ok | ok | sampled | O6 again   |
| 3.7  | simulate, 3, 2 (retrofit)                                                      | ok | ok | sampled | P1b        |
| 3.8  | 2 (`mon.mjs`), 3 (Run workflow), **beta image**                                | ok | ok | ok      | F29 again  |
| 3.9  | 2 (`project2markdown --with-history`), 3 (paragraphs)                          | ok | ok | sampled |            |
| 3.10 | simulate x5, 2 (`promotion:create`), 3 (resolution by hand), retrofit          | ok | ok | ok      | P1b        |
| 3.11 | simulate, 3, 2 (notes, DORA)                                                   | ok | ok | -       |            |

New this run: Lab 1.4, 1.7, 2.6 and 2.7 granted permission sets **through the Setup Object Settings
page** instead of `FieldPermissions` DML, so the Metadata Retriever lists them the way it does for a
learner (trap of 2026-09-26). Level 2 got its images opened this time (the last run opened none).

What Lab 3.8 showed, on the beta: backup green with `AGENTS.md` and `CLAUDE.md` written, the hotfixed
validation rule of Lab 3.7 in the backup, **Monitoring red on `ActiveScratchOrgs` 3 of 3** as the lab
predicts, **Salesforce CLI** reported *Unsecured* as the lab predicts, no "dubious ownership" in the
first lines.

What Lab 3.10 showed, on the beta: the conflict exactly as the runbook describes it (same two files,
same cut), the check red naming **two** files (the Lab 2.7 files are ignored), green after the
resolution with the "promotion branch carrying 3 Pull Request(s)" line, `helios-preprod` holding
Awaiting Parts, Gate Code and Supplier and neither Warranty Years nor Scaffolding Required, a
retrofit with **0 changed files**, `git merge-tree integration preprod` clean, and Lab 3.11's
`uat` into `preprod` promotion mergeable at once.

## Findings

### Course, branch `fix/training-e2e-2026-09-29`

- **F3**: Lab 1.6 text and its two comment pictures said 34 sent / 5 changed (1 created, 4 updated);
  a learner gets 36 / 7 (1 created, 6 updated), third run in a row. `github-pr-comment` and
  `github-pr-deployed` recaptured from this fork's PR #1 (`web-captures.json` now points there),
  English and French text aligned.
- **F4**: Lab 1.6's `devops-pipeline--deployment-status` shows Level 2 teammate branches (US-024,
  mate-us-019, mate-us-020) a Level 1 learner has never seen. A sentence under it says so.
- **F5**: Lab 2.1's "What you should see" named the two Level 1 fields, which were in `helios-dev`
  already, and never Romain's **Signed Off By**, the one field the backpromote brings.
- **F6**: Lab 2.4's Data Workbench picture already lists `HeliosCrewRefData`, the workspace the step
  is about to create. A sentence under it says so.
- **F7**: Lab 2.7's Merge Changes picture lists one conflicting file; the step says two, and the walk
  got two. A sentence under it says so.
- **F8**: Lab 3.2 step 6 said the fixed Pull Request "moves one field"; after Mariia's fix it moves
  two to the second column, the cap and Total Capacity (now read only).
- **F9**: Lab 3.5's example notes said 19 Pull Requests and 33 items; this run got 20 and 34, the
  last run 20. The table follows, and a sentence says the configuration Pull Request of step 2 and
  the promotion itself are counted.
- **P1**: `claim.yml` dispatches **Publish the reset branches** after pushing a badge (above).
- Changelog `## 2026-09-29`; French `source_rev` restamped for the six labs edited in both languages.

### Harness (this skill)

- **H1**: the runbook's headless stand-in for **Recent Changes** was `sf project retrieve preview`,
  which hides whatever local source tracking already considers synced. After Lab 2.7's step 6 (a
  **Deploy This Source to Org** of `force-app`), the `Admin` and `Helios Crew` profiles are in
  `SourceMember`, so the Metadata Retriever lists them, and the preview does not. Lab 2.8 looked
  wrong ("no Admin profile") until the `SourceMember` query was run. The runbook now says to query
  `SourceMember` the way the Retriever does.
- The runbook gains the traps of this run: launching the lab driver from an agent, the
  Object Settings edit URL that grants object and field access, the action context mismatch, ANSI
  codes in CI logs, and a scratch org whose deleted object still captures its API name.

### Not fixed

- **O-CLI**: the action context default mismatch (above), a product question for the CLI and the
  extension together.
- **F29**: Lab 3.8's `org-monitoring--first-report` still shows the wrong-folder banner and no
  **Deployment repository** link. Regenerating it needs a monitoring repository fixture in the
  screenshot harness.
- **O-a**: after a teardown, `helios-dev`'s source tracking still lists about twenty deleted
  components (Crew Notes, Handover Item fields...) as changes. Only a reused org sees it, and the
  Retriever offers them: a learner who tears down and restarts would see noise in Lab 1.5.
- A leftover deleted `Handover_Item__c` in `helios-dev` (from before the teardown fix) still makes
  `ObjectPermissions` DML resolve the name to the deleted object (*Invalid object*). Granting
  through the Setup page works. Erasing it under Deleted Objects would clear it.

## Observations

- **O1** (again): Lab 1.5's Source Control picture marks all four files `U`.
- **O3** (again): Lab 1.1 and 1.2 pictures show extension v8.6.1.
- **O6** (again): the DORA report of `helios-prod` counts every walk since mid-September (8.3 then
  8.6 deployments a week). A learner's is fresh.
- Lab 1.3 and 1.6 fixtures (`work-new-completed`, `work-save-completed`) name `hardisgroupcom` as the
  repository where a learner after `init` sees their own fork.
- Lab 2.2 step 5's Metadata Retriever picture is the generic Level 1 list with an empty name box,
  where the step types `Crew_Warning_Sent__c`.
- Lab 2.3's edit dialog picture sits over a mock list of nine actions; a learner has none yet.
- `hardis:work:backpromote` writes the `@salesforce/cli` version (2.151.6) in the `version` field of
  its Backpromotes comment data, and names a scratch org by its lowercased org id.
- 13 French labs still read *behind* in `check-translations` for the O7 reason of the last run
  (stamps taken on a branch whose commits a squash discards); the six edited here are current.

## Deviations from what a learner does

- **D1**: the fork was created with `gh repo fork` before `init`, the banner clicked over CDP, and the
  beta override pushed after the click, so `init` found a fork with Actions on (runbook trap). A
  learner's `init` creates the fork and waits for the click.
- Lab 1.2 step 7 (the extension's GitHub sign-in) cannot be driven; the backpromote, release notes,
  DORA and promotion commands got `gh`'s token in `GITHUB_TOKEN`, which is what the extension passes.
- Flow Builder was never clicked: Lab 2.2's and 2.7's flows went in as XML deployed from another
  folder. The admin's describe was checked for Lab 2.2's field (the N12 trap).
- Lab 2.6's profile field-level security went in as `FieldPermissions` on the profile's permission
  set: `/setup/layout/flsedit.jsp` opened by URL shows no form.
- The Data Workbench, the Deployment Actions editor, Pipeline Settings and the package viewer were
  replaced by the file or the command they write (`export.json`, `action:create`, the YAML keys,
  `package-no-overwrite.xml`).

## What this run did not cover

- **The webview DOM is still not clicked.** Only Labs 1.2, 1.3 and 1.5 ran at fidelity 1; every
  other panel step was the command it runs (fidelity 2) or the file it writes (fidelity 3).
- **An agent is not a beginner.** Prose clarity was not really tested: every lab was read, and
  nothing stopped the walk that a first-timer would stop at, which says more about the reader than
  about the prose.
- The French side was not walked; its structure and completeness checks passed.
- Lab 1.1 was read and its pictures checked, not performed.
- No badge was claimed, so the audit and the new dispatch of `claim.yml` did not run. The dispatch
  uses the same `gh workflow run` call and permission as the site build next to it.
- Pass C was sampled in Labs 2.9, 3.3 to 3.7, 3.9 and 3.11, not exhaustive.
- The behaviour of Lab 2.7's merged flow (flat roof minimum before the cap) was checked by the lab's
  own check and the deployed XML, not by saving records in `helios-integration`.

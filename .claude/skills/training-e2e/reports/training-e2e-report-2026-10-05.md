# Training end to end run, 2026-10-05 (night)

Tenth run of the `training-e2e` skill, the first on the **released** sfdx-hardis 8.13.0 and
vscode-sfdx-hardis 8.10.0: **all three levels, 26 labs done and Lab 1.1 read**, from a fork the user
deleted before the run and that **Set up my training environment** created again, with **every CI
job on the released image** (`sfdx-hardis-ubuntu:latest`), no override anywhere. The question was
whether the course is ready for a learner on the versions published the evening before: text,
steps and pictures.

Every lab ended on its own `Check my work` green: **Level 1 6 of 6 performed (1.1 is read only),
Level 2 9 of 9, Level 3 11 of 11**.

The run produced **one blocking course defect, two places where a learner was stuck with no
explanation, one product bug in each of the two products**, and the pictures: every VS Code
screenshot of the course was taken again and compared with the one it replaces. Worth reading first:

- **F8 (fixed, course)**: since Lab 3.3 gained its Part 3, the promotion to UAT of Lab 3.5
  deployed its metadata and then **ended red**. The first action of US-062 looks for the Crew Leads
  public group, and the group only existed in `helios-integration`, where the learner creates it by
  hand. Nothing in Labs 3.5, 3.6 or 3.11 said so, and `preprod` and production would have failed
  the same way. Mariia's fix Pull Request now ships the group as metadata. Proven in the fork:
  `uat`, `preprod` and `main` deployed green with her three actions.
- **F10 (fixed, course)**: Lab 3.6 said "Read the check, merge" for the promotions to `preprod` and
  to production. Since 8.13.0 both checks stop **red** until the deliverability step of US-026 is
  done in that org, ticked, and the check run again. Lab 3.5 says so for `uat`; Lab 3.6 did not.
- **E1 (fixed, extension)**: **Pipeline Settings opened on the Custom Functions tab** instead of
  Deployment, on every project. Found because the retaken picture of Lab 3.1 did not match its text.
- **C1 (fixed, CLI)**: `hardis:project:action:create` wrote a `when:` key into the actions already
  in the file each time it added one.
- **The pictures**: 4 of them showed a list where the lab describes a dialog (the action editors),
  and one a Save / Publish ending the learner does not get. Details under Screenshots.

## Versions under test

| Thing              | Version                                                                                                |
|--------------------|--------------------------------------------------------------------------------------------------------|
| sfdx-hardis        | `main` at `9625bdf69`, **v8.13.0**, linked working copy                                                |
| vscode-sfdx-hardis | `main` at `6b84a313`, **v8.10.0**, built from sources (`yarn compile && yarn dev`) for the lab driver  |
| Course             | `main` at `af0ed27`, then branch `fix/training-e2e-2026-10-05`                                         |
| CI images          | `ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:latest` = v8.13.0 (npm 21:54Z, image 21:59Z on 2026-10-04)  |
| Salesforce CLI     | @salesforce/cli 2.151.7, node 24.11.1                                                                  |
| Published site     | `main` at `af0ed27`, the same as the course clone when the walk started                                |

## Environment

| Item             | State                                                                                                             |
|------------------|-------------------------------------------------------------------------------------------------------------------|
| Fork             | `nvuillam/sfdx-hardis-training`, deleted by the user, **created by `init`** in Lab 1.2, Actions banner clicked over CDP |
| Scratch orgs     | `helios-dev`, `-integration`, `-uat` of 2026-09-24, torn down, kept by `init` and re-seeded                       |
| `helios-prod`    | Developer Edition, Dev Hub; torn down, re-seeded by **Set up one of my training orgs**                            |
| `helios-preprod` | Developer Edition; same                                                                                           |
| Monitoring repo  | `nvuillam/sfdx-hardis-training-monitoring-run3`, new and private (the one of the last run cannot be deleted by `gh`) |
| Learner clone    | `C:/git/training-run`, cloned from the shared repository                                                          |
| Browser on CDP   | a dedicated Chrome profile on 9222, started by the run, already signed in to GitHub                               |

The five teardowns ran clean. One thing they left: the Crew Leads public group in
`helios-integration` (finding F6).

## The cheap checks

All green on `main` before the walk: `universe --check`, `lab-crossrefs --check`,
`lab-command-links --check`, `check-commands`, `check-links`, `check-pills`, `check-i18n`,
`check-structure`, `annotate --check`, `start-branches --check`, site build, `check-site`,
`check-nav`, `check-language-switch`. Green again on the branch: the generators, `universe --check`, `annotate --check`, `check-pills`, `check-translations` (0 behind), `check-structure`, `check-i18n`, `check-commands`, the site build, `check-site`, `check-links` and `check-mobile`.

## Screenshots

**Every VS Code picture was retaken** with `shots.mjs --all --kind vscode` (extension 8.10.0 from
sources, sfdx-hardis 8.13.0 in the side bar), each one compared pixel by pixel with the picture it
replaces, and the annotated ones opened four to a sheet. 157 files moved, nearly all for the look of
VS Code 1.140 and the version numbers of the side bar. What needed more than a retake:

- **The four action editor pictures** (Labs 2.3 and 2.4: Apex, Data, Schedule Batch, Manual) showed
  the list of actions with no dialog open. The capture clicks a row at a fixed height, and the Pull
  Request window gained its path bar in 8.10.0. Fixed in the extension harness, retaken.
- **The Metadata Retriever pictures** (Lab 1.5) ticked the wrong rows, an Apex class among them,
  and one showed no org selected. Row heights fixed in the course fixtures, retaken.
- **Pipeline Settings** (Labs 2.6, 3.1) came back on the Custom Functions tab: product bug E1.
- **The end of Save / Publish** (Labs 1.6, 3.1, 3.7) showed a line and a button a learner never
  gets (finding F2). The course now sets `manualActionsMode: sfdxHardis`, and the picture follows.
- **About twenty pill sets re-pinned**, because a panel gained a row or a button moved: the Add
  Org button, the contribution cards heading, the Source Control icon, the Save / Publish buttons,
  the deployment actions list, the secrets of Add/Configure Org, the Data Workbench, the Metadata
  Retriever, the promotion conflict question.

**The GitHub pictures follow the new fork**: the checks, the sfdx-hardis comment, the merge box and
its menu, the deployment comment (Lab 1.6), the failed check and the flow diff (2.2), the
deployment actions comment (2.4), the branch rules, the new branch dialog and the secrets (3.1),
the files tab (3.2), the promotion comment and the improved release notes (3.5), the Run workflow
menu (3.8). `web-captures.json` points at the Pull Requests of this walk.

Not retaken, and why:

- `action-run-prompts`, `pipeline-branch-modal-actions-failed`, `pipeline-edit-action-moved`
  (Lab 3.3 Part 3): their capture variant needs two click points nobody recorded. They were taken
  on 2026-10-04 on the code that became 8.10.0, and were opened and compared with the walk.
- `github-pr-deployment-actions-failed` and `-moved` (Lab 3.3): the failure of this walk was not the
  lab's (finding F6), so its comment could not stand for it. They still point at a Pull Request of
  the deleted fork.
- `training-menu-authorization` and `extensions-install`: taken by hand, on an older VS Code look.
- `sf-signup`, `git-download`, `nodejs-download`, `vscode-download`, `gh-cli-download`, the three
  star pictures, and the Salesforce Setup pictures: third party pages, opened and still matching,
  not retaken.

## Lab by lab

Fidelity: **1** lab driver (real VS Code panel, real CLI), **2** headless panel (`panel.mjs`,
`auth.mjs`, `mon.mjs`), **3** direct `sf` / `git` / `gh` / API, **browser** the real Setup or GitHub
page over CDP. Pass A read, B do, C look at the images.

| Lab  | Fidelity                                                                             | A  | B  | C       | Findings     |
|------|--------------------------------------------------------------------------------------|----|----|---------|--------------|
| 1.1  | read only                                                                            | ok | -  | ok      |              |
| 1.2  | 1 (`init`, which created the fork), browser (Actions banner)                         | ok | ok | ok      |              |
| 1.3  | 1                                                                                    | ok | ok | ok      | O-repo again |
| 1.4  | browser (field wizard, permission set grants), 3 (record values)                     | ok | ok | ok      |              |
| 1.5  | 3 (retrieve, commit), 1 (Save/Publish)                                               | ok | ok | ok      | F2, O1 again |
| 1.6  | 3 (`gh pr create`, `prflow.sh`)                                                      | ok | ok | ok      | F1           |
| 1.7  | 2, browser (field, grant), 3 (list view as metadata)                                 | ok | ok | ok      |              |
| 2.1  | 3 (simulate), 2 (`backpromote --plan` then `--auto`, the panel's call)               | ok | ok | ok      | F3           |
| 2.2  | browser (field), 3 (flow as XML), 2                                                  | ok | ok | ok      |              |
| 2.3  | browser (Required and its dialog), 2, 3 (`action:create`)                            | ok | ok | ok      |              |
| 2.4  | 3 (object, tab, app, grants as metadata), **Create my lab records**, 2 (export), 3   | ok | ok | ok      | F4, C1       |
| 2.5  | 3 (Apex edits, deploy), 2 (Apex tests card)                                          | ok | ok | ok      |              |
| 2.6  | 3 (profile FLS), browser (permission set), 2                                         | ok | ok | ok      |              |
| 2.7  | 3 (flows as XML, merge resolution), browser (grant), 2, simulate                     | ok | ok | ok      |              |
| 2.8  | 3 (layout, select-all retrieve), 2 (`resetselection`)                                | ok | ok | ok      |              |
| 2.9  | 3 (object, flow, grants, records), 2, simulate                                       | ok | ok | ok      |              |
| 3.1  | 3 (branch, protection, config), 2 (`auth.mjs` x4)                                    | ok | ok | ok      | E1           |
| 3.2  | simulate, 3 (line review comment), squash                                            | ok | ok | ok      |              |
| 3.3  | log read, simulate x4, 3 (review comment), 2 (`action:run`), 3 (`action:set-status`) | ok | ok | partial | F5, F6, F8   |
| 3.4  | simulate x2, 3 (comment)                                                             | ok | ok | ok      |              |
| 3.5  | 3 (UAT hand edit, no-overwrite entry, tick), **publish**, 2 (notes)                  | ok | ok | ok      | F8, F9       |
| 3.6  | 3, browser (Deliverability x2), 2 (DORA)                                             | ok | ok | ok      | F10          |
| 3.7  | simulate, 3, 2 (retrofit)                                                            | ok | ok | ok      |              |
| 3.8  | 2 (`mon.mjs`), 3 (Run workflow), released image                                      | ok | ok | ok      | F29 again    |
| 3.9  | 2 (`project2markdown --with-history`), 3 (paragraphs)                                | ok | ok | ok      |              |
| 3.10 | simulate x5, 2 (`promotion:create`), 3 (resolution by hand), retrofit                | ok | ok | ok      |              |
| 3.11 | simulate, 3 (`promo.sh` x3), 2 (notes, DORA)                                         | ok | ok | ok      |              |

Pass A, for the labs whose text did not change since the walk of 2026-09-29, was a read of the
steps as they were performed rather than a first read: the agent had walked them before.

What Lab 3.8 showed, on the released image: backup green with `AGENTS.md` and `CLAUDE.md` written,
the hotfixed validation rule of Lab 3.7 in the backup, **Monitoring red on `ActiveScratchOrgs` 3 of
3** as the lab predicts, **Salesforce CLI** reported *Unsecured* as the lab predicts, "dubious
ownership" only in the comments of the workflow.

What Lab 3.10 showed: the conflict exactly as the runbook describes it (same two files), the check
red naming those **two** files, green after the resolution with the "promotion branch carrying 3
Pull Request(s)" line, `helios-preprod` holding Awaiting Parts, Gate Code and Supplier and neither
Warranty Years nor Scaffolding Required, a retrofit with **0 changed files**, and in Lab 3.11 a
`uat` into `preprod` promotion that merged at once and brought Warranty Years.

The fork ended the walk with 43 Pull Requests, the last one the release of Lab 3.11 into `main`.

## Findings

### Course, branch `fix/training-e2e-2026-10-05`

- **F8 (blocking)**: the promotion to UAT of Lab 3.5 ended with a red deployment job, on the first
  action of US-062 (`List has no rows for assignment to SObject`): the Crew Leads public group only
  exists where the learner created it by hand in Lab 3.3. The scenario `us-062-crew-leads-fix` now
  ships `groups/Helios_Crew_Leads.group-meta.xml` and adds its block to `manifest/package.xml`, and
  Lab 3.3 step 12 says so. **Proven in the fork** with the same content in a Pull Request of its
  own (#24): it deploys over the hand-made group in `integration`, and `uat`, `preprod` and `main`
  then ran the three actions green. Not proven through the simulator itself: the fix Pull Request
  of this walk was merged before the finding.
- **F10**: Lab 3.6 steps 2 and 3 now say that the check of each promotion stops red on the
  deliverability step until it is done, ticked and the check run again.
- **F6**: `Clean up a training org` did not remove the Crew Leads public group. On the org of the
  previous walk, the first action of US-062 therefore passed in Lab 3.3, and only the second one
  failed: the lab described a failure nobody saw. The teardown removes the group now. The walk
  carried on from that state: Retry on the crew capacity action (it fails on the class name, as the
  lab's picture shows), Mariia's fix, then Mark as done on the third.
- **F2**: Save / Publish ended on *Define a manual actions file. Ask your release manager...*,
  where the picture showed a link to Lab 2.4 and an **Update Manual Actions file** button. The
  course manages manual steps as deployment actions, so `config/.sfdx-hardis.yml` now says
  `manualActionsMode: sfdxHardis`, and the picture was retaken with what a learner gets.
- **F1**: the MegaLinter comment of every learner Pull Request carried a second warning,
  `SALESFORCE / code-analyzer-aura - 1 error`, and thousands of ESLint findings on the scripts of
  the course. The project has no Aura component: the analyzer is disabled. **Not proven in CI**: it
  takes effect once the course branch is merged and the start branches republished.
- **F3**: Lab 2.1 said "pick the oldest one" of a list the picture shows with three rows. A real
  fork lists 64: the three stories, then the commits of the course, with no number. The lab names
  the row to pick, #1 US-014, and says what the others are.
- **F4**: Lab 2.4 step 5 said the two post-deployment actions are marked *skipped* at the red
  check. They read *not run in this org branch yet*.
- **F5**: Lab 3.3 said the overwrite manager queries the org whenever the no-overwrite file lists
  something. Since 8.13.0 it only does when an item of the package matches the list.
- **F9**: Lab 3.5's example notes said 20 Pull Requests, 15 tickets and 34 items. This walk got 22,
  16 and 37, with the two Pull Requests Lab 3.3 gained. The lab says 22, 16 and 38, the group
  included.
- The harness fixtures: `retrieverRows` follows the row height of the Metadata Retriever, and the
  Save / Publish scenario reads `manualActionsMode` from the project configuration.
- Changelog `## 2026-10-05`, French side of every edit, `source_rev` restamped.

### Extension, branch `fix/doc-screenshots-pr-window-rows`

- **E1**: Pipeline Settings opened on **Custom Functions**. That tab is static markup, so it
  registered before the configuration sections and the tabset took it as its first. The panel now
  starts on its first section when no section is asked for.
- The documentation screenshot harness clicks the action rows where the Pull Request window draws
  them now, on the product fixture as on the course's, and the mocked Save / Publish follows
  `manualActionsMode`.

### CLI, branch `docs/training-e2e-2026-10-05`

- **C1**: `readActions` sets `when` on each action for its callers, and `writeActions` wrote it
  back. Adding a second action to a file gave the first one a `when: post-deploy` key. Stripped at
  the write, with a test.
- This report, the runbook (the traps of this run, and how to retake and compare every picture
  after a release), `promo.sh` and `tick.mjs` for promotions, and a `reset-fork.sh` that copes with
  a deleted fork.

### Not fixed

- **F29** (again): Lab 3.8's `org-monitoring--first-report` shows the wrong-folder banner and no
  **Deployment repository** link. It needs a monitoring repository fixture in the screenshot harness.
- **O-CLI** (again): `hardis:project:action:create --agent` defaults `--context` to
  `process-deployment-only`, the editor to `all`.
- **O1** (again): Lab 1.5's Source Control picture marks all four files `U`; a learner sees three
  `M` and one `U`.
- **O-repo** (again): the fixtures of Labs 1.3 and 1.6 name `hardisgroupcom` as the repository.
- `prettier --check` already fails on `pipelineConfig.js` on `main` of the extension, before this
  change.

## Deviations from what a learner does

- Flow Builder was never clicked: the flows of Labs 2.2, 2.7 and 2.9 went in as XML.
- The object, tab, app entry and grants of Lab 2.4, and the object and grants of Lab 2.9, were
  deployed as metadata from another folder instead of clicked in Setup.
- Lab 2.6's profile field-level security went in as `FieldPermissions` on the profile.
- The Deployment Actions editor, Pipeline Settings, the package viewer and the Data Workbench were
  replaced by the command or the file they write.
- The Crew Leads group reached `uat` through a Pull Request of its own (#24) and a second
  promotion (#25), because the finding came after Mariia's fix was merged. A learner gets it in
  her fix Pull Request.
- Merged branches were not deleted on GitHub.
- Lab 1.2 step 7 (the extension's GitHub sign-in) cannot be driven; the commands that need the
  provider got `gh`'s token in `GITHUB_TOKEN`.

## What this run did not cover

- **The webview DOM is still not clicked.** Only Labs 1.2, 1.3 and 1.5 ran at fidelity 1; every
  other panel step was the command it runs or the file it writes.
- **An agent is not a beginner.** Prose clarity was not really tested. Two of this run's findings
  (F3, F10) are places where a beginner stops and the last walks did not.
- **The fixed US-062 scenario was not replayed through `Simulate my teammates`**, and neither was
  the new teardown: both are proven by their content, not by their script.
- **The MegaLinter change (F1) and `manualActionsMode` (F2) were not seen in a learner's CI**: the
  fork of this walk was created from `main` before them.
- The French side was not walked. Its structure, completeness and translation stamps pass.
- Lab 1.1 was read and its pictures checked, not performed.
- No badge was claimed.
- Lab 3.3 Part 3 was walked from a state the lab does not describe (F6): its first failure, and
  the two GitHub pictures of it, were not reproduced.
- The three action recovery pictures of Lab 3.3 were not retaken.
- `yarn test` and `yarn test:ui` of the extension were not run on its branch: lint only, and the
  captures on both fixtures.

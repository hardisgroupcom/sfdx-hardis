# Training end to end run, 2026-10-08

The whole course walked again to retake its pictures after sfdx-hardis #2316 (branch
`feat/readable-pr-comments`) rewrote every Pull Request comment the CLI writes. Every CI job of the
fork ran that branch, built from source in the job; the workstation ran it through
`sf plugins link`. Three agents walked one level each, in order, on the same fork and orgs.
**Level 1 6 of 6, Level 2 9 of 9, Level 3 11 of 11** (Lab 1.1 read only).

The walk found **five CLI defects, all fixed on the branch under test, one course design gap that
the text now names, and nine places where the course disagreed with what a learner gets**. Every
GitHub and Salesforce picture of the three levels was taken again from the walk's own Pull
Requests, in the new comment layout.

- **CLI-1 (fixed, `7c549a077`)**: a Flow diff row read `Panels_Required__c · Is Null` with no
  value, and "Is Null False" means "is not null": the row read as the opposite. Flow documentation
  and diff comments now write True or False.
- **CLI-2 (fixed, `affac0562`)**: a validation stopped only by a pending manual step said "Fix it,
  commit and push". It now says to do the steps, tick their boxes and run the validation again.
- **CLI-3 (fixed, `e2643d260`)**: a deployment error on a component whose name holds a space put
  half of it in bold: **Installation__c-Installation** Layout. Lab 3.3 quotes that error.
- **CLI-4 (fixed, `f8fdd0255`)**: the comments of a failed deployment action sent the reader to the
  **Run** button of the VS Code Deployment Actions tab. The button reads **Retry**.
- **CLI-5 (fixed, `3f30ec39b`)**: the red check of a promotion branch with conflict markers said
  "Fix it, commit and push" and then, in the next sentence, the same thing in more words.
- **C-RESET (course design, named in Lab 3.5, not fixed)**: after **Reset this level** into Level 3,
  no promotion carries the Level 2 deployment actions (deliverability, crew capacity data and its
  nightly job, crew size backfill, handover templates). See Findings.

## Versions under test

| Thing              | Version                                                                                                                                                                                                                                            |
|--------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| sfdx-hardis        | `feat/readable-pr-comments` (#2316), from `36c0905cf` at Level 1 to `3f30ec39b` at the end, compiled in `lib/` and linked (`sf plugins link`); every CI job of the fork cloned that branch and linked it (`sfdx-hardis 8.15.0 (link)` in each log) |
| vscode-sfdx-hardis | `feat/readable-pr-comments`, compiled, `f91668cc` at the end                                                                                                                                                                                       |
| Course             | `docs/readable-pr-comments` (#97), from `845ab1e` (`main`, published) to the commits listed below                                                                                                                                                  |
| CI image           | `sfdx-hardis-ubuntu:latest` with the source-build override of runbook section 8 on every branch a job ran from; the monitoring repository ran the released image (no fix under test touches monitoring)                                            |
| Published site     | `main` at `845ab1e`: the course text under test is the branch of #97, ahead of the site                                                                                                                                                            |

## Environment

| Item            | State                                                                                                                                                                                                                          |
|-----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Fork            | `nvuillam/sfdx-hardis-training`, reset with `reset-fork.sh`, override on `main` and the three start branches; `reset --level N` before Levels 2 and 3, each followed by an override Pull Request into `integration` (#48, #62) |
| Orgs            | `helios-dev`, `-integration`, `-uat` (scratch), `helios-preprod`, `helios-prod` (orgfarm Developer Editions, French): five teardowns before Level 1, the two Developer Editions seeded again in Lab 3.1                        |
| Monitoring repo | `nvuillam/sfdx-hardis-training-monitoring-run5`, new and private                                                                                                                                                               |
| Learner clone   | `C:/git/training-run`                                                                                                                                                                                                          |
| Browser on CDP  | the dedicated `chrome-cdp-training` profile on 9222: relaunched once (wedged by two tabs `fls.mjs` left), freed once by closing the tab of another session's script                                                            |

## Screenshots

- **VS Code** (Level 1 agent): `shots.mjs --all --kind vscode`, 136 pictures, compared pixel by pixel
  with the previous ones: all under 0.3% except `promotion-create-conflict` (4.5%, fine on review).
  The 86 annotated ones were opened four to a sheet: no pill moved. Kept: `backpromote-loading` (the
  harness stops at the third step, the lab names the fourth). Not retaken, unknown to `shots.mjs`:
  `action-run-prompts`, `pipeline-branch-modal-actions-failed`, `pipeline-config-user-stories`,
  `pipeline-edit-action-moved`, `training-menu-authorization`. Level 3 found no other VS Code picture
  its walk contradicted.
- **GitHub**, all from this walk's Pull Requests: `github-pr-comment`, `-checks`, `-merge`,
  `-merge-squash`, `-deployed` (#46), `-check-failed`, `-flow-diff` (#50), `-deployment-actions`
  (#53), `github-branch-rules`, `-branch-rule`, `-new-branch`, `-secrets-actions`, `-secret-new`,
  `-secret-new--key`, `github-pr-files` (#64), `-deployment-actions-failed`, `-moved` (#66),
  `-promotion-actions` (#70), `-promotion-description`, `-promotion-markers` (#84),
  `github-run-workflow` (-run5), the three Star pictures, and a new one, `github-pr-files-hotfix`
  (#74). Not retaken: `github-pr-release-notes`, a description written by hand on #23 (see "did not
  cover"), and `github-pr-create`.
- **Salesforce**: Lab 1.4 (object manager, field wizard, record), Lab 2.2 (four Flow Builder
  pictures), Lab 2.4 (crew capacity records), Lab 2.7 (two Flow Builder pictures), Lab 3.7
  (`validation-rule`). Setup was restyled: the Object Manager clips of Labs 1.4 and 3.7 were set again.
- **Pills** re-placed where the new layout moved what they point at: `github-pr-checks` (Mega-Linter
  now listed first), `github-pr-check-failed`, `-deployment-actions`, `-deployment-actions-failed`,
  `-deployment-actions-moved`, `-promotion-actions`, `flow-builder-add-element`, the Star pictures,
  `validation-rule`. Every picture committed was opened with the Read tool.

## Lab by lab

Fidelity: **1** lab driver (real VS Code panel, real CLI), **2** headless panel (`panel.mjs`,
`panel-node.mjs` for the Training menu, `auth.mjs`, `mon.mjs`), **3** direct `sf` / `git` / `gh` /
API, **browser** the real page over CDP.

| Lab  | Fidelity                                                                                        | A  | B  | C  | Findings         |
|------|-------------------------------------------------------------------------------------------------|----|----|----|------------------|
| 1.1  | read only                                                                                       | ok | -  | ok |                  |
| 1.2  | 1 (lab driver)                                                                                  | ok | ok | ok |                  |
| 1.3  | 1                                                                                               | ok | ok | ok |                  |
| 1.4  | browser (field, grants), 3 (values)                                                             | ok | ok | ok | text (2 pallets) |
| 1.5  | 3 (retrieve), 1 (Save / Publish)                                                                | ok | ok | ok |                  |
| 1.6  | 3 (`gh pr create`, `prflow.sh`)                                                                 | ok | ok | ok |                  |
| 1.7  | 2, browser, 3 (list view as metadata)                                                           | ok | ok | ok |                  |
| 2.1  | 2 (simulate), 3 (`backpromote --plan` / `--auto`)                                               | ok | ok | ok |                  |
| 2.2  | 2, browser (field), 3 (flow as XML)                                                             | ok | ok | ok | CLI-1            |
| 2.3  | 2, browser (Required), 3 (`action:create`)                                                      | ok | ok | ok |                  |
| 2.4  | 3 (object, tab, grants), 2 (records), 3 (export, actions)                                       | ok | ok | ok | CLI-2, C-24a     |
| 2.5  | 3 (Apex edits), CI                                                                              | ok | ok | ok |                  |
| 2.6  | 3 (profile FLS by API), browser (permission set), 2                                             | ok | ok | ok |                  |
| 2.7  | 3 (flows as XML, merge), browser (grant), 2                                                     | ok | ok | ok |                  |
| 2.8  | 3 (layout, retrieve), 2 (`resetselection`)                                                      | ok | ok | ok |                  |
| 2.9  | 3 (object, flow, records), 2, simulate                                                          | ok | ok | ok | text (Star)      |
| 3.1  | **seed** x2, 3 (branch, protections, Pipeline Settings as files), 2 (`work:new`, `auth.mjs` x2) | ok | ok | ok | C-31a            |
| 3.2  | 2 (simulate x2), 3 (line review)                                                                | ok | ok | ok | C-32a            |
| 3.3  | log read, 2 (simulate x4, `action:run`), 3 (review, group, `set-status`)                        | ok | ok | ok | CLI-3, CLI-4     |
| 3.4  | 2 (simulate x2), 3 (review)                                                                     | ok | ok | ok | C-34a            |
| 3.5  | 3 (UAT address, no-overwrite entry), 2 (publish, notes), `promo.sh`                             | ok | ok | ok | C-RESET, C-35a   |
| 3.6  | browser (Deliverability x2), `promo.sh` x2, 2 (DORA)                                            | ok | ok | ok |                  |
| 3.7  | 3 (reproduce in prod), 2 (simulate, retrofit), `promo.sh`                                       | ok | ok | ok | C-37a            |
| 3.8  | 2 (`mon.mjs`), 3 (Run workflow), 2 (publish)                                                    | ok | ok | ok |                  |
| 3.9  | 2 (`project2markdown --with-history`), 3 (paragraphs)                                           | ok | ok | ok |                  |
| 3.10 | 2 (simulate x5, `promotion:create`), 3 (resolution by hand), `promo.sh` x2, 2 (retrofit)        | ok | ok | ok | CLI-5, C-310a/b  |
| 3.11 | 2 (simulate, notes, DORA), `promo.sh` x3                                                        | ok | ok | ok |                  |

What Level 3 showed, in the new comment layout:

- Every merge job of the fork ran the linked branch (`sfdx-hardis 8.15.0 (link)` in the logs of the
  override Pull Requests #48 and #62, and of the first JWT jobs into `preprod` and `main`).
- **How to merge** said **Squash and merge** on every User Story and configuration branch (#63, #64,
  #69, #74, #82, #86) and **merge commit, never squash** on every promotion (#70, #72, #73, #75, #83,
  #87, #88, #89), on the promotion branch #84 and on the retrofits #76 and #85, with the reason the
  labs give.
- Lab 3.3: `FULL + Quick Deploy`, *Components: 59 deployed*, the `[NoOverwrite]` line; the comment of
  the failed US-062 deployment exactly as the lab quotes it (**❌ Deployed to `integration`, but an
  action failed after the deployment**, the output once, the two actions not run), the Actions
  verdict **In integration: ❌ 1 failed · ⏸️ 2 waiting**, then ✅ / ↪️ moved to #67 / ✅.
- Lab 3.5: the promotion check red on the deliverability step (once C-RESET was worked around), then
  green with the ticked checklist, *🕒 7 after the merge* and *Runs after the merge only*, the
  🛡️ fold counting the remote site setting, and the deployment log line *Type RemoteSiteSetting: 1
  item(s) skipped because they already exist in the target org*.
- Labs 3.6 and 3.7: the first JWT logins (`sf org login jwt ... preprod.key` / `main.key`), checks red
  on the deliverability step in `preprod` and `main` as the lab says, then green; the hotfix
  deployment comment **✅ Deployed to `main`**, *Full Quick Deploy*, *Already run during the
  validation*, which are the three pills of `github-pr-deployed`.
- Lab 3.8 on the released image: the four jobs green, `ActiveScratchOrgs` 100% (3 of 3) in the
  report, **Salesforce CLI** *Unsecured*, `AGENTS.md`, `CLAUDE.md` and `deploymentRepository` in the
  backup branch, the Lab 3.7 formula in the backup, "dubious ownership" only in comments.
- Lab 3.10: US-057 clean, US-059 conflicting on exactly the two files the runbook names with the
  blocks it describes, US-061 clean; the check red naming those two files; green after the
  resolution with *carrying 3 Pull Request(s) declared in its description*; `helios-preprod` with
  Gate Code, Supplier and Awaiting Parts, without Warranty Years and Scaffolding Required; a retrofit
  with 0 changed files. In Lab 3.11 the promotion into `preprod` merged without a conflict and
  brought Warranty Years; the release into `main` read 14 changed and nothing deleted.
- `check --level 3 --lab all`: 11 of 11.

## Findings

### sfdx-hardis, branch `feat/readable-pr-comments` (#2316)

- **CLI-1** `7c549a077`, **CLI-2** `affac0562`, **CLI-3** `e2643d260`, **CLI-4** `f8fdd0255`,
  **CLI-5** `3f30ec39b`, as described at the top. Each with a unit test; CLI-3 and CLI-4 with a
  line in `## [beta] (main)` of the changelog, the others covered by the line on readable comments.
  Each was seen live in the fork after the push: the job of the next check cloned the fix.
- Not fixed, observations:
  - **O-1**: the Deployment Actions comment of a green check reads "✅ Nothing to do: every
    deployment action is done or skipped" while its three post-deployment actions still wait for
    the merge (the validation comment says "🕒 3 after the merge"). True for the reader, who has
    nothing to do, and easy to misread.
  - **O-2**: after the merge of US-062's fix, which deploys the `Helios_Crew_Leads` group, the group
    of `helios-integration` had no member left, although the first action had added one. Not
    investigated: the lab's end state was reached by adding the user as step 13 says.
  - `action:create --agent` still writes `command: ""` into an Apex, data or schedule action.

### Course, branch `docs/readable-pr-comments` (#97)

- **C-RESET**: **Reset this level** starts Level 3 from a branch holding the Level 2 stories as one
  commit, and their action files keep the numbers of the maintainer's Pull Requests
  (`scripts/actions/.sfdx-hardis.26.yml`, `.28.yml`, `.37.yml`). sfdx-hardis collects
  `.sfdx-hardis.<N>.yml` for the Pull Requests a promotion carries, and no Pull Request of the fork
  has those numbers: the first promotion to `uat` came back green at once, with no deliverability
  step, no data import and no schedule, and so would `preprod` and `main`. Labs 3.5 (steps 4, 5 and
  7), 3.6 and 3.11 describe the path walked straight from Level 2, where the learner's own Level 2
  Pull Requests own the actions. Lab 3.5 now names this in its "If it goes wrong". A real fix is a
  design decision for the maintainers: for instance a step of **Reset this level** that gives those
  files an owner Pull Request in the fork. The walk did exactly that by hand (fork Pull Request #71,
  `E2E ONLY`), which reproduced the walked-straight path for the rest of Level 3.
- **C-31a**: Lab 3.1 said Save / Publish asks the target branch; it does not, New User Story
  recorded it.
- **C-32a**: Lab 3.2 said the Metadata row of US-052 reads `1 updated`; a reseeded
  `helios-integration` always differs on four more components (a tab, an LWC, two profiles), so it
  read 5.
- **C-34a**: Lab 3.4 said US-019 waits for a learner who reset into Level 3; the Level 3 start holds
  it, so Simulate my teammates answers "Nothing to commit" on both routes.
- **C-35a**: the reset path of C-RESET, in Lab 3.5's "If it goes wrong".
- **C-37a**: Lab 3.7 step 3 showed the Files changed tab of Lab 3.2 (a layout and a removed line)
  next to a text about one validation rule and one added line: new picture `github-pr-files-hotfix`.
- **C-310a**: Lab 3.10 quoted the marker comment with a leading ❌ it never prints.
- **C-310b**: Lab 3.10 step 4 said the `uat` window lists the five stories; it also lists, under
  them, the retrofit of Lab 3.7 and the configuration of Lab 3.8, which stay unticked.
- Level 1 and 2 text fixes: Lab 1.4 (the record shows two pallets), Lab 2.4 step 1 (C-24a: Create
  my lab records asks neither the lab nor the org at Level 2, both have one answer), the Star button
  of the capstones (on the right of the repository name since GitHub moved it).
- Every text fix in `labs/en/` and `labs/fr/`, with `## 2026-10-08` in the changelog.

## What this run did not cover

- **The badge claims** of the three levels: a claim opens a public issue on the shared repository.
- **The webview DOM.** Only Labs 1.2, 1.3 and 1.5 ran in the lab driver; every Level 2 and Level 3
  question was answered headless, and no pixel of a panel was clicked. The DevOps Pipeline counters
  of Labs 3.10 and 3.11 (the `uat` node counting two, then zero, User Stories waiting) were not read.
- **Fidelity 3 where a learner clicks**: Pipeline Settings (Labs 3.1, 3.8) written as files; the
  package viewer of Lab 3.5 (the no-overwrite entry written as XML); the remote site address of Lab
  3.5 (metadata deploy); branch, protections and secrets of Lab 3.1 (API); the public group and its
  member of Lab 3.3 (API); every **+ PR** chip (`gh pr create`); every merge (`gh`); every review
  comment (API); the profile field security of Lab 2.6 (API); the flows of Labs 2.2, 2.7 and 2.9
  (deployed as XML, never built in Flow Builder); the objects of Labs 2.4 and 2.9 (metadata).
- **Lab 3.8 steps 3, 5, 6 and 7**: the Monitoring Config Workbench, the report panel, the triage
  and the notification channel (no webhook) were read, not done.
- **Pull Request descriptions were not edited**, by rule of the run: the improved release notes of
  Lab 3.5 step 7, the reason above the generated text of Lab 3.10 step 7, the release notes of Lab
  3.11. `github-pr-release-notes` stays the written example of an earlier walk.
- **The reset path of Level 3** was walked with a harness Pull Request (#71) that a learner does not
  have; its actions then ran in an order a learner never gets (C-RESET), and the crew capacity batch
  failed once in `uat` (recovered as Lab 3.3 teaches).
- **An agent is not a beginner**: prose clarity was not really tested.
- The French side was edited with every English fix and checked for structure, not walked.

## Left behind

- The fork with its Pull Requests up to #89; #68 (US-020) open on purpose.
- `nvuillam/sfdx-hardis-training-monitoring-run5` next to the older monitoring repositories.
- The local CLI still linked to `C:/git/sfdx-hardis` (`sf plugins install sfdx-hardis` gives the
  release back), and the source-build override on the fork's branches.
- The External Client Apps of Lab 3.1 and 3.8 in `helios-preprod` and `helios-prod`.

# Training end to end run, 2026-10-07

The whole course walked on the **sfdx-hardis beta** `8.14.1-beta202610062235.0`, locally and in
every CI job (`ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:beta`, monitoring included), from a fork
recreated for the run. **Level 1 6 of 6, Level 2 9 of 9, Level 3 11 of 11** (Lab 1.1 read only).

The walk found **two product defects, one blocking course defect on Windows, three places where the
text disagreed with what a learner gets**, and fixed issue #93 on the way:

- **C1 (CLI, fixed)**: Apex class and Flow pages of the project documentation carried neither the
  `DO_NOT_OVERWRITE_DOC` lines nor the check. Lab 3.9 tells the learner to write a sentence on the
  scheduler page and protect it: the next generation wiped it. Proven: with the beta both written
  lines are gone after a generation, with the fix both survive.
- **C2 (CLI, fixed)**: every MegaLinter comment of the course (and of any project extending the
  shared sfdx-hardis configuration) ended on a notice about two removed linters,
  `MARKDOWN_MARKDOWN_LINK_CHECK` and `SALESFORCE_SFDX_SCANNER_APEX`.
- **C3 (CLI, already merged as #2307)**: the navigation line between the sfdx-hardis comments of the
  learner's Pull Requests was empty, and their Validation and Deployment tabs empty in the DevOps
  Pipeline: a GitHub Actions job name has spaces, and the comment key was read up to the first one.
  Found by the promotion branches end to end run of the same night, seen again live in Lab 1.6.
- **F1 (course, fixed)**: **Create my lab records** (Lab 2.4) created the 12 records, then ended on
  *Something went wrong: EPERM* on Windows: its temporary folder was still held by the `sf` process.
  No list view, no **See them in the org** link. The same cleanup in `init`, `seed` and `teardown`
  now retries and never fails a command that did its work.
- **#93 (course, fixed)**: **Claim my badge** asked to push feature branches the learner had squash
  merged and deleted on GitHub, as Lab 1.6 says to.

## Versions under test

| Thing              | Version                                                                                                       |
|--------------------|---------------------------------------------------------------------------------------------------------------|
| sfdx-hardis        | npm `8.14.1-beta202610062235.0` installed with `sf plugins install sfdx-hardis@beta` (= `main` `971ac8925`)   |
| vscode-sfdx-hardis | `main` at `7dc49a99` (v8.11.0), built from sources (`yarn compile && yarn dev`) for the lab driver            |
| Course             | `main` at `b7f5e06`, then branch `fix/training-e2e-2026-10-07`                                                |
| CI images          | `sfdx-hardis-ubuntu:beta`, whose config holds `SFDX_HARDIS_VERSION=8.14.1-beta202610062235.0` (pushed 22:50Z) |
| Published site     | `main` at `b7f5e06`, the same as the course clone when the walk started                                       |

## Environment

| Item            | State                                                                                                                                                                                                                       |
|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Fork            | `nvuillam/sfdx-hardis-training`, deleted since the last walk: recreated with `gh repo fork`, Actions banner clicked over CDP, `reset-fork.sh`, then one `E2E ONLY` beta-image commit on `main` and the three start branches |
| Orgs            | `helios-dev`, `-integration`, `-uat` (scratch), `helios-preprod`, `helios-prod` (orgfarm Developer Editions): five teardowns clean before the walk, the two Developer Editions re-seeded in Lab 3.1                         |
| Monitoring repo | `nvuillam/sfdx-hardis-training-monitoring-run4`, new and private, its workflow on the `beta` image (`E2E ONLY` commit on its `main`)                                                                                        |
| Learner clone   | `C:/git/training-run`                                                                                                                                                                                                       |
| Browser on CDP  | the dedicated `chrome-cdp-training` profile on 9222: its DevTools attach was wedged by two old tabs, closed with `/json/close`                                                                                              |

## The cheap checks

All green on `main` before the walk, and again on the branch: `universe`, `lab-crossrefs`,
`lab-command-links`, `annotate --check`, `check-commands`, `check-links`, `check-pills`,
`check-i18n`, `check-structure`, `check-translations` (0 behind after the restamp),
`start-branches --check`, site build, `check-site`, `check-nav`, `check-language-switch`.

## Screenshots

Every VS Code picture was taken again with `shots.mjs --all --kind vscode` (136) and compared pixel by
pixel with the one it replaces. All moved by less than 0.4% of their pixels, away from their pills
(the sfdx-hardis version in the side bar, badges, ids), except two:

- `backpromote-loading`: the panel now lists a fourth step while computing the plan, *Comparing
  with the sandbox*. Pill 3 framed three lines and clipped one: re-pinned over four, and Lab 2.1
  step 2 says "the lines" and what the fourth does, in English and French.
- `promotion-create-conflict`: the new capture keeps the earlier steps on screen, so the last answer
  of the conflict question and its Cancel button fall off the bottom. The previous picture, which
  shows them, was kept.

The GitHub pictures were not retaken: they still point at Pull Requests of the deleted fork, and
the comments of this walk read the same as their text (Lab 1.6 matched to the number).

## Lab by lab

Fidelity: **1** lab driver (real VS Code panel, real CLI), **2** headless panel (`panel.mjs`,
`auth.mjs`, `mon.mjs`), **3** direct `sf` / `git` / `gh` / API, **browser** the real Setup page over
CDP.

| Lab  | Fidelity                                                                           | A  | B  | C  | Findings |
|------|------------------------------------------------------------------------------------|----|----|----|----------|
| 1.1  | read only                                                                          | ok | -  | ok |          |
| 1.2  | 1 (`init` on the recreated fork)                                                   | ok | ok | ok |          |
| 1.3  | 1                                                                                  | ok | ok | ok |          |
| 1.4  | browser (field wizard, both grants), 3 (record values)                             | ok | ok | ok |          |
| 1.5  | 3 (retrieve, staging, commit), 1 (Save / Publish)                                  | ok | ok | ok |          |
| 1.6  | 3 (`gh pr create`, `prflow.sh`), CI on beta                                        | ok | ok | ok | C2, C3   |
| 1.7  | 2, browser (field, grant), 3 (list view as metadata)                               | ok | ok | ok |          |
| 2.1  | 3 (simulate, merge), 2 (`backpromote --plan` then `--auto`, the panel's calls)     | ok | ok | ok | picture  |
| 2.2  | browser (field), 3 (flow as XML), 2                                                | ok | ok | ok |          |
| 2.3  | browser (Required and its warning), 2, 3 (`action:create`)                         | ok | ok | ok |          |
| 2.4  | 3 (object, tab, app, grants as metadata), **Create my lab records**, 2 (export), 3 | ok | ok | ok | F1       |
| 2.5  | 3 (Apex edits), CI                                                                 | ok | ok | ok |          |
| 2.6  | 3 (profile grant through the API), browser (permission set), 2                     | ok | ok | ok |          |
| 2.7  | 3 (flows as XML, merge resolution), browser (grant), 2, simulate                   | ok | ok | ok |          |
| 2.8  | 3 (layout, select-all retrieve), 2 (`resetselection`)                              | ok | ok | ok |          |
| 2.9  | 3 (object, flow, grants, records), 2, simulate                                     | ok | ok | ok |          |
| 3.1  | 3 (branch, protections, config as files), 2 (`auth.mjs` x2), **seed** x2           | ok | ok | ok |          |
| 3.2  | simulate x2, 3 (line review comment)                                               | ok | ok | ok |          |
| 3.3  | log read, simulate x4, 3 (review, group, `action:run`, `set-status`)               | ok | ok | ok | T1       |
| 3.4  | simulate x2, 3 (comment)                                                           | ok | ok | ok |          |
| 3.5  | 3 (UAT address, no-overwrite entry), **publish**, `promo.sh`, 2 (notes)            | ok | ok | ok | T2       |
| 3.6  | browser (Deliverability x2), `promo.sh` x2, 2 (DORA)                               | ok | ok | ok |          |
| 3.7  | simulate, `promo.sh`, 2 (retrofit)                                                 | ok | ok | ok | T3       |
| 3.8  | 2 (`mon.mjs`), 3 (Run workflow), **publish**, CI on beta                           | ok | ok | ok |          |
| 3.9  | 2 (`project2markdown --with-history`), 3 (paragraphs)                              | ok | ok | ok | C1       |
| 3.10 | simulate x5, `promo.sh`, 2 (`promotion:create`), 3 (resolution by hand), retrofit  | ok | ok | ok |          |
| 3.11 | simulate, `promo.sh` x3, 2 (notes, DORA)                                           | ok | ok | ok |          |

What the beta changed for the course, and the course already says: a pending pre-deployment manual
action no longer stops a validation by default (#2305), and the course turns the stop back on with
`failValidationOnPendingManualActions: true`, so Labs 2.4, 3.5, 3.6 and 3.11 still go red first on
the deliverability step, as their text says. Seen in all five.

What Lab 3.8 showed on the beta image: all four jobs green, `AGENTS.md` and `CLAUDE.md` in the
backup, the Lab 3.7 hotfix in it, `ActiveScratchOrgs` at 100% (3 of 3) and **Salesforce CLI**
*Unsecured* in the report, "dubious ownership" only in the workflow's comments.

What Lab 3.10 showed: US-057 clean, US-059 conflicting on exactly the two files the runbook names,
US-061 clean; the check red naming those two files and no other; green after the resolution with
*carrying 3 Pull Request(s)*; `helios-preprod` with Gate Code, Supplier and Awaiting Parts, without
Warranty Years and Scaffolding Required; a retrofit with 0 changed files. In Lab 3.11 the `uat` into
`preprod` promotion merged without a conflict and brought the two missing fields, and the release
into `main` read `0 deleted`. Friday's DORA report ran first against `helios-dev`: the Retrofit New
User Story of Lab 3.10 had made it the default org again, which Lab 3.11 warns about. Run again
after pointing at `helios-prod`: 10 deployments a week, change failure rate 5.2%.

## Findings

### sfdx-hardis, branch `fix/training-e2e-2026-10-07`

- **C1**: `project2markdown` protects Apex and Flow pages like the others. Unit tests on the two
  helpers; proven on the learner's clone (beta wipes both written lines, the branch keeps them).
- **C2**: the shared MegaLinter configuration and the lint-only template no longer name removed
  linters.
- **C3** was found by the promotion branches run and is merged (#2307); this walk saw it live.
- Not fixed, minor: `action:create --agent` writes `command: ""` into an Apex, data or schedule
  action, which the "Under the hood" files of Labs 2.3 and 2.4 do not show.

### Course, branch `fix/training-e2e-2026-10-07` (Pull Request #94)

- **#93**: `claim.mjs` counts the heads of the fork's Pull Requests as being on GitHub. Proven on a
  clone holding squash merged and deleted branches: 5, 3 and 14 "unpushed" commits became 0, while a
  branch with real unpushed work still reports its 5.
- **F1**: `removeTempDir` in `scripts/lib/util.mjs`, used by `records`, `init`, `seed` and
  `teardown`. Proven with a process whose current directory is the folder: the plain removal throws
  EPERM, the helper does not.
- **T1**: Lab 3.3 said "a little over fifty" components; a walk deploys 60 to `integration` by then.
- **T2**: Lab 3.5's promotion notes count 17 tickets, not 16: the configuration of Lab 3.1 goes
  through its own story, US-050, since training #85.
- **T3**: the US-045 hotfix teammate committed "Cancelled installations can no longer be back-dated",
  the incident, as the message of the fix: squash merged, that line said the opposite of the change.
- The pictures above, the changelog of the day, the French side of each edit, and a restamp of the
  18 French labs whose `source_rev` the last squash merges had left behind.

## What this run did not cover

- **The badge claims**: a claim opens a public issue on the shared repository. #93 was fixed from
  its report and proven on a clone, not through a real claim.
- **The GitHub pictures** were not retaken (they point at Pull Requests of the deleted fork), and
  the Salesforce Setup pictures were not either.
- **Fidelity 3 where a learner clicks**: the Pipeline Settings edits of Lab 3.1 (written as files),
  the profile grant of Lab 2.6 (API), the flows of Labs 2.2, 2.7 and 2.9 (deployed as XML, never
  built in Flow Builder), the objects of Labs 2.4 and 2.9 (metadata), the public group of Lab 3.3
  (API), every **+ PR** chip (`gh pr create`), every merge on GitHub (`gh`).
- **The lab driver** only drives Labs 1.2, 1.3 and 1.5; it answers the questions the panel received
  and clicks no pixel.
- **An agent is not a beginner**: prose clarity was not really tested.
- The French side was checked for structure, completeness and stamps, not walked.
- The extension was the released 8.11.0 built from sources: no change to it was needed.

## Left behind

- `nvuillam/sfdx-hardis-training-monitoring-run4` (private) next to the older monitoring
  repositories: `gh` has no `delete_repo` scope.
- The fork with its 41 Pull Requests, ending on the release of Lab 3.11 into `main`.
- The beta plugin installed on the workstation, as asked: `sf plugins install sfdx-hardis` brings
  the release back.

# Training e2e report, 2026-10-06, Level 1

Level 1 walked end to end on a reset fork, with the CI jobs on the **next release**
(`sfdx-hardis-ubuntu:beta`), right after sfdx-hardis #2302 and training #89 were merged. All six
Level 1 checks pass, capstone included.

## Versions under test

| Thing              | Version                                                                                                     |
|--------------------|-------------------------------------------------------------------------------------------------------------|
| sfdx-hardis        | `main` at `1f8be0722` (#2302 merged), linked working copy, = `8.13.1-beta202610061801.0`                    |
| vscode-sfdx-hardis | `main` at `71e15799` (#558 merged), built from sources (`yarn compile && yarn dev`) for the lab driver      |
| Course             | `main` at `fff4938` (#89 merged), then branch `fix/training-e2e-2026-10-06`                                 |
| CI images          | `ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:beta`: npm beta 18:06Z, image pushed 18:14Z, so it carries #2302 |
| Released           | sfdx-hardis 8.13.0 and extension 8.10.0: neither has #2302, #2301, #2299 nor extension #553 yet             |
| Published site     | `main` at `fff4938`, the same as the course clone when the walk started                                     |

## Environment

| Item           | State                                                                                                                                                                                           |
|----------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Fork           | `nvuillam/sfdx-hardis-training`, reset with `reset-fork.sh`, then one `E2E ONLY` commit on `main` and the three `training/start-level-*` pointing both deployment workflows at the `beta` image |
| Scratch orgs   | `helios-dev`, `-integration`, `-uat` of 2026-09-24, torn down, kept by `init` and re-seeded                                                                                                     |
| `helios-prod`  | Developer Edition, Dev Hub, untouched (Level 3 only)                                                                                                                                            |
| Learner clone  | `C:/git/training-run`, cloned from the shared repository by `reset-fork.sh`                                                                                                                     |
| Browser on CDP | the dedicated `chrome-cdp-training` profile on 9222, relaunched once (see finding H1)                                                                                                           |

The first teardown of `helios-dev` failed (finding F1); the fixed teardown cleaned it on the second run.

## The cheap checks

All green on `main` before the walk: `universe --check`, `lab-crossrefs --check`,
`lab-command-links --check`, `check-commands`, `check-links`, `check-pills`, `check-i18n`, site build,
`check-site`, `check-nav`, `check-language-switch`. Green again on the branch, plus `check-structure`
and `check-mobile`.

## Labs

| Lab | Fidelity                                                                           | A  | B  | C      | Findings  |
|-----|------------------------------------------------------------------------------------|----|----|--------|-----------|
| 1.1 | read only (tools already installed); live download pages partly checked over HTTP  | ok | -  | ok     |           |
| 1.2 | 1 (`init`); step 7 (GitHub OAuth in the extension) not driven                      | P1 | ok | P2, P3 | P1 P2 P3  |
| 1.3 | 1 (`work:new`), then 2 for the taken-name case                                     | F2 | ok | P4     | F2 P4     |
| 1.4 | browser over CDP (field wizard, both permission set grants), 3 (record values)     | R1 | ok | ok     | R1        |
| 1.5 | 3 (retrieve, staging, commit), 1 (Save / Publish)                                  | P1 | ok | P5     | P1 P5     |
| 1.6 | 3 (`gh pr create`, `prflow.sh`), real CI on the `beta` image                       | P1 | ok | F3, F4 | F3 F4     |
| 1.7 | 2 (`work:new`, `work:save`), browser (field, grant), 3 (list view as metadata, PR) | ok | ok | ok     | O-a again |

`check --level 1 --lab all`: 6 of 6.

## What the walk proved about the next release

- **sfdx-hardis #2302 on the course itself.** The validation comment of the fork's PR #44 read
  `Simulated deployment: 36 components validated against the org, 7 would change (1 created,
  6 updated, 0 deleted, 29 unchanged)`, the very numbers Lab 1.6 quotes, with the per-type table
  (CustomField 1 created) and `xls/deployment-components.xlsx` in the **sfdx-hardis reports**
  artifact, as training #89 now says in Labs 1.6 and 3.2. The deployment comment read `7 changed`,
  and the Quick Deploy result listed its components, so its table showed too.
- **sfdx-hardis #2301 (work:new never reuses a branch).** A second New User Story named
  `US-014-panels-required` printed *Branch ... already exists, here or on the remote ... choose
  another name* and asked again; cancelling left the clone on the story branch.
- **simple-git v4 (#2299 / #556)**: `init`, `work:new`, `work:save` (fetch, branch, commit, push) and
  the extension panels all ran on it, locally and in CI.

## Findings

**F1, course, fixed: Clean up a training org hid its own failures.** On `helios-dev` the CLI's DNS
check of the scratch org domain failed for a moment (`DomainNotFoundError: Parsing --target-org`).
The teardown runs its cleanup steps quietly and never read why one failed: two flows stayed active,
the public group step printed "No public group to remove", and the destructive deploy then failed on
the flow versions and the objects they use, which reads like a real reference to remove by hand.
`scripts/training/teardown.mjs` now captures those `sf` calls, retries one that failed on a DNS blip,
and says "Could not ..." with the first error line when a step really fails. Proven: the same org
went clean on the next run.

**F2, course, fixed: Lab 1.3 did not cover a taken branch name** (new behaviour of sfdx-hardis #2301).
New "If it goes wrong" entry: cancel, and switch to the existing story branch from the status bar.
English and French.

**F3, course, fixed: Lab 1.6 cited the pills of the checks picture swapped.** The table said
Simulate Deployment **(3)** and Mega-Linter **(2)**; the picture draws 2 on Simulate Deployment.
`check-pills.mjs` compares sets of numbers, not which row carries which, so it cannot see this.

**F4, course, fixed: both Pull Request comment pictures of Lab 1.6** still showed the old
`Deployed components` line of a validation. Retaken from PR #44 of this walk, pills re-pinned for
the extra line of the collapsed table.

**P1, course, fixed: the fork address was glossed in nearly every paragraph** of Labs 1.2, 1.5, 1.6
and 1.7 (18 times in Level 1, 33 in the course). Level 1 keeps it at the first mention of a lab and
wherever a step sends the learner to open the fork; 11 repeats removed, English and French.
Levels 2 and 3 untouched, for their own walks.

**P2, course, fixed: `org-select-alias.png` showed a Level 2 branch** in the status bar. Retaken.

**P3, course, not fixed: `training-menu-authorization.png` shows extension v8.6.1 and a
"1 update(s) needed" banner.** It is a hand capture of a VS Code notification that the harness does
not take; retake it by hand.

**P4, course, not fixed: `pipeline-cards-level1.png` shows the story branch in the status bar** for
the New User Story step, before the branch exists. One capture serves three steps, and the two others
are right to show it; a separate capture would be needed.

**P5, course, not fixed: `source-control-retrieved--commit.png` shows the four files as `U`.** A
learner sees the layout and both permission sets as `M`. The text does not mention the letters.

**R1, release dependency: Lab 1.4 "If it goes wrong" says to update the extension** when **Open**
does not open the org. That fix is extension #553, not in the released 8.10.0: true once the
extension ships. The second way in that the lab gives works today.

**H1, harness, fixed in the runbook: a stopped CDP script stayed alive and held the attach.** Every
later `connectOverCDP` hung after *ws connected* and the run looked frozen for minutes; the user had
to ask. Runbook trap added (look for the leftover node, step log, watchdog, explicit exit), and the
field wizard's real control names recorded.

**O-a again**: the teardown leaves source tracking rows, so `helios-dev` still tracked the
`Open_Installations` list view of the last walk, and a deploy of it reported a conflict.

## What this run did not cover

- Lab 1.1 was read and its pictures checked; nothing was installed.
- Lab 1.2 step 7, signing the extension in to GitHub, is an OAuth round trip nobody drives.
- Labs 1.4 and 1.7 were done in Setup through a script driving the real pages, and the record values
  of 1.4 through Apex; the list view of 1.7 was deployed as metadata.
- Lab 1.5 and 1.7 steps 1 to 4 (Metadata Retriever, staging, commit) at fidelity 3; the lab driver
  does not replay them.
- Lab 1.6 and 1.7 Pull Requests were opened with `gh` and merged by `prflow.sh`, not clicked.
- The badge claim was not opened: it posts a public issue on the shared repository.
- The webview DOM is still not clicked by any of this (runbook section 9), and prose clarity was not
  really tested: an agent reads past what a beginner stops at.
- French: structure checks only.

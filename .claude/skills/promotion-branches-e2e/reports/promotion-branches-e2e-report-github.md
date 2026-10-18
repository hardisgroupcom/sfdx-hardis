# Promotion branches, deployment actions and org initialization: end to end test on GitHub

**Date:** 2026-10-18 (supersedes the run of 2026-10-14 on `main`)
**Why this run:** the org initialization steps and the scratch org pool changes of
`feat/org-init-steps` (hardisgroupcom/sfdx-hardis#2362, hardisgroupcom/vscode-sfdx-hardis#582),
and the first run of the new section 6septies. GitHub only.

**Repositories under test** (private, created empty for this run):

- sections 3, 4, 4bis, 6quater and 6sexies: `nvuillam/sfdx-hardis-promo-e2e-53`
- section 6septies, org initialization and scratch org pool: `nvuillam/sfdx-hardis-promo-e2e-57`
  (the complete run, 37 OK), after `-54` (`OI_RUN=2`), the pool groups alone on `-55`, and `-56`
  (a Dev Hub with no free active scratch org)
- `nvuillam/sfdx-hardis-promo-e2e-52`: first attempt, stopped by the workstation (see "What was
  restarted, and why")

**Salesforce orgs:** the Developer Edition org of `E2E_ORG` for the pipeline. The section 6septies
scratch orgs came from two Org Farm Dev Hubs (3 active, 6 a day each): `-54` and `-55` used
`DevHub`, the `DEVHUB` of `.env` (the first version of this report said `E2E_ORG`, wrongly), and
`-57` used the Dev Hub of `E2E_ORG`, set with `DEVHUB=<its username>`. The same section ran green on
two Dev Hubs.
**sfdx-hardis:** `feat/org-init-steps`, from `11b6fffd1` up to `3dd86e582`, through `bin/dev.js`
for sections 4 to 6sexies and `bin/run.js` (fresh `yarn compile`) for the last runs of section
6septies; `sf` linked to the same working copy for the pool refresh child processes.
**vscode-sfdx-hardis:** `feat/org-init-steps` at `bd722476`, compiled.

___

## Counts

| Section                                                                             | Checks | OK | FAIL | SKIP |
|-------------------------------------------------------------------------------------|--------|----|------|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42     | 42 | 0    | 0    |
| 6quater: gate, recovery, set-status ahead, forecast (`-53`)                         | 18     | 17 | 0    | 1    |
| 6sexies: identical actions, I1 to I10 (`-53`)                                       | 21     | 20 | 0    | 1    |
| 6septies: org initialization and pool, O0 to O12 (`-57`, `E2E_ORG` Dev Hub)         | 37     | 37 | 0    | 0    |
| 6septies: org initialization and pool, O0 to O12 (`-54`, `OI_RUN=2`)                | 34     | 32 | 2    | 0    |
| 6septies: pool groups O9 to O12 alone (`-55`, `OI_GROUPS=pool`)                     | 9      | 3  | 6    | 0    |

The two FAIL lines of `-54` are harness defects, both fixed in `3dd86e582` and explained below.
The six FAIL lines of `-55` all follow from one scratch org creation killed by the workstation
(`exited with code 3221225794`), not from the product.

The SKIP lines are the developer org groups (6quater D, 6sexies I7 and I8): `DEV_ORG` is not set in
the `.env` of this computer.

___

## Results by group

### Sections 3, 4 and 4bis (`-53`): 42 OK

Same 42 checks as on 2026-10-14, all green: the six stories, the four promotions, the hotfix, the
release notes, the retrofit, and a DevOps Pipeline check before and after every promotion
operation. The deployment actions changes of this branch (three types refused as deployment
actions, Apex script paths now quoted, data workspaces resolved one way) did not move any log.

### Section 6quater, deployment actions (`-53`): 17 OK, 1 SKIP

A1 to A5 (manual action gate, draft not stopped), B (failed action retried with `action:run`,
`set-status`), C1 to C5 (marked ahead in uat, forecast, promotion deployment) all OK. D skipped
(`DEV_ORG`).

### Section 6sexies, identical actions (`-53`): 20 OK, 1 SKIP

I1 to I6, I9 and I10 OK. I7 and I8 skipped (`DEV_ORG`).

### Section 6septies, org initialization and the scratch org pool (`-54`, then `-55`)

| Id    | Expected                                                                                                                                                                                                                                                                                   | Result                                                                                                                                                                                                        |
|-------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| O0    | `hardis:config:org-init --json` builds the four steps of `initPermissionSets` and `scratchOrgInitApexScripts`, all at pool fill                                                                                                                                                            | OK                                                                                                                                                                                                            |
| O1    | `action:create --type deploy-sources` refused                                                                                                                                                                                                                                              | OK                                                                                                                                                                                                            |
| O2    | A step whose Apex script does not exist stops `scratch:create` before `sf org create scratch`                                                                                                                                                                                              | OK                                                                                                                                                                                                            |
| O3    | `hasSampleData: "yes"` stops `scratch:create` the same way; no scratch org requested by O2 and O3                                                                                                                                                                                          | OK                                                                                                                                                                                                            |
| O4    | The 13 steps in order, `13 succeeded`, the disabled and sandbox-only steps never run                                                                                                                                                                                                       | OK                                                                                                                                                                                                            |
| O4a   | install-packages: `fan_astrea` installed                                                                                                                                                                                                                                                   | FAIL in the harness (a tooling query that filters on `SubscriberPackage.NamespacePrefix`, which Salesforce refuses). Checked by hand on the pool org of `-54`: `fan_astrea Summer2021` installed. Query fixed |
| O4b-l | deploy-sources, assign-permission-sets, apex, data (SFDMU), command (no `--target-org`), run-batch, schedule-batch, the custom function `e2eMarker`, publish-community (the site), the fetch-only step on a new org, nothing from the disabled and sandbox-only steps: one SOQL query each | OK, 11 of 11                                                                                                                                                                                                  |
| O5    | `hardis:org:init --steps apex-marker` runs that step alone, the marker is there twice                                                                                                                                                                                                      | OK                                                                                                                                                                                                            |
| O6    | An allowed failure goes on, the next failure stops, the step after it is `Not run` and left no record                                                                                                                                                                                      | OK                                                                                                                                                                                                            |
| O7    | `hardis:org:init` refuses the production org                                                                                                                                                                                                                                               | OK                                                                                                                                                                                                            |
| O8    | The scratch org of O4 deleted                                                                                                                                                                                                                                                              | OK                                                                                                                                                                                                            |
| O9    | `hardis:scratch:pool:create --agent` creates the GitHub issue dashboard                                                                                                                                                                                                                    | OK                                                                                                                                                                                                            |
| O10   | `hardis:scratch:pool:refresh` fills the pool: the steps at pool fill ran (6 markers, permission set, site), the fetch-only step did not                                                                                                                                                    | OK (`-54`)                                                                                                                                                                                                    |
| O11   | From a fresh clone, `scratch:create` takes that org, runs only the fetch-only step and resets the source tracking                                                                                                                                                                          | OK (`-54`): `Fetched org ... from pool`, `Step 1/1`, `Resetting the source tracking`                                                                                                                          |
| O11a  | The org taken is the org of the pool                                                                                                                                                                                                                                                       | FAIL in the harness: an org taken from the pool is saved in the user config by alias only, and the section looked for its username there. Fixed (the username is read from the log)                           |
| O11b  | The fetch-only step ran when the org was taken                                                                                                                                                                                                                                             | OK (`-55`, on a new org since the pool was empty)                                                                                                                                                             |
| O11c  | Pull and push previews empty right after the fetch                                                                                                                                                                                                                                         | OK (`-57`)                                                                                                                                                                                                    |
| O11d  | A change made in the org afterwards shows in the pull preview                                                                                                                                                                                                                              | OK (`-55`, on a new org)                                                                                                                                                                                      |
| O12   | The pool empty, its history holds the org taken                                                                                                                                                                                                                                            | OK (`-54`)                                                                                                                                                                                                    |

Every step type ran green in a real scratch org twice: in O4 of `-54`, and in an orphaned run of the
first `-54` attempt whose fetch found the pool empty and created an org (13 succeeded, exit 0).

___

## What the run found

Two product defects, both older than this branch, both fixed and pushed:

- **`hardis:scratch:create` without `devHubAlias`** (`e415a2978`): the scratch org was requested
  with `--target-dev-hub undefined`, so a project that does not set `devHubAlias` (and the pool
  refresh, which runs `scratch:create --pool`) could not create any scratch org. It now uses the Dev
  Hub the command resolved: `--target-dev-hub`, else the default Dev Hub of `sf`.
- **`hardis:scratch:pool:refresh` on Windows** (`22c2d6887`): the refresh spawned the path
  `which('sf')` returns, `sf.cmd` on Windows, without a shell: Node refuses that (`spawn EINVAL`),
  so the pool could not be filled from a Windows computer. It now spawns `sf` through a shell there.

Three harness defects, fixed in the skill: the test package needs Enhanced Notes in the scratch org
definition, the user config is a dotfile (`config/user/.sfdx-hardis.<user>.yml`), and the two
findings of O4a and O11a above. Each one is written in the traps of runbook section 6septies.

The source tracking reset of an org taken from the pool was designed during this work (deleting
the `SourceMember` records was tried, works, and is slow on a large project) and proven by hand on a
throwaway scratch org before the run: after `sf project reset tracking` from a fresh copy of the
project, the retrieve and deploy previews were empty, and a later change in the org showed in the
retrieve preview.

___

## What this run did not cover

- **Sandboxes.** `hardis:org:create` (sandbox creation) and `hardis:org:init` on a sandbox are not
  exercised: no sandbox can be created from the Developer Edition org. The sandbox-only step is only
  proven not to run on a scratch org.
- **The VS Code Org Initialization panel** is covered by its UI suite against a mocked CLI, not
  clicked against a real org.
- **Sections 6, 6bis, 6quinquies, 4ter, 5bis, 5quater, 7bis and 7ter** were not run: this run
  targeted the changes of the branch. Their last results are the ones of 2026-10-14 on `main`.
- **The developer org groups** (6quater D, 6sexies I7 and I8): `DEV_ORG` not set.
- GitLab, Azure DevOps and Bitbucket Cloud: section 6septies has never run there.

___

## What was restarted, and why

- **`-56` and `-57`**: `-56` ran on `DevHub`, whose 3 active scratch orgs were taken (two by other work,
  one leaked by `-55`, deleted since): every creation stopped on `LIMIT_EXCEEDED`. `-57` ran the whole
  section on the `E2E_ORG` Dev Hub, with `bin/run.js`: 37 OK, the pool fill and the developer fetch
  included, and O11c covered for the first time.

- **`-52`**: the workstation was short on memory (other VS Code windows and another Claude session
  running a training end to end test) and the run was stopped in section 6quater, after its story S8
  was merged into integration. The replay of 6quater could not create its stories on the dirty
  working copy, and 6sexies promoted nine stories instead of eight. Restarted from scratch on `-53`.
- **First `-54` attempt**: stopped again in section 6septies; `bin/dev.js` lost its esbuild service
  (`The service was stopped`) under memory pressure. Its section script kept running as an orphan
  and still ran the 13 steps green on a new org. Replayed with `bin/run.js` and `OI_RUN=2`.
- **`-55`**: the pool groups alone, to cover O11c; stopped by a scratch org creation killed by the
  workstation (`3221225794`).

___

## Left behind

- Repositories `-52` to `-55` on GitHub (the `gh` token has no `delete_repo` scope): delete them
  with `gh repo delete nvuillam/sfdx-hardis-promo-e2e-<n> --yes` after
  `gh auth refresh -h github.com -s delete_repo`.
- No scratch org of the run is active on the Dev Hub.

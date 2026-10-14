# Promotion branches, deployment actions and backpromote: end to end test on Azure DevOps

**Date:** 2026-10-14 (supersedes the run of 2026-10-10 on `feat/pr-modal-job-artifacts`)
**Why this run:** regression check of the four providers on `main` after the release of 8.18.0
(the scratch org pool in the git provider, hardisgroupcom/sfdx-hardis#2343). Azure DevOps third,
after GitHub and GitLab.

**Repositories under test** (private, created empty for this run, in the project
`nicolasvuillamy/tests-sfdx-hardis`):

- sections 3, 4, 4bis, 4ter, 5bis, 5quater, 6, 6quater, 6sexies and 7bis: `sfdx-hardis-promo-e2e-az-11`
  (Pull Requests #251 to #308: ids are unique per organization on Azure DevOps)
- backpromote (Beta), section 6bis: `sfdx-hardis-promo-e2e-az-12` (stopped at B4, see "What was
  restarted") then `sfdx-hardis-promo-e2e-az-13`
- real CI with the branch linked by `sf plugins link`, section 6quinquies: `sfdx-hardis-promo-e2e-ci-az-7`
  (`AZURE_E2E_CI_TOKEN=system`: the jobs post as the Build Service identity)

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub). Scratch orgs
`promo-e2e-dev` (also `DEV_ORG` of 6quater and 6sexies) and `promo-e2e-dev2`: the ones of
2026-10-10 for the sections, which Salesforce deleted during the first backpromote run (they had
expired on 10-12), then two new ones created by the setup of `az-13`.
**sfdx-hardis:** `main` at `e8caccee6` (8.18.0), through `bin/dev.js` for the simulators, cloned and
linked by the real CI jobs.
**vscode-sfdx-hardis:** `main` at `ef21b5ab`, compiled with `yarn compile`.

___

## Counts

| Section                                                                             | Checks                            | OK  | FAIL | Not covered                           |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|---------------------------------------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42  | 0    |                                       |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 47  | 0    |                                       |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21  | 0    |                                       |
| 6sexies: identical actions, I1 to I10                                               | 24                                | 24  | 0    |                                       |
| Visual fixtures (VE, VG)                                                            | 2                                 | 2   | 0    |                                       |
| 6bis: backpromote B0 to B16, C1 to C4 (`az-13`)                                     | 63                                | 63  | 0    |                                       |
| 6quinquies: real CI, W0 to W9, X1, X2 (`ci-az-7`)                                   | 22                                | 21  | 0    | 1 SKIP by design (W8)                 |
| 4ter: single Pull Request window, simulated jobs (`az-11`)                          | 48 Pull Requests                  | 48  | 0    |                                       |
| 4ter: single Pull Request window, real CI jobs (`ci-az-7`, X1)                      | 1                                 | 1   | 0    |                                       |
| 5bis: comment audit (`az-11`)                                                       | 1238 checks over 55 Pull Requests | all | 0    |                                       |
| 5quater: visual check of the comments (`az-11`, fixtures included)                  | 12 types                          |     |      | 12: Chrome logged out of Azure DevOps |
| 5quater: visual check (`az-13`, backpromote)                                        | 1 type                            |     |      | 1: same sign-in page                  |
| 7bis: single place in the diagram (`az-11`)                                         | 1                                 | 1   | 0    |                                       |
| 7ter: flag-off A/B against `origin/main`                                            | see "What this run did not cover" |     |      |                                       |

No SKIP line in sections 6quater and 6sexies: the developer org groups ran, two hours before the
org died. No `getaddrinfo` or fork failure in the Azure outputs.

Wall clock: sections 1 h 15 min, fixtures 2 min, post checks 10 min, backpromote 37 min on `az-13`
(setup 3 min 14 s with the creation of two scratch orgs, steps 31 min 33 s; the stopped `az-12`
took 7 min), real CI 1 h 52 min (one free parallel job: a policy build queues behind a deployment
build).

___

## Results by group

### Sections 3, 4 and 4bis (`az-11`): 42 OK

### Section 6, edge cases: 47 OK

### Section 6quater, deployment actions: 21 OK

### Section 6sexies, identical actions: 24 OK

### Section 6bis, backpromote (`az-13`): 63 OK

The first run (`az-12`, 06:03) passed B0 to B3 (11 checks) and failed B4 and everything after it:
the deploy to `promo-e2e-dev` and every SOQL answered `INVALID_CROSS_REFERENCE_KEY: invalid cross
reference id`. The scratch org, created on 2026-10-10 with a one day duration and kept answering
for two days past its expiry (Salesforce deletes lazily), was gone: `sf org display` said
`Deleted`. The GitLab backpromote had used it until 04:35 without a hitch. Environment, not
product. The run was stopped at B5, both dead orgs logged out, and the section ran again on
`az-13`, whose setup created two new scratch orgs.

On `az-13`, B0 to B16 and C1 to C4 pass in 31 minutes: the two new scratch orgs were created by the
setup in 3 minutes (`ActiveScratchOrgs` had two free slots once the dead ones were logged out,
`DailyScratchOrgs` 6 of 6). B2 ran as `developer-edition.json`; `refused-production.json` stays not
covered. The Backpromotes comment of the first story was dumped (11 Pull Requests) but not
pictured: the same sign-in page as above.

### Section 6quinquies, real CI on Azure Pipelines (`ci-az-7`): 21 OK, 1 SKIP

15 builds, all recorded "real CI" in `ci-jobs.tsv`, none simulated. 493 seconds queued and 5728
seconds run in total, 1 hour 52 minutes of wall clock from 05:14 to 07:06. Every build runs the
link step (clone, `yarn install`, `tsc`, `sf plugins link` with `sudo`), which is most of the six
and a half minutes each takes. One build waited 400 seconds: the policy build of the second
identical-actions story queued behind the first one, the free tier having one parallel job. W8
(the missing `safe.directory` line) is GitHub only, SKIP by design. X1 (the Pull Request window on
the real comments, completed Pull Requests included) and X2 (the DevOps Pipeline) pass. Both
pipelines passed the preview call before any build ran; the Build Service identity posted the
comments (`AZURE_E2E_CI_TOKEN=system`).

Two API polls of the script got no answer during W9 (`curl: (35) Recv failure: Connection was
reset`, then `getaddrinfo() thread failed to start`): the parser printed a Python traceback and the
poll loop went on, no check was affected.

### Section 5quater, visual check: not covered

The 12 comment types of `az-11` were all reported "comment not found on the page": every page the
check reached was a Microsoft sign-in page (`login.microsoftonline.com`,
`spsprodweu4.vssps.visualstudio.com/_signin`). The Chrome profile of the e2e checks (port 9222) is
logged out of Azure DevOps since the run of 2026-10-10; the GitHub and GitLab pictures need no
login and were taken. Nobody could log in during an unattended night run. The comment audit
(1238 checks) and the Pull Request window check (48 of 48) read the same comments through the API
and pass, so the content is right; how Azure DevOps draws it was last seen on 2026-10-10.

___

## What the run found

| Finding                                                                                                                                                                                                                                     | Status                                                                                                                                  |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `ci-workflows-prepare.cjs` refused `azure-pipelines-checks.yml` of 8.18.0: "expected one job, found 2" (the scratch org tests job): the real CI run died in 30 s                                                                            | test script defect, fixed during the run: the job is left out like the MegaLinter one                                                   |
| The first cut of that fix left the steps of the removed job inside the kept one (an Azure job body holds blank lines): a check now refuses a kept job that runs `hardis:scratch:create`                                                     | test script defect, fixed before any repository existed                                                                                 |
| An expired scratch org keeps answering for days, then dies in the middle of a run with `INVALID_CROSS_REFERENCE_KEY`                                                                                                                        | environment; runbook trap added                                                                                                         |
| The e2e Chrome profile is logged out of Azure DevOps: the visual check reports every comment "not found" and a sign-in URL                                                                                                                  | environment; runbook trap added, preflight to extend                                                                                    |
| The wording findings of the GitHub and GitLab readings (Pull Request lists not in numeric order, "Deployment failed" banner, done-only "To do by hand" section, "Pull Request(s)", off-by-one counts) could not be checked on pictures here | not covered on Azure; the audit saw the same comment texts. Three of them are fixed on `fix/pr-comment-wording` (see the GitHub report) |

No product defect found on Azure DevOps.

___

## What this run did not cover

- **Section 7ter, the flag-off A/B against `origin/main`.** The branch under test is `main`
  itself. Not run; the last proof is the one of 2026-10-09 (0 differing lines).
- **The visual check** (see above): not one picture of an Azure DevOps comment this run.
- **The visual check and the comment audit of the real CI comments** (`ci-az-7`): X1 reads them
  through the modal calls only.
- `refused-production.json` (B2 against a real production org), the terminal prompts of B17, the
  Backpromote panel of VS Code, the Code Quality tab of the Pull Request window (no MegaLinter
  comment is posted by the run), the Flow diff comment (no story holds a Flow).
- The known gaps of the skill stay: no Jenkins, no Gitea, no Bitbucket Server, no production org,
  no real sandbox (scratch orgs stand in for developer sandboxes), VS Code panels are checked
  through the extension's compiled code and not by clicks.

___

## What was restarted, and why

- **The real CI section, once.** The first start (02:58, `ci-az-7` picked but never created) died
  in the YAML self-check of the prepare script; the second (05:14, same name, the first one had
  created nothing) ran.
- **The backpromote section, once.** `az-12` lost its scratch orgs at B4 (see above); `az-13` ran
  with new ones. The sections and the post checks of `az-11` ran once, end to end.

___

## Left behind

Repositories `sfdx-hardis-promo-e2e-az-11`, `az-12` (three stories and a broken backpromote), `az-13`
and `ci-az-7` in `nicolasvuillamy/tests-sfdx-hardis`, and the two new scratch orgs (one day). Next
free numbers: `az-14`, `ci-az-8`. Work folders: `%TEMP%/e2e-1014/promo-e2e-azure*`,
`promo-e2e-bp-azure-1*` (the stopped run), `promo-e2e-bp-azure*`, `promo-e2e-ci-azure*`.

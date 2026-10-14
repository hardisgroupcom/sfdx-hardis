# Promotion branches, deployment actions and backpromote: end to end test on Bitbucket Cloud

**Date:** 2026-10-14 (supersedes the run of 2026-10-10 on `feat/pr-modal-job-artifacts`)
**Why this run:** regression check of the four providers on `main` after the release of 8.18.0
(the scratch org pool in the git provider, hardisgroupcom/sfdx-hardis#2343). Bitbucket Cloud last,
after GitHub, GitLab and Azure DevOps.

**Repositories under test** (private, created empty for this run, in the workspace `sfdxhardistest`,
project `TES`):

- sections 3, 4, 4bis, 4ter, 5bis, 5quater, 6, 6quater, 6sexies and 7bis: `sfdx-hardis-promo-e2e-bb-10`
- backpromote (Beta), section 6bis: `sfdx-hardis-promo-e2e-bb-11`
- real CI with the branch linked by `sf plugins link`, section 6quinquies: `sfdx-hardis-promo-e2e-ci-bb-6`

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub). Scratch orgs
`promo-e2e-dev` (also `DEV_ORG` of 6quater and 6sexies) and `promo-e2e-dev2`: the two created at
06:16 by the Azure backpromote setup, after Salesforce deleted the ones of 2026-10-10 (see the Azure
report). Bitbucket is the only provider whose whole run used the new orgs.
**sfdx-hardis:** `main` at `e8caccee6` (8.18.0), through `bin/dev.js` for the simulators, cloned and
linked by the real CI jobs.
**vscode-sfdx-hardis:** `main` at `ef21b5ab`, compiled with `yarn compile`.

___

## Counts

| Section                                                                             | Checks                            | OK  | FAIL | Not covered                        |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|------------------------------------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42  | 0    |                                    |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 47  | 0    |                                    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21  | 0    |                                    |
| 6sexies: identical actions, I1 to I10                                               | 24                                | 24  | 0    |                                    |
| Visual fixtures (VE, VG)                                                            | 2                                 | 2   | 0    |                                    |
| 6bis: backpromote B0 to B16, C1 to C4 (`bb-11`)                                     | 63                                | 63  | 0    |                                    |
| 6quinquies: real CI, W0 to W9, X1, X2 (`ci-bb-6`)                                   | 22                                | 21  | 0    | 1 SKIP by design (W8)              |
| 4ter: single Pull Request window, simulated jobs (`bb-10`)                          | 51 Pull Requests                  | 51  | 0    |                                    |
| 4ter: single Pull Request window, real CI jobs (`ci-bb-6`, X1)                      | 1                                 | 1   | 0    |                                    |
| 5bis: comment audit (`bb-10`)                                                       | 1142 checks over 55 Pull Requests | all | 0    |                                    |
| 5quater: visual check of the comments (`bb-10`, fixtures included)                  | 12 types                          |     |      | 12: Chrome logged out of Bitbucket |
| 5quater: visual check (`bb-11`, backpromote)                                        | 1 type                            |     |      | 1: same, logged out                |
| 7bis: single place in the diagram (`bb-10`)                                         | 1                                 | 1   | 0    |                                    |
| 7ter: flag-off A/B against `origin/main`                                            | see "What this run did not cover" |     |      |                                    |

No SKIP line in sections 6quater and 6sexies: the developer org groups ran on the new scratch org.
One `getaddrinfo() thread failed to start` on a `curl` poll of section 6 (group g5, after check 46):
the parser printed a traceback and the poll went on, no check was affected.

Wall clock: sections 1 h 39 min (the slowest of the four: the validation median is 57 s against
50 on GitLab, and one `edge-full-merge` validation took 375 s), fixtures 4 min, post checks 12 min,
backpromote 38 min (setup 7 min 42 s, steps 30 min), real CI 1 h 13 min (04:01 to 05:14, in
parallel with the GitLab sections and backpromote). The whole provider ran from 06:51 to 09:24.

___

## Results by group

### Sections 3, 4 and 4bis (`bb-10`): 42 OK

### Section 6, edge cases: 47 OK

### Section 6quater, deployment actions: 21 OK

### Section 6sexies, identical actions: 24 OK

### Section 6bis, backpromote (`bb-11`): 63 OK

B0 to B16 and C1 to C4 in 30 minutes on the scratch orgs created at 06:16. B2 ran as
`developer-edition.json`; `refused-production.json` stays not covered. The Backpromotes comment of
the first story was dumped (11 Pull Requests) but not pictured: the e2e Chrome profile is logged
out of Bitbucket.

### Section 6quinquies, real CI on Bitbucket Pipelines (`ci-bb-6`): 21 OK, 1 SKIP

15 pipelines, all recorded "real CI" in `ci-jobs.tsv`, none simulated: the build minutes fallback
never kicked in. 71 build minutes spent (3 to 6 a pipeline), 229 seconds queued and 3854 seconds run
in total, 1 hour 13 minutes of wall clock. The expected failures failed (the gate on C1, the flaky
command of C1, the gate of the promotion to uat) and the re-runs passed. W3 proves that a Bitbucket
draft (the `draft` flag of the API, no "draft" in the title) is warned about and not stopped. W8
(the missing `safe.directory` line) is GitHub only, SKIP by design. X1 (the Pull Request window on
the real comments, merged Pull Requests included) and X2 (the DevOps Pipeline) pass. One `curl`
poll got `getaddrinfo() thread failed to start` at 05:02, retried by the loop.

This section ran first, at 04:01, after a first start at 02:58 died in the YAML self-check of the
prepare script (see "What the run found").

### Section 5quater, visual check: not covered

The 12 comment types of `bb-10` were all reported "comment not found on the page". The page the
check reached is the Pull Request URL itself, but what the e2e Chrome profile (port 9222) sees
there is "404 Repository not found": it is logged out of Bitbucket, and a private repository answers
404 to an anonymous visitor. The same profile took 12 Bitbucket pictures on 2026-10-10. Nobody
could log in during an unattended run. The comment audit (1142 checks) and the Pull Request window
check (51 of 51) read the same comments through the API and pass, so the content is right; how
Bitbucket draws it (raw HTML shown as text, the known trap) was last seen on 2026-10-10.

___

## What the run found

| Finding                                                                                                                                                                                                                                     | Status                                                                                                                                                    |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `ci-workflows-prepare.cjs` refused `bitbucket-pipelines.yml` of 8.18.0: "the pull request pipeline is not one single step" (the scratch org tests step): the real CI run died in 30 s                                                       | test script defect, fixed during the run: the step is left out like the MegaLinter one, and a check refuses a kept step that runs `hardis:scratch:create` |
| The e2e Chrome profile is logged out of Bitbucket (and of Azure DevOps): the visual check reports every comment "not found"                                                                                                                 | environment; runbook trap added, preflight to extend                                                                                                      |
| The wording findings of the GitHub and GitLab readings (Pull Request lists not in numeric order, "Deployment failed" banner, done-only "To do by hand" section, "Pull Request(s)", off-by-one counts) could not be checked on pictures here | not covered on Bitbucket; the audit saw the same comment texts. All of them are fixed on `fix/pr-comment-wording` (see the GitHub report)               |

No product defect found on Bitbucket Cloud.

___

## What this run did not cover

- **Section 7ter, the flag-off A/B against `origin/main`.** The branch under test is `main`
  itself. Not run; the last proof is the one of 2026-10-09 (0 differing lines).
- **The visual check** (see above): not one picture of a Bitbucket comment this run.
- **The visual check and the comment audit of the real CI comments** (`ci-bb-6`): X1 reads them
  through the modal calls only.
- `refused-production.json` (B2 against a real production org), the terminal prompts of B17, the
  Backpromote panel of VS Code, the Code Quality tab of the Pull Request window (no MegaLinter
  comment is posted by the run), the Flow diff comment (no story holds a Flow).
- The known gaps of the skill stay: no Jenkins, no Gitea, no Bitbucket Server, no production org,
  no real sandbox (scratch orgs stand in for developer sandboxes), VS Code panels are checked
  through the extension's compiled code and not by clicks.

___

## What was restarted, and why

- **The real CI section, once.** The first start (02:58, `ci-bb-6` picked but never created) died in
  the YAML self-check of the prepare script; the second (04:01, same name) ran.
- **The sections started late, not restarted.** The first sections chain was stopped before
  Bitbucket (its scratch orgs had just died under the Azure backpromote); Bitbucket started at
  06:51 in a second chain, with the new orgs. Its sections, post checks and backpromote then ran
  once, end to end.

___

## Left behind

Repositories `sfdx-hardis-promo-e2e-bb-10`, `bb-11` and `ci-bb-6` in `sfdxhardistest`, and the two
scratch orgs (one day, created 06:16). Next free numbers: `bb-12`, `ci-bb-7`. Work folders:
`%TEMP%/e2e-1014/promo-e2e-bitbucket*`, `promo-e2e-bp-bitbucket*`, `promo-e2e-ci-bitbucket*`.

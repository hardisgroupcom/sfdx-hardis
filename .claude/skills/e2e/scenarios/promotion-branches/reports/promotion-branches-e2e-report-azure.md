# Promotion branches, deployment actions and backpromote: end to end test on Azure DevOps

**Date:** 2026-10-31 (supersedes the run of 2026-10-14)
**Why this run:** regression check of `main` after the release of 8.21.0 (detectManualCherryPicks,
#2417; NO_DELTA keyword matching, #2431). Azure DevOps third, after GitHub and GitLab.

**Repositories under test** (private, created empty for this run, in the project
`nicolasvuillamy/tests-sfdx-hardis`):

- sections 3 to 7bis: `sfdx-hardis-promo-e2e-az-14`. Sections 4 and 6 ran again on
  `sfdx-hardis-promo-e2e-az-16`, see "What was started again".
- backpromote (Beta), section 6bis: `sfdx-hardis-promo-e2e-az-17` (`az-15` stopped by the memory
  shortage of the workstation)
- real CI, section 6quinquies: `sfdx-hardis-promo-e2e-ci-az-9` (`ci-az-8` stopped on a full agent
  disk, see "Found")

**Salesforce org:** the Developer Edition org of `E2E_ORG`; scratch orgs `promo-e2e-dev` and
`promo-e2e-dev2` from `DevHub`, shared with the GitHub and GitLab runs.
**sfdx-hardis:** `main` at `da92636cb` (8.21.0), `bin/dev.js` for the simulators, cloned and linked by
the real CI jobs. **vscode-sfdx-hardis:** `main` at `5ed4c6d4`.

___

## Counts

| Section                                                  | Checks                            | OK  | FAIL | Not covered                           |
|----------------------------------------------------------|-----------------------------------|-----|------|---------------------------------------|
| 3, 4 and 4bis (`az-14`, again on `az-16`)                | 42                                | 42  | 0    |                                       |
| 6: edge cases, g1 to g6 (`az-14` and `az-16`, see below) | 47                                | 47  | 0    |                                       |
| 6quater, developer org included                          | 21                                | 21  | 0    |                                       |
| 6sexies, I1 to I10                                       | 24                                | 24  | 0    |                                       |
| Visual fixtures (VE, VG)                                 | 2                                 | 2   | 0    |                                       |
| 6bis: backpromote B0 to B16, C1 to C4 (`az-17`)          | 63                                | 63  | 0    |                                       |
| 6quinquies: real CI, W0 to W9, X1, X2 (`ci-az-9`)        | 22                                | 21  | 0    | W8 SKIP by design (GitHub only)       |
| 4ter: single Pull Request window (`az-14`)               | 47 Pull Requests                  | 47  | 0    |                                       |
| 5bis: comment audit (`az-14`)                            | 1229 checks over 53 Pull Requests | all | 0    |                                       |
| 5bis: comment audit (`az-17`, backpromote)               | 88 checks                         | all | 0    |                                       |
| 5quater: visual check (`az-14`)                          | 11 types                          | 11  | 0    | 1 flaky image load, OK on retry       |
| 5quater: visual check (`az-17`, Backpromotes comment)    | 1 type                            |     |      | not taken: Chrome closed for memory   |
| 7bis: single place in the diagram (`az-14`)              | 1                                 | 1   | 0    |                                       |
| 7ter: flag-off A/B                                       | -                                 |     |      | not run (branch under test is `main`) |

Real CI: 15 builds in Azure Pipelines, none simulated (`ci-jobs.tsv`), about 5 minutes each (the link
step is most of it). One policy build queued 299 seconds behind another (one free parallel job).

## What was started again, and why

- **6quater and 6sexies** ran a second time on `az-14` with `DEV_ORG` set to the scratch org
  `promo-e2e-dev` (`DA_RUN=2`, `IA_RUN=2`): group D and I7 pass, so do all the others again.
- **Section 6 group g2 on `az-14`**: three checks failed because the push of a story branch failed
  once on Azure and the script went on without it. The push is now retried three times
  (`promotion-edge.sh`). Sections 4 and 6 ran again on `az-16`: every check passed except 52a,
  which failed on a `sfdx-git-delta` "not a valid sha pointer" while the workstation was out of
  memory. 52a had passed on `az-14`. Between the two runs every check of section 6 passed once.
- **Backpromote**: `az-15` stopped on `getaddrinfo() thread failed to start` (memory). The e2e
  Chrome was closed to free memory and the section passed on `az-17`.
- **Real CI**: `ci-az-8` stopped at the link step: the hosted agent disk was 95 % full after
  `yarn install`, and `sf plugins link` ran `yarn install` again. The prepare script now cleans the
  yarn cache and links with `--no-install`. `ci-az-9` passed.
- **Visual check**: one comment type failed because its banner images were not loaded when the
  picture was taken. Taken again alone, it was OK.

## Found during the run

- Nothing in the product.
- **Picture review**: the same points as on GitHub and GitLab (the "Results by org" table squeezed by
  a long Note column, no navigation line on the conflicts promotion description). Azure only: the
  dates and job links wrap in the "Status by org" table, and the file lists of the conflicts
  promotion description have a stray space before the closing parenthesis (`#356 )`).
- Two API polls of the real CI script got `Recv failure: Connection was reset`; the poll loop went on.

## What this run did not cover

- The picture of the Backpromotes comment of `az-17` (the e2e Chrome was closed to free memory; the
  audit read the same comments through the API).
- 6septies (not available on Azure yet), 7ter (branch under test is `main`).
- B17 and the panels themselves, as in every run; the other known gaps of the README stand.

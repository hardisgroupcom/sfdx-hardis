# Promotion branches, deployment actions and backpromote: end to end test on GitLab

**Date:** 2026-10-04 (supersedes the run of 2026-09-13)
**Why this run:** identical deployment actions (sfdx-hardis #2271, Pull Requests sfdx-hardis #2277
and vscode-sfdx-hardis #546), with the rest of the runbook. The GitHub report of the same day holds
the details of the feature and of the checks added during the run (I8, I9, I10, W9).

**Projects under test (private, created empty for this run, on `gitlab.hardis-group.com`):**

- promotion branches, deployment actions and identical actions, sections 4, 5bis, 6, 6quater,
  6sexies, 7bis and 7ter: `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-10` (id 4489)
- backpromote (Beta), section 6bis: `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-11` (id 4490)

**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com`, shared with GitHub, and the same
two scratch orgs (`promo-e2e-dev`, `promo-e2e-dev2`).
**sfdx-hardis:** `feat/identical-deployment-actions` at `4987e4a6f`, compiled, every call through
`bin/run.js` (`bin/dev.js` for the A/B pair). No product change during the run.
**vscode-sfdx-hardis:** `feat/identical-deployment-actions` at `54e61e23`, compiled.

Every job is a real CLI call against the org with the GitLab CI variables set
(`CI_SFDX_HARDIS_GITLAB_TOKEN`, `CI_SERVER_URL`, `CI_PROJECT_ID`, `CI_MERGE_REQUEST_IID`). Merge
requests are merged with a merge commit, never squashed. Sections 3, 4, 6, 6quater and 6sexies ran
the same scripts as GitHub, with `PROVIDER=gitlab`.

**Overlap:** sections 3 and 4, and the start of 6sexies, ran while the real CI section of GitHub
(`-32`) was running in GitHub Actions against the same org. The org queues the deployments, and the
action state lives in each provider's comments, so nothing was shared but the queue; the timings of
this report are not clean. Memory got short during that overlap (Claude Code stopped two waiting
loops, not the runs).

___

## Counts

| Section                                                                             | Checks                             | OK                         | FAIL |
|-------------------------------------------------------------------------------------|------------------------------------|----------------------------|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                 | 42                         | 0    |
| 6sexies: identical actions, first pass                                              | stopped at I2, see below           | -                          | -    |
| 6sexies: identical actions, replay `IA_RUN=2` (I1 to I10)                           | 24                                 | 24                         | 0    |
| 6: edge cases, groups g1 to g6                                                      | 47                                 | 47                         | 0    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                 | 21                         | 0    |
| 5bis: merge request comment audit                                                   | 1260 checks over 61 merge requests | all                        | 0    |
| 7bis: single place in the diagram                                                   | 1                                  | 1                          | 0    |
| 7ter: flag-off A/B against `origin/main` (`ff693e561`), second pair                 | 5 files compared                   | `TOTAL DIFFERING LINES: 0` | 0    |
| 6bis: backpromote B0 to B16, C1 to C4                                               | 63                                 | 63                         | 0    |

___

## Identical deployment actions (section 6sexies)

Replay stories: SA !22, SB !23, SW !24, SP !25, SX !26, SY !27, SF !28, SC !29, promoted together to
uat by PI !30; SD !31 promoted alone by PD !32; SG !33 and SH !34 promoted by PV !35. Every check gave
the same result as on GitHub: 2 real runs for SW in integration, the forecast pointing the copies at
!22, 3 real runs in the deployment of PI (SP before the deployment, SA, the repeat of SW), the copies
`success` in uat with the "Not run twice" note in their own Deployment Actions note, the retry of SF,
0 runs when uat is deployed again, the backpromote plan and run (3 real runs, the copies
`identical`), the uat branch config standing for SD (2 runs), and the validation job running the
context `all` step once for SG and recording SH (then 0 runs in the deployment).

```
[GitProvider] Pull Request scope: 9 Pull Request(s) (#22, #23, #24, #25, #26, #27, #28, #29, #30)
[DeploymentActions] Running action E2E shared step before the deployment of PR 25 (from PR #25)
[DeploymentActions] Running action E2E shared step of PR 22 (from PR #22)
[DeploymentActions] Skipping action E2E shared step of PR 23 (from PR #23): same action as E2E shared step of PR 22 (#22), run once for this deployment
[DeploymentActions] Skipping action E2E shared step of PR 24 (from PR #24): same action as E2E shared step of PR 22 (#22), run once for this deployment
[DeploymentActions] Running action E2E shared step again of PR 24 (from PR #24)
[DeploymentActions] Skipping action E2E shared step of PR 29 (from PR #29): same action as E2E shared step of PR 22 (#22), run once for this deployment
```

**The first pass was lost to the test scripts, not to the product.** Merge request !18 (SX) stayed
`checking` on GitLab for about 90 seconds after its last push, longer than the minute `gl_mr_merge`
waited: the merge was refused, the promotion of the eight stories was refused (`#18` not merged), and
every check after I2 depended on it. The run was stopped before it wrote anything to uat, !18 was
closed, `gl_mr_merge` now waits up to 3 minutes and retries the merge, and the section ran again as a
replay (`IA_RUN=2`): 24 out of 24.

**Seen without an assertion, in the full merge of group g6.** The stories of the lost first pass (!14
to !21, merged into integration) and those of the replay both reached preprod through the sync and
the full merge: 48 merge requests in one deployment. The shared step ran once for !14 and every copy
of both passes logged the copy line; the pre-deployment step of !25 was done by the one of !17, and
the command B of !27 by the identical command B of !19 (same command, other id and label, other merge
request: merged, as the identity rules say). The story writing the step twice did it in both passes,
and each of them ran its own repeat (!16 and !24): an action written twice in one merge request runs
twice, whatever other merge requests carry.

___

## What the run found

- No product defect.
- Test scripts: the GitLab mergeability wait above (fixed in `e2e-lib-gitlab.sh`, trap added to
  runbook section 8).
- The job logs name a GitLab merge request `#N` (`(from PR #22)`), as they always did: GitLab writes
  `!N`. Not changed by this run.

___

## Section 7ter, the flag-off regression check

Two pairs on `-gl-10` with `enablePromotionBranches: false`: the open feature merge request !62 into
uat, the open `uat -> preprod` merge request !63, the deployment of uat and the release notes.
`origin/main` (`ff693e561`) from the worktree `C:/tmp/sfdx-hardis-main`, the branch from the working
copy, both through `bin/dev.js`. The second pair:

```
check-feature-mr62.log: 125 lines vs 125 lines, only in A: 0, only in B: 0
check-major-mr63.log:   125 lines vs 125 lines, only in A: 0, only in B: 0
deploy-uat.log:         172 lines vs 172 lines, only in A: 0, only in B: 0
release-notes.log:       71 lines vs  71 lines, only in A: 0, only in B: 0
release-notes.md:        34 lines vs  34 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 0
```

The passes were really off: the validation of !63 has the scope `!61, !63`, the promotion !61 left
whole instead of opened into the story it carries. The flag edit of `ab-run-gitlab.sh` used to match
`true$` only, and missed the CRLF checkouts of this workstation; it now matches both and stops when the
flag is not `false` (see the GitHub report).

___

## Backpromote (Beta), section 6bis (`-gl-11`)

63 checks, all OK on the first run: B0 to B16 and C1 to C4, after the GitLab A/B, alone on the
machine. B17 (the terminal prompts) was not answered by hand.

| Backpromote call | Calls | Median (s) | Worst (s) | Worst call       |
|------------------|-------|------------|-----------|------------------|
| plan             | 16    | 21.2       | 73.4      | `bp-plan-s8`     |
| run              | 16    | 39.0       | 195.0     | `bp-run-refresh` |
| prepare          | 1     | 21.5       | 21.5      | `bp-prepare`     |

The worst run spent 148.8 seconds in the `retrieve` step, where the same step of the same call took
10.2 seconds on GitHub: a wait on the Salesforce side, as runbook section 6ter describes.

___

## What this run did not cover

- **Azure DevOps and Bitbucket.** The Azure DevOps token of `.env` answers 401 (expired), and
  Bitbucket still needs a new token: neither ran. `promotion-provider.sh` still covers GitHub and
  GitLab only.
- The real CI section (6quinquies) exists for GitHub Actions only.
- The VS Code panels are not clicked; the interactive prompts (B17, `--select-org`) are not answered.
- The four pipeline levels share one Salesforce org.
- Timings: the run overlapped with the GitHub CI section, see above.

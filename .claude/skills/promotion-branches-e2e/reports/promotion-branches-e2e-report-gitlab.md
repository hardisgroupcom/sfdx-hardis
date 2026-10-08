# Promotion branches and deployment actions: end to end test on GitLab

**Date:** 2026-10-08 (supersedes the previous GitLab run)
**Why this run:** sfdx-hardis #2316 rewrites every merge request comment the CLI writes in a new
layout. This run proves on GitLab what the GitHub run of the same day proved: the commands that read
the comments back (manual action checkbox, `action:list --with-status`, `set-status`, the forecast,
identical actions) and the extension's single Pull Request window still find everything.

**Project under test (private, created empty for this run):**
`nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-15` (id 4504) on `gitlab.hardis-group.com`, merge method
merge, squash never.

`gl-14` (id 4503) was stopped at section 4 step 11d for the network: the uat deployment of `#5`
lost its connection to Salesforce (`ConnectTimeoutError`, 10 seconds), and every later step of the
section builds on it. It also showed a product gap: the comment of that job read "There has been an
issue parsing errors, please notify sfdx-hardis maintainers". Fixed in the same Pull Request
(`469d4e31a`): a deployment stopped by a lost connection now says so and asks to run the job again.

**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (orgfarm Developer Edition).
Scratch org `promo-e2e-dev` as `DEV_ORG` of 6quater. No other org was touched.
**sfdx-hardis:** `feat/readable-pr-comments`, compiled, through `bin/run.js` (`b11193d2c` then
`469d4e31a` during the run: neither touches what the sections assert).
**vscode-sfdx-hardis:** `feat/readable-pr-comments` at `f91668cc`, compiled.

___

## Counts

| Section                                                                             | Checks                             | OK  | FAIL |
|-------------------------------------------------------------------------------------|------------------------------------|-----|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                 | 42  | 0    |
| 6: edge cases, groups g1 to g5                                                      | 44                                 | 44  | 0    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                 | 21  | 0    |
| 6sexies: identical actions, I1 to I10                                               | 24                                 | 24  | 0    |
| 4ter: single Pull Request window                                                    | 46 merge requests                  | 46  | 0    |
| 5bis: merge request comment audit                                                   | 1076 checks over 52 merge requests | all | 0    |

No product defect was found by the sections.

___

## What this run did not cover

- 6bis (backpromote) and 6quinquies (real CI): run on GitHub only this time (63/63 and 19/19).
- 7bis, the diagram rule, and 7ter, the flag-off A/B: not run on GitLab.
- The four pipeline levels share one Salesforce org, so deployment action state is keyed by org
  branch, not by distinct orgs.
- The extension webview DOM is not clicked: 4ter calls the same data functions the window calls.

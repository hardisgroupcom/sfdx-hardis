# Promotion branches, deployment actions and backpromote: end to end test on Bitbucket Cloud

**Date:** 2026-10-10 (supersedes the run of 2026-10-09 on `e2e-updates`)
**Why this run:** regression check of the four providers on `feat/pr-modal-job-artifacts`
(hardisgroupcom/sfdx-hardis#2327, the download of job artifacts), Bitbucket second.

**Repositories under test** (private, created empty for this run, workspace `sfdxhardistest`):

- sections 3, 4, 4bis, 4ter, 5bis, 5quater, 6, 6quater, 6sexies and 7bis: `sfdx-hardis-promo-e2e-bb-7`
- backpromote (Beta), section 6bis: `sfdx-hardis-promo-e2e-bb-8` (first pass), then
  `sfdx-hardis-promo-e2e-bb-9` (replay)
- real CI, section 6quinquies: **not run** (`sfdx-hardis-promo-e2e-ci-bb-5` was created and stayed empty)

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub). Scratch orgs
`promo-e2e-dev` (also `DEV_ORG` of 6quater and 6sexies) and `promo-e2e-dev2`.
**sfdx-hardis:** `feat/pr-modal-job-artifacts`, through `bin/dev.js`: `a09413f6c` for the sections
and the first backpromote, `c6ed121b6` for the backpromote replay.
**vscode-sfdx-hardis:** `feat/pr-modal-job-artifacts` at `df3691c0`, compiled with `yarn compile`.

The workspace accepted the pushes: no HTTP 402 this time.

___

## Counts

| Section                                                                             | Checks                            | OK  | FAIL |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42  | 0    |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 47  | 0    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21  | 0    |
| 6sexies: identical actions, I1 to I10                                               | 24                                | 24  | 0    |
| Visual fixtures (VE, VG)                                                            | 2                                 | 2   | 0    |
| 6bis: backpromote B0 to B16, C1 to C4, first pass (`-bb-8`)                         | 63                                | 59  | 4    |
| 6bis: backpromote, replay (`-bb-9`)                                                 | 63                                | 63  | 0    |
| 6quinquies: real CI on Bitbucket Pipelines                                          | not run                           |     |      |
| 4ter: single Pull Request window, simulated jobs (`-bb-7`)                          | 51 Pull Requests                  | 51  | 0    |
| 5bis: comment audit (`-bb-7`)                                                       | 1142 checks over 55 Pull Requests | all | 0    |
| 5quater: visual check of the comments (`-bb-7`, fixtures included)                  | 12 types                          | 12  | 0    |
| 5quater: visual check (`-bb-8` and `-bb-9`, backpromote)                            | 1 type each                       | 2   | 0    |
| 7bis: single place in the diagram (`-bb-7`)                                         | 1                                 | 1   | 0    |

No SKIP line in sections 6quater and 6sexies: the developer org groups ran.

___

## Results by group

### Sections 3, 4, 4bis, 6, 6quater, 6sexies and the fixtures (`-bb-7`): 136 OK, 0 FAIL

The only provider of this run whose sections passed without a failure.

### Section 6bis, backpromote: 59 OK and 4 FAIL on `-bb-8`, then 63 OK on `-bb-9`

First pass: step B7 ("a file that differs: overwrite with the parent branch version") ended with
`[Backpromote] git fetch failed: fatal: unable to access ... getaddrinfo() thread failed to start`.
The workstation was short on memory and `git` could not start a thread. B7-result, B7-org,
B8-result and B8-org-kept failed, B8 because it starts from the state B7 leaves.

Replay on a new repository once memory was back: 63 OK, 0 FAIL.

### Section 6quinquies, real CI on Bitbucket Pipelines: not run

The first `git push` of `-ci-bb-5` failed on the same thread error, one minute after the start.
The repository exists and is empty. See "What this run did not cover".

### Section 5quater, visual check

12 comment types on `-bb-7`, no warning. Pictures read one by one by a reviewer (12): no raw
markdown or HTML, no hidden marker visible, titled sections and box symbols as expected on a
provider that folds nothing.

The Backpromotes pictures of `-bb-8` and `-bb-9` were taken and not read by a reviewer.

___

## What the run found

| Finding                                                                                                                                                           | Status                                             |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------|
| The list of Pull Requests already deployed through a promotion branch was written right under its sentence: Bitbucket drew it as one paragraph with literal ` - ` | fixed, `c6ed121b6`, not yet seen on a real comment |
| A fold says "24 Pull Requests" where the line under it says 25, and 26 against 27: the list leaves out the Pull Request being read                                | open, wording, same on every provider              |
| Narrow columns break words: `StaticResourc` / `e` in the Type column of a failed validation, a job id cut in two, dates wrapped when there are three org columns  | open, cosmetic                                     |
| The long lines of the conflicts prompt are cut at the right edge of its code block, with a scrollbar inside the block; `(#27)` in the conflict list is plain text | open, cosmetic                                     |
| The Backpromotes comment names its org by a lowercase id only: the scratch org has no alias in that test                                                          | open, cosmetic                                     |
| The Backpromotes comment has no banner and no navigation line                                                                                                     | by design (`backpromoteCommentUtils.ts`)           |

The fix of the first line is in `buildAlreadyPromotedMarkdown` (`promotionBranchUtils.ts`), with a
unit test. It was made after the sections of `-bb-7`, and no later job of this run writes that
list on Bitbucket: the pictures still show the old rendering.

___

## What this run did not cover

- **The real CI on Bitbucket Pipelines (section 6quinquies) was not run.** It is the only group of
  this run that never ran on a provider. The user chose not to replay it on 2026-10-10. It last
  passed on 2026-10-09, on `e2e-updates`.
- **The list fix was not seen on a real Bitbucket comment.** It is covered by a unit test only.
- **Section 7ter, the flag-off A/B**, runs on GitHub only, and was not run at all in this run.
- **The Backpromotes pictures** of `-bb-8` and `-bb-9` were not reviewed.
- Bitbucket has no download of job artifacts: the Files button of #2327 does not show there by
  design, and nothing in this run exercises it.
- The known gaps of the skill stay: no Jenkins, no Gitea, no Bitbucket Server, no production org,
  no real sandbox (scratch orgs stand in for developer sandboxes), VS Code panels are checked
  through the extension's compiled code and not by clicks.

___

## What was restarted, and why

- The backpromote, on `-bb-9`, after the `git fetch` thread error of step B7: 63 OK.
- The real CI was not restarted (user decision).
- The background waiters of the session were stopped several times by the low memory of the
  workstation. The test chains themselves kept running.

___

## Left behind

Repositories `sfdx-hardis-promo-e2e-bb-7`, `-bb-8`, `-bb-9` and `-ci-bb-5` (empty). Next free
numbers: `-bb-10`, `-ci-bb-6`. Work folders: `%TEMP%/e2e-1010/promo-e2e-bitbucket*`,
`promo-e2e-bp-bitbucket*` (`-bb-9`), `promo-e2e-bp-bitbucket*-first` (`-bb-8`).

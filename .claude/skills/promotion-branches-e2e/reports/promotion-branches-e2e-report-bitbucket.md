# Promotion branches, deployment actions and backpromote: end to end test on Bitbucket Cloud

**Date:** 2026-10-09 (supersedes the run of 2026-09-08)
**Why this run:** first run on Bitbucket Cloud of every scripted section and of the real CI
section, in the workspace of `.env` (project `TES`), and first time anyone looked at the comments
Bitbucket draws since the layout of #2316.

**The run started blocked.** On 2026-10-08 the workspace refused every push with HTTP 402 ("the
account has exceeded its user limit and this repository is restricted to read-only access") while
the API listed one member. The owner changed the plan during the night and the run went on. That
change also lifted the 50 build minutes: the real CI section never had to fall back to the
simulator.

**Repositories under test** (private, created for this run):

- sections, first pass, before the fixes: `sfdx-hardis-promo-e2e-bb-1`
- sections, second pass, with the fixes: `sfdx-hardis-promo-e2e-bb-3`
- backpromote (Beta), section 6bis: `sfdx-hardis-promo-e2e-bb-2`
- real CI with `e2e-updates` linked by `sf plugins link`, section 6quinquies:
  `sfdx-hardis-promo-e2e-ci-bb-3`

`sfdx-hardis-promo-e2e-ci-bb-1` and `-ci-bb-2` are two real CI attempts stopped after their first
job, both for the harness (see "What the run found").

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub). Scratch orgs
`promo-e2e-dev` (also `DEV_ORG` of 6quater and 6sexies) and `promo-e2e-dev2`.
**sfdx-hardis:** `e2e-updates` with the fixes of the run, through `bin/dev.js`. The CI jobs link the
branch as pushed (W0).
**vscode-sfdx-hardis:** `e2e-updates` at `dbc7e197`, compiled with `yarn compile`.

___

## Counts

Second pass, on bb-3, unless said otherwise.

| Section                                                                             | Checks                            | OK  | FAIL |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42  | 0    |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 47  | 0    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21  | 0    |
| 6sexies: identical actions, I1 to I10 (replay)                                      | 24                                | 24  | 0    |
| 6bis: backpromote B0 to B16, C1 to C4 (bb-2)                                        | 63                                | 63  | 0    |
| 6quinquies: real CI, W0 to W9, X1, X2 (ci-bb-3)                                     | 21, W8 skipped (GitHub only)      | 21  | 0    |
| 4ter: single Pull Request window, simulated jobs                                    | 65 Pull Requests                  | 65  | 0    |
| 4ter: single Pull Request window, real CI jobs (ci-bb-3, X1)                        | 1                                 | 1   | 0    |
| 5bis: comment audit                                                                 | 1405 checks over 69 Pull Requests | all | 0    |
| 5bis: comment audit of the real CI comments (ci-bb-3)                               | 255 checks over 7 Pull Requests   | all | 0    |
| 5quater: visual check, comments of real jobs (ci-bb-3)                              | 8 types                           | 8   | 0    |
| 5quater: visual check, failed validations and the gate (bb-3, fixtures)             | 3 types                           | 3   | 0    |
| 5quater: visual check (bb-2, backpromote)                                           | 1 type                            | 1   | 0    |
| 7bis: single place in the diagram                                                   | 1                                 | 1   | 0    |
| 7ter: flag-off A/B                                                                  | not run                           |     |      |

First pass, on bb-1, before the fixes: sections 4 and 6 at 42 and 47 OK, 6quater at 15 OK and
2 FAIL (finding 2), 6sexies at 20 OK, audit 1072 checks OK, Pull Request window 49 of 49, and the
**visual check at 1 OK and 8 FAIL** (finding 1), which is why there is a second pass.

Section 6sexies of the second pass first ended with one FAIL, I10c, on `git config exited
3221225794`: the workstation was out of memory at that moment and the background job was stopped
right after. Replayed with `IA_RUN=2` once memory was back: 24 OK.

___

## Results by group

### Sections 3, 4 and 4bis: 42 OK on both passes

Stories, five promotions, release notes, second go-live, retrofit, the six DevOps Pipeline
checkpoints. Bitbucket has no merge ref: the validation checks the source branch out and merges
the destination into it, as a `pull-requests:` pipeline does.

### Section 6, edge cases: 47 OK on both passes

Groups g1 to g6. With the fix, the conflict prompt of a promotion sits under a bold title in the
description instead of in a folded section (check 29).

### Section 6quater, deployment actions: 21 OK

Groups A to D. The gate is closed with `set-status`: on Bitbucket there is no box to tick.

### Section 6sexies, identical actions: 24 OK on the replay

I1 to I10, with the backpromote plan and run of the window.

### Section 6bis, backpromote (bb-2): 63 OK

B0 to B16 and C1 to C4, first run on Bitbucket, with the comments written and read back through
the new markup.

### Section 6quinquies, real CI on Bitbucket Pipelines (ci-bb-3): 21 OK

| Job                            | Mode    | Result                | Queued | Ran   | Build minutes |
|--------------------------------|---------|-----------------------|--------|-------|---------------|
| ci-check-c1                    | real CI | FAILED (expected, W1) | 12 s   | 188 s | 4             |
| ci-check-c1-rerun              | real CI | SUCCESSFUL            | 14 s   | 257 s | 5             |
| ci-deploy-integration-c1       | real CI | FAILED (expected, W4) | 13 s   | 269 s | 5             |
| ci-check-c3                    | real CI | SUCCESSFUL            | 12 s   | 271 s | 5             |
| ci-deploy-integration-c3       | real CI | SUCCESSFUL            | 12 s   | 245 s | 5             |
| ci-check-c2-draft              | real CI | SUCCESSFUL            | 11 s   | 267 s | 5             |
| ci-check-promotion-uat         | real CI | FAILED (expected, W5) | 11 s   | 190 s | 4             |
| ci-check-promotion-uat-rerun   | real CI | SUCCESSFUL            | 11 s   | 300 s | 5             |
| ci-deploy-uat-promotion        | real CI | SUCCESSFUL            | 12 s   | 296 s | 5             |
| ci-check-c5                    | real CI | SUCCESSFUL            | 13 s   | 215 s | 4             |
| ci-check-c6                    | real CI | SUCCESSFUL            | 13 s   | 228 s | 4             |
| ci-deploy-integration-c5       | real CI | SUCCESSFUL            | 12 s   | 215 s | 4             |
| ci-deploy-integration-c6       | real CI | SUCCESSFUL            | 12 s   | 228 s | 4             |
| ci-check-promotion-identical   | real CI | SUCCESSFUL            | 12 s   | 216 s | 4             |
| ci-deploy-uat-identical        | real CI | SUCCESSFUL            | 14 s   | 276 s | 5             |

**15 jobs in real CI, 0 simulated**, 68 build minutes, plus about 15 for the two attempts that
were stopped. The fallback to the simulator once the minutes are used up did not run: it is still
unproven.

W2 on Bitbucket edits the text of the comment (the item of the manual action goes from to do to
done), since no box can be ticked there: the re-run reads it and goes on.

After the code review of the Pull Request, W2 was made stricter and proven again on bb-3 with the
simulator (Pull Request #69): the box symbol of the action is changed to the ticked one in the text
Bitbucket holds, the hidden marker left next to it, and the validation run again reads it ("confirmed
as done ... via a Pull Request comment checkbox") and passes. The real CI run above had ticked a
comment rewritten with its HTML comments, which only proved that comments written before are read.

___

## What the run found

### Product

1. **Bitbucket Cloud showed the comments with their HTML as text.** Bitbucket escapes raw HTML.
   Every comment and every promotion description showed its hidden markers (`<!-- sfdx-hardis
   message-key ... -->`, the encoded state of each cell of the "Status by org" table as a long
   base64 string), its `<details>` and `<summary>` tags and its `<br/>`. Nothing folded and no
   checkbox was drawn. The comments were close to unreadable, and nothing but the visual check
   could see it: the audit reads the source, where all of that belongs (1072 checks OK on the same
   comments). Visual check before: 1 OK, 8 FAIL.
   Fixed in `src/common/gitProvider/utils/utilsBitbucketMarkup.ts`, at the door of the Bitbucket
   provider, so nothing else in the code changes:
   - a marker becomes a link with no text, `[](#hardis:<encoded>)`, which Bitbucket draws as an
     anchor nobody sees, in a table cell too, and it is given back as an HTML comment when read;
   - a folded section becomes a bold title followed by its content;
   - a line break tag becomes a space, a bold tag markdown bold;
   - a task item shows a box symbol (☐, ☑), read back as a task item;
   - the sentences asking to tick a box name `sf hardis:project:action:set-status` and the Mark
     as done button instead.
   Comments written before are still read. Eight unit tests. Proven by the second pass (every
   section green with the markers hidden) and by the pictures.
2. **A banner of the Bitbucket client corrupted `--json` output, now and then.** "BITBUCKET CLOUD
   API LATEST UPDATES" printed on stdout ahead of the document: `action:list --json` was not valid
   JSON for one call out of a few (checks A3 and B2 of the first pass). Turned off in the provider
   (`notice: false`).
3. **Checkboxes cannot be ticked in a Bitbucket comment.** Not a defect to fix, a fact of the
   provider the product now states: the gate of a manual action is closed with `set-status` or
   the Mark as done button.

### Harness (fixed in the skill)

- **`curl` expanded the braces of a pipeline id** and sent the request without them: every call on
  a pipeline answered 404, a superseded pipeline was reported stopped while it ran, and the wait
  never saw a job end (ci-bb-1). `bb_api` now passes `-g`.
- **Turning Pipelines on starts branch pipelines** for the branches pushed just before, one by one
  over half a minute: they would deploy the base project and take minutes. The run stops them.
- **The readers of raw Bitbucket comments** (the dump, the Pull Request window check, the real CI
  readers) give the hidden markers back as HTML comments (`bb-shown.cjs`); without it W1b could
  not find the marker of the manual action (ci-bb-2).
- A push right after the repository is created answered 403 for one branch: pushed again.

### Found by reading the pictures (12 read)

No markup is left as text, banners and icons are drawn, titled sections keep the long comments
readable. What the reading found:

| Finding                                                                                                                           | Status                                             |
|-----------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------|
| "Do the steps below in the org, tick their boxes" above "(a box cannot be ticked in a Bitbucket comment)"                         | fixed                                              |
| "Only the boxes are meant to be edited in this comment" right after the same parenthesis                                          | fixed: "This comment is rewritten by sfdx-hardis: do not edit it." |
| Lines and tables looking cut at the right edge of the pictures                                                                    | capture, not Bitbucket: the page wraps them (checked on the page itself). The pictures now keep a margin |
| Backpromotes: "Received by 2 sandboxes · 1 to do by hand" above a table showing "complete" for both sandboxes                     | open, wording: the action to do is listed under its sandbox |
| Backpromotes: the org id of the Sandbox column breaks over three lines, the empty "Left out" column takes as much room            | open, cosmetic (same table as on Azure DevOps)     |
| "To do by hand in `uat` before the deployment" heads an item already done                                                         | open, wording (same on every provider)             |
| The icon column of "Deployment actions of this job" has no header and takes a quarter of the width                                | open, cosmetic                                     |
| "Rerun a failed action with ..." in a Deployment Actions comment that has no failed action                                        | open, minor                                        |

___

## What this run did not cover

- **The fallback of real CI to the simulator** once the build minutes are used up: the plan of the
  workspace no longer runs out during a run. `BB_CI_SIMULATE_ONLY=1` would exercise the simulated
  path, not the detection of a pipeline paused for its minutes.
- **Section 7ter, flag-off A/B**: not run. It switches the sfdx-hardis checkout to `origin/main`,
  which cannot be done while other sections use the same working copy. It ran on GitHub at the
  end of the night (0 differing lines), not on this provider.
- **Comments on bb-3 written before the last wording fixes** keep their earlier text until a job
  touches their Pull Request: the pictures that count are those of ci-bb-3, of the two fixtures
  and of bb-2.
- **A person editing a comment in Bitbucket's editor**: the editor may drop the links with no text
  that carry the markers. Not tried. sfdx-hardis rewrites its comments at each job, and nothing
  asks a person to edit one any more.
- **Flow diff and MegaLinter comments**, the Code Quality tab of the Pull Request window.
- **Step B17** (terminal prompts of backpromote) and a real production org.
- The "Pull Request Commit Links" app is not installed in the workspace: the merge job finds its
  Pull Request through the branch search fallback only.
- The window of a promotion or major-to-major Pull Request is not compared, and nothing of the
  extension is rendered or clicked.
- The four pipeline levels share one Salesforce org.

___

## Left behind

In the workspace: `sfdx-hardis-promo-e2e-bb-1`, `-bb-2`, `-bb-3`, `-ci-bb-1`, `-ci-bb-2` and `-ci-bb-3`
(Pipelines turned off on the three; their secured variables hold the org login and the token and
go with the repositories when they are deleted). On bb-1, one test comment on
Pull Request #5 ("EXPERIMENT START") that tried what Bitbucket's markdown draws. On bb-3, two
Pull Requests left open and failed on purpose for the visual check (#68, #69).

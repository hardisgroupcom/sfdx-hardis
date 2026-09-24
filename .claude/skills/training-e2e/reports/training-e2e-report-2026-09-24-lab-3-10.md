# Training e2e report, 2026-09-24: Level 3 from Lab 3.10, on the released course and the beta CLI

Asked for: walk Level 3 starting at Lab 3.10 (promotion branches), the whole level only if a
mid-level start is impossible. A mid-level start is not possible cold: the course has one start
state per level, none inside Level 3, and Lab 3.10 needs the pipeline to production of Lab 3.1 with
`enablePromotionBranches` carried up to `preprod` by ordinary promotions. So this run does the
dependency chain of Lab 3.10 and nothing else: Lab 3.1 in full, the promotions of Labs 3.5 and 3.6
as prerequisites (no release notes, no DORA), Lab 3.10 in full with its retrofit, then the capstone
promotion of Lab 3.11 that ends the exception. Labs 3.2, 3.3, 3.4, 3.7, 3.8 and 3.9 do not feed
Lab 3.10 and keep the 2026-09-23 runs as their evidence.

Two things are new compared with the two runs of 2026-09-23 and 2026-09-24 (recheck):

- **The course is released.** Lab 3.10 is on `main` of the shared repository (`810d4df`, PR #26)
  and on the published site, so pass A reads the live page and the start branches come from the
  shared repository, as a learner gets them.
- **The fork's jobs run the `beta` sfdx-hardis image**, at the user's request, since the
  promotion fixes of PR #2236 are only released as `sfdx-hardis@beta` today
  (`8.10.1-beta202609241317.0`, published 13:18 UTC; `sfdx-hardis-ubuntu:beta` pushed 13:25 UTC).
  The two deployment workflows and `sync-check.yml` of the fork carry a one-commit override
  (`latest` to `beta`), on `main`, the three start branches and, after the reset, `integration`.
  It is a fork artifact and lands in no course Pull Request.

## Versions under test

| Piece              | Version                                                                                 |
|--------------------|-----------------------------------------------------------------------------------------|
| sfdx-hardis        | local: `main` at `1971b2958` (8.10.0 + PR #2236), linked build; CI: `sfdx-hardis@beta`  |
| vscode-sfdx-hardis | `main` at `30961569`, not exercised (no lab driver entry covers 3.1, 3.5 or 3.10)       |
| course             | `main` at `810d4df`                                                                     |
| published site     | current: the same commit, published 13:09 UTC today                                     |
| Salesforce CLI     | @salesforce/cli 2.151.6, node 24.11.1                                                   |

## Environment

- Fork `nvuillam/sfdx-hardis-training`, reset with `reset-fork.sh` from the shared `main`, then
  `Set up my training environment` (`init --org helios-prod --yes`) and `Reset this level`
  (`reset --level 3 --yes`) in the learner clone `C:/git/training-run`.
- `helios-prod` (`orgfarm-c77e7e1127`, Dev Hub) and `helios-preprod` (`orgfarm-bedd5b7a5a`),
  Developer Edition. Put back to a learner's state before the walk: the External Client Apps of the
  previous run deleted from the four orgs (`sfdxhardisintegration`, `sfdxhardisuat`,
  `sfdxhardispreprod`, `sfdxhardismain`, `sfdxhardismainfive`), `Panel_Batch__c.Warranty_Years__c`
  deleted from both DE orgs, and the `Awaiting Parts` value of `Installation__c.Status__c`
  **deactivated** in both (the Tooling API deactivates a picklist value, it cannot delete one;
  the lab's deploy has to reactivate it, which is checked below). Not re-seeded: both orgs still
  hold the app and the Level 2 deliverables of the previous walk, which is what a learner's orgs
  hold at this point too.
- Scratch orgs `helios-dev`, `helios-integration`, `helios-uat` reused (allowance 6/6 untouched),
  re-deployed and re-seeded idempotently by `init`. They still hold `Warranty_Years__c` from the
  previous walk; nothing in this run's chain asserts on them, and it is recorded.
- Chrome signed in to GitHub on CDP port 9222 (dedicated profile), for the GitHub page steps.

## The walk

| Lab  | Fidelity | Verdict | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
|------|----------|---------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 3.1  | 2 and 3  | OK      | Full walk. Steps 2-3 with the lab's own `gh api` command (`preprod` from `main`, two rules); steps 4-7 headless (`auth.mjs`), four branches on the nominal path, eight secrets stored; steps 8-10 as file edits (the settings panels not exercised); step 11 `gh secret delete`; step 12 branch + commit by hand, `work:save` headless (one question, the target branch), PR #31 created with `gh`, checks green in the `beta` container, merged, `sf org login jwt` in the deploy log; `check --lab 1` OK |
| 3.5  | 3        | essence | The promotion `integration` into `uat` (#32, "Promotion 2026-09: pipeline to production"), merge commit, deploy green: the JWT key of `uat` proven. Package-no-overwrite and the release notes not repeated. A second promotion (#36) carried the F1 sync                                                                                                                                                                                                                                              |
| 3.6  | 3        | essence | `uat` into `preprod` (#33) and `preprod` into `main` (#34, "Release 2026-09 to production"): the JWT keys of `preprod` and `main` proven, `enablePromotionBranches` arrived in `preprod` and `main` with them. A second promotion (#37) carried the F1 sync to `preprod`. DORA not repeated                                                                                                                                                                                                              |
| 3.10 | 2 and 3  | OK      | Full walk, findings F1, F2, F3, F4 below. Step 1 read on `preprod` (`git show`), the settings panel not opened. Step 2: five `Simulate my teammates` stories in the lab's order, each reviewed on its file list and squash-merged before the next: US-058 #38, US-057 #39, US-059 #40, US-060 #41, US-061 #42; five green deploys on `integration`; promotion #43 into `uat`, merge commit, deploy green. Step 4 headless (`panel.mjs`, `GITHUB_TOKEN` set) the way the button runs it, `--pull-requests 39,40,42`: the selection confirmed with its three pre-ticked rows, US-057 clean, US-059 conflicting on exactly the two files of the lab, answered "Recommended", US-061 clean, PR #44 titled `Promotion uat to preprod (2026-09-24-1510)`, prompt file saved. Step 5: description as the lab prints it (`promotionPullRequests: [39, 40, 42]`, carried table with the real titles, markers section, folded prompt, footer); check red naming the two files, once the image was rebuilt (F2). Step 6 by hand with the Edit tool, both blocks ending exactly as the lab's expected XML, committed with the lab's message, pushed, check green with the "promotion branch carrying 3 Pull Request(s) declared in its description: #39, #40, #42" line. Step 7: reason added above the description (`gh api`, since `gh pr edit` is broken), merge commit, `preprod` deploy green with the `[PromotionBranch]` line; in helios-preprod: Awaiting Parts active again, Gate Code and Supplier present, no Warranty Years, no Scaffolding Required, layout Cost > Supplier > External Id. Step 9: `work:new` headless asked the target branch, the type, the name and the org as the lab lists them; `origin/preprod` merged, the same two files conflicting the other way round, `integration` side kept (`git checkout --ours`, the merge editor not exercised), `work:save` headless, PR #45 with zero changed files, merged. `check --lab 10` OK. The uat counter of the diagram (step 5 and "What you should see") and the Source Control panel steps were not observed: no extension run |

## Findings

**F1 (course, release step + CI gap): the published start branches are stale, so `Reset this
level` cannot reach Lab 3.10.** `training/start-level-1`, `-2` and `-3` on the shared repository were
built before the badges, the French translation and PR #26: `node scripts/build/start-branches.mjs
--check` on `main` reports all three "published but stale", and `start-level-3` carries none of the
five Lab 3.10 scenarios, none of its check rule, and no `promotionConflictMarkersIgnoredFiles`. A
learner who resets to Level 3 (the runbook's own path, and the course's rescue command) then clicks
`Simulate my teammates` and reads `"us-058-warranty-term" is not one of: us-018-..., us-056-...`.
The check that exists for exactly this (`start-branches.mjs --check`, "The reset branches are
published and current") lives in `sync-check.yml`, which runs **monthly and by hand only**: nothing
runs it when a Pull Request merges into `main`, which is when the branches go stale. What this run
did: merged the shared `main` into `integration` through a Pull Request (#35, checks green) and
promoted it up, which is a deviation from the learner's path and is the reason the walk continues at
all. What is left to do, and not done by this run because it writes to the shared repository:
`node scripts/build/start-branches.mjs --push` from `main` of the course. Proposed for the training
Pull Request: publish the start branches from CI on every push to `main`, so the release step cannot
be forgotten.

**F2 (sfdx-hardis release pipeline): the `beta` container image was built before npm served the
new beta, so the fork's jobs ran an older sfdx-hardis under the `beta` tag.** The `Build & Deploy`
run of `main` at `1971b2958` published `sfdx-hardis@8.10.1-beta202609241317.0` at 13:18 UTC (job
log), the registry lists the version at 13:27:20 UTC (`npm view sfdx-hardis time`), and the
`sfdx-hardis-ubuntu:beta` image was pushed at 13:25 UTC: its `sf plugins install sfdx-hardis@beta`
resolved the previous beta. First visible effect: the check job of the promotion Pull Request #44
named four files with conflict markers, the two of US-059 and the two Lab 2.7 teaching files, which
`promotionConflictMarkersIgnoredFiles` exists to keep out; the same `git grep` pathspec run locally
on the promotion branch names two. What this run did: re-ran the "Push Beta Ubuntu Docker image"
job of that run (`gh run rerun --job 107649807757`), then re-ran the fork's check. Proposed for
sfdx-hardis: make the image jobs wait for the registry to serve the version they just published
(poll `npm view sfdx-hardis@<version> version` before `docker build`), or install the exact version
by number rather than by tag.

Observation, no action: the lab's sample names the prompt report
`hardis-report/promotion-conflicts-prompt-2026-09-24-0931.md`; the real file is
`promotion-conflicts-prompt-2026-09-24_15-10-40-833Z.md`. The generic sentence
("`hardis-report/promotion-conflicts-prompt-<date>.md`") is right and the sample is a sample;
noted for the next lab edit.

| 3.11 | 3        | essence | The promotions that end the exception: `integration` into `uat` (#46, carries the retrofit), `uat` into `preprod` (#47, **MERGEABLE without a conflict**, deploy green, helios-preprod gains Warranty Years and Scaffolding Required), `check --lab 10` still OK after it, and the release `preprod` into `main` (#48): helios-prod holds Awaiting Parts, Gate Code, Supplier, Warranty Years, Scaffolding Required; the release comment lists the five tickets once each and names US-057 with its original #39. No badge claim, no release notes, no DORA |

**F3 (course + extension, fixed): the conflict editor screenshot shows a block git never
produces.** `promotion-conflict-editor--accept-incoming.png` is taken on a mock fixture that opens
the conflict on an element boundary, with a whole Warranty Years row on the incoming side and pill 2
drawn on it. The real cherry-pick keeps `<layoutItems>` and `<behavior>Edit</behavior>` above the
markers (they also open the External Id row that follows on `preprod`) and the incoming side runs
from `<field>Warranty_Years__c</field>` to the opening lines of the row after Supplier. The by-hand
instruction still works (after Accept Incoming Change the four lines of the Warranty Years row are
contiguous), but a learner comparing the screen with the screenshot sees a different block. Fixed
the fixture generator in the course (`scripts/build/mocks.mjs`) and regenerated the fixture in the
extension. **Not done by this run: the screenshot itself is not re-captured**, since the capture
harness takes the desktop and is run only when the user says the screen is free; pill 2 of
`annotations.json` has to be re-placed on the new image at that point.

**F4 (course, fixed): two sentences of the lab describe the permission set conflict backwards.**
"after the Warranty Years grant of the permission set, add a Supplier grant": in the file the
Supplier grant sorts before the Warranty Years one, and the incoming side reads Supplier then
Warranty Years. Reworded to "next to", in English and French, and the under-the-hood paragraph now
says where git cuts the layout block.

**F5 (sfdx-hardis, recorded, not fixed): the release's deployment comment lists a promoted story
twice.** The "Commits summary" of the release into `main` (#48) lists US-057, US-059 and US-061
twice each: once for the squash commit that arrived with the catch-up promotion, once for its
cherry-picked copy on the promotion branch. Both commits are in the merge, so the list is factual,
and the Tickets section lists each story once; a reviewer still reads the same story and Pull
Request number twice. Proposed: fold a `(cherry picked from commit ...)` copy into its original
when both are in the range.

Also confirmed, no action: `Simulate my teammates` on the `beta`/released scripts, the double-click
guard of the promotion button, the retrofit's zero-file Pull Request, the `work:new` questions in
the lab's order, and the check rule of Lab 3.10 passing before and after the catch-up promotion.

## What this run did not cover

- Labs 3.2, 3.3, 3.4, 3.7, 3.8, 3.9, the badge claim, the release notes and DORA halves of Labs
  3.5, 3.6 and 3.11, and all of Levels 1 and 2: the 2026-09-23 runs are their evidence.
- The webview DOM and every panel: no extension run. In particular the branch window of `uat` with
  its checkbox column and the **Create promotion from uat (3 selected) (Beta)** button, the
  in-flight promotion on the diagram, the `uat` counter reading five then two, the merge editor of
  step 9, and the Source Control panel steps were read from the screenshots and replaced by
  `panel.mjs`, `git` and `gh` (fidelity 2 and 3). The lab driver still has no entry for 3.1, 3.5 or
  3.10.
- The GitHub pages were read with `gh` and captured over CDP; nothing was clicked in the browser.
- A learner's path through the stale start branches: this run merged the shared `main` into
  `integration` to continue (F1), which a learner cannot know to do.
- The scratch orgs were not torn down: `helios-integration` and `helios-uat` already held
  `Warranty_Years__c` from the previous walk, so their deploys of US-058 proved less than a clean org
  would.
- Prose clarity for a beginner, as ever.
- Two long background watchers were stopped by the host for low memory (the same as on 2026-09-23);
  the walk continued with foreground steps under ten minutes and nothing was lost.

## The Pull Requests

| Repository           | Pull Request                                                                       | Carries                                                                                           |
|----------------------|------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| sfdx-hardis          | branch `fix/beta-image-waits-for-registry` (this report)                           | F2: `deploy_beta` waits until the registry serves the published beta; runbook; this report        |
| vscode-sfdx-hardis   | [#527](https://github.com/hardisgroupcom/vscode-sfdx-hardis/pull/527)              | F3: the regenerated conflict fixture                                                              |
| sfdx-hardis-training | [#36](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/36)              | F1 (workflow publishing the start branches), F3 (fixture generator), F4 (wording), the two captures |

Still to do by hand, outside any Pull Request: `node scripts/build/start-branches.mjs --push` from
the course's `main`, or merge #36 and run its workflow once.

The fork `nvuillam/sfdx-hardis-training` is left as the walk ended (48 Pull Requests, the five
stories in production), with its workflows on the `beta` image; the next `reset-fork.sh` erases
that. The two Developer Edition orgs hold the five stories and the four External Client Apps of
Lab 3.1; the next run cleans them the way this one did.

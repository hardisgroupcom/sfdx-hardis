# Training e2e report, 2026-09-24: Level 3 re-check of the promotion branches lab, from scratch

A second walk of the Lab 3.10 chain in one day, asked for after the morning run
(`training-e2e-report-2026-09-23-level-3.md`): the fork was deleted on purpose, so this run starts
from a brand-new fork and proves the current branches of both repositories again, end to end. It is
a confirmation run, not a full Level 3 sweep: the labs outside the 3.10 dependency chain keep the
morning run as their evidence.

## Versions under test

| Piece                | Version                                                                                        |
|----------------------|-------------------------------------------------------------------------------------------------|
| sfdx-hardis          | `fix/squash-merge-pr-number` (PR #2236), linked build; ends the run at `c64225d1d`              |
| vscode-sfdx-hardis   | not exercised tonight (no lab driver run); PR #525 unchanged                                    |
| course               | `feat/promotion-branches-lab` (PR #26) at `e9553a6`, plus `10106c4` pushed during the run       |
| published site       | behind: the published course still has 26 labs; everything walked tonight is unreleased content |

The CI jobs of the fork run the **released** sfdx-hardis, which does not carry the two promotion
fixes of PR #2236. Every place where that matters is called out below.

## Environment

- Fork `nvuillam/sfdx-hardis-training` created fresh (`gh repo fork`), reset from
  `feat/promotion-branches-lab`, start branches rebuilt locally and force-pushed **to the fork
  only**. The learner clone is `/c/git/training-run`, with `origin` and `upstream` pointed at the
  fork, since the shared repository does not carry the lab yet (same recorded deviation as the
  morning run).
- Scratch orgs reused (the daily allowance was at 5/6 after the morning): `init --org helios-prod
  --yes` reused all three and re-seeded idempotently, with no "Child Relationship named
  Installations" collision because nothing was torn down.
- Learner-accurate state restored by hand before Lab 3.1: the four External Client Apps of the
  morning run deleted from the four orgs, the `Awaiting Parts` picklist value removed from
  helios-preprod and helios-prod, `Warranty_Years__c` removed from helios-preprod. Verified before
  the walk: Status picklist back to its five baseline values in both DE orgs, no Warranty field.
- No Chrome on CDP: every GitHub-page step was done with `gh` (fidelity 3) and is listed as such.

## The walk

| Lab  | Fidelity | Verdict | Notes                                                                                                      |
|------|----------|---------|-------------------------------------------------------------------------------------------------------------|
| 3.1  | 2 and 3  | OK      | Full walk. Steps 2-3 via the lab's own `gh api` commands; steps 4-7 via the headless panel (`auth.mjs`), four branches on the nominal path, eight secrets; steps 8-10 as file edits (panel screens not exercised); step 11-12 done, PR #1 merged, `sf org login jwt` in the deploy log; `check --lab 1` OK |
| 3.5  | 3        | essence | The promotion Pull Request into `uat` (#2, then #7 in the capstone week), merge commit, deploy green: the JWT key of `uat` proven. Release notes not repeated tonight |
| 3.6  | 3        | essence | `uat`->`preprod` (#3) and `preprod`->`main` (#4): the JWT keys of `preprod` and `main` proven. DORA not repeated tonight |
| 3.10 | 2 and 3  | OK      | Full walk, findings N1 below. `check --lab 10` OK, twice (before and after the exception ended)             |
| 3.11 | 3        | essence | The ordinary promotion that ends the exception (#9) and the release into `main` (#10): the capstone's weekly cycle, without the badge claim |

Labs 3.2, 3.3, 3.4, 3.7, 3.8, 3.9: **not covered tonight**; the morning run of 2026-09-23 is their
evidence.

Pass A tonight was a re-read of the sections that changed since the morning (the MegaLinter table
realignment `e9553a6` and the morning's own fixes). Pass C for Lab 3.10: the four images are
byte-identical to what the morning run opened and cleared, and that verdict carries over.

## What Lab 3.10 proved, from scratch

- `Simulate my teammates` produced US-057 (#5) and US-058 (#6); both squash-merged, deploys green.
- The selective promotion (headless panel, linked CLI, `GITHUB_TOKEN` set) built
  `promotion/uat/preprod/2026-09-23-2157`, cut from `origin/preprod`, and opened PR #8 titled
  exactly as the lab prints it, with `promotionPullRequests: [5]` and a carried table whose Title
  and Author resolved through the squash subject `(#5)`: the PR-number fix of #2236 proven again on
  a fresh repository.
- Running the button's command a second time asked `Close the 1 promotion(s) already open and
  assemble a new one?` and stopped the harness: the product guards the double click. The lab does
  not mention that prompt; it needs no entry, the question answers itself.
- The check job of PR #8 (released CLI) failed on conflict markers in the two Lab 2.7 teaching
  files: the exact defect the scoped scan of #2236 fixes, reproduced verbatim on a fresh fork.
  Merged with `preprod` protection lifted and restored (recorded deviation until a release ships).
- The deployment after the merge, run locally with the linked build, hit **finding N1** (below),
  was fixed in place, and then deployed green in 47 s with
  `[PromotionBranch] ... 1 Pull Request(s) declared in its description: #5` in the log.
- Selectivity verified in helios-preprod: `Awaiting Parts` present (and provably absent before the
  walk), `Warranty_Years__c` absent.
- The exception ended as the lab promises: ordinary promotion #9 went green **in CI on the released
  CLI** (the guard fires only on promotion branches), carried US-058 up, and `check --lab 10` still
  passes after it (`promotedAway`).
- One level up too: release #10 into `main` deployed green in CI, helios-prod holds `Awaiting
  Parts` and `Warranty_Years__c`, and the release's deployment comment names US-057 with its
  original Pull Request #5, re-expanded from the promotion's declaration, next to US-058. That
  claim of the lab's last under-the-hood section had never been proven by a run before.

## Findings

**N1 (CLI, fixed in `c64225d1d` on PR #2236): the deployment after the merge scanned the whole
target branch again.** On the process job HEAD is the merge commit on the target branch itself, so
`git diff origin/<target>...HEAD` names nothing; the empty list read as "no restriction" and the
conflict-marker guard grepped the whole branch, failing on the Lab 2.7 teaching files, the exact
failure the morning's fix removed from the check job. A learner would have merged a green-checked
promotion and watched the deployment turn red. Fixed: an empty carried list scans nothing, and the
post-merge job reads the files the merge brought in (`HEAD~1..HEAD`, first parent; no caret, so a
Windows shell does not eat it). Two regression tests added; 67 pass in the suite. The morning run
missed it because its local deploy ran without a `GITHUB_TOKEN`, so the guard never identified the
Pull Request and never ran.

**N2 (harness, fixed): `prflow.sh` merged before the required checks existed.** Twice: right after
a Pull Request is created its checks are not registered and `gh pr checks --watch` returns at once
on the empty list; and a head commit fresh from a merge already carries finished runs of its
previous branch, so "some check exists and none is pending" proves nothing. It now waits for the
two required checks of this course by name, and re-watches while anything is pending. Also
relearned: never edit a script a background bash is still executing, bash reads it lazily and dies
mid-file.

**N3 (course, fixed in `10106c4` on PR #26): three stale translation stamps.** `i18n/fr.json`
carried the `source_rev` of an `en.json` two commits old (the Trailhead-banner copy of PR #24; the
French translation itself was already current), and the two French labs edited in the morning had
not been re-stamped. `check-i18n` and `stamp-source-rev` both clean now.

Observations, no action: `labs/fr/index.md` holds one more admonition than the English page ("Les
outils restent en anglais"), which is a difference somebody meant; the ticket details of US-057 and
US-058 404 during deploys because the published site does not carry their backlog pages until PR
#26 ships; a "Needs Reinspection" Status value reached preprod with the ordinary carry-up
promotions, from the Level 2 content, not from the selective one.

## What this run did not cover

- The six Level 3 labs outside the chain, the badge claim, the release notes and DORA halves of
  3.5/3.6, and all of Levels 1 and 2: covered by the 2026-09-23 run, not tonight.
- The webview DOM, as every run so far: no lab driver run tonight, so even the panels the morning
  drove were tonight exercised headless only.
- CI green on a promotion Pull Request: impossible until a released sfdx-hardis ships PR #2236; the
  released CLI reproduces F1 on the check job, and would reproduce N1 on the merge job.
- Prose clarity for a beginner, as ever: this was a second read in one day by the same agent.

## The three Pull Requests

| Repository           | PR                                                       | State tonight                                   |
|----------------------|----------------------------------------------------------|--------------------------------------------------|
| sfdx-hardis          | #2236, now with N1 (`c64225d1d`)                          | CI restarted on the new commit                  |
| vscode-sfdx-hardis   | #525                                                     | unchanged, green                                |
| sfdx-hardis-training | #26, now with N3 (`10106c4`)                              | CI restarted on the new commit                  |

# Training end to end run, 2026-09-26 (Level 2 teammate simulation)

A scoped run: the teammate steps of Level 2 changed, and only those were walked. Lab 2.1 step 1
now explains the merge click by click, and **Simulate my teammates** can merge the teammate Pull
Request itself in Level 2. The rest of Level 2 was not walked.

Course Pull Request: [#52](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/52).

## Versions under test

| What        | Version                                                                         |
|-------------|---------------------------------------------------------------------------------|
| sfdx-hardis | 8.11.1, linked build of `main` (45a233cb7)                                      |
| Extension   | not exercised (8.8.1 on disk)                                                   |
| Course      | `fix/lab-2-1-merge-teammate-pr`, ahead of the published site (`main` @ 2308217) |

The published site does not carry any of this yet.

## Environment

- Fork `nvuillam/sfdx-hardis-training`, **not reset**: it was at the end of Level 3 from the night
  run. **Reset this level** on Level 2 put `integration` back to `training/start-level-2`, which is
  the path a learner who wants to redo Level 2 takes.
- Orgs `helios-integration` and `helios-dev`, scratch orgs from `helios-prod`. `helios-integration`
  was torn down and re-seeded during the run (see the deviations).
- The script under test was committed on a local branch of the learner clone,
  `e2e/simulate-under-test`, and every simulation was started from it.

## The cheap checks

On the course branch: `universe.mjs --check`, `check-pills.mjs`, `check-links.mjs` (only the two
known 403 hosts), `site.mjs` and the Zensical build, `check-site.mjs`, `check-mobile.mjs`,
markdownlint on the six changed labs. All green after one fix: Lab 2.1 linked Level 1 labs without
their folder, which `check-site.mjs` caught.

## Lab by lab

| Lab           | Fidelity                                                    | A (read) | B (do)              | C (images)                         |
|---------------|-------------------------------------------------------------|----------|---------------------|------------------------------------|
| 2.1 step 1    | 3: `node scripts/training.mjs simulate`, the menu's command | OK       | OK after F1, F2, F3 | OK, 4 images, pills match the text |
| 2.1 steps 2-5 | not walked                                                  | -        | -                   | -                                  |
| 2.7 step 2    | 3, US-018                                                   | OK       | OK after F3         | the menu image, unchanged          |
| 2.9 part 3    | 3, US-019                                                   | OK       | OK after F3, F4     | none in that part                  |

Cases walked for the command, all against the real fork:

| Case                                             | Result                                             |
|--------------------------------------------------|----------------------------------------------------|
| US-017, Yes to the merge, checks green           | Merged by the command about 3.5 min after the push |
| US-017, a check red                              | Stops, prints the PR address, merges nothing       |
| US-017 again while its Pull Request is open      | Same PR, new commit, address printed (after F2)    |
| US-017 again once merged                         | "already merged" and the merged PR address         |
| Learner merges on GitHub while the command waits | Detected, next step printed (after F3)             |
| Fixed Level 2 start state, Level 1 audit         | Same result as the current start state             |

## Findings

### Course, PR [#52](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/52)

- **F1. The Level 2 start state granted a field before it existed.** `scripts/start-states/level-2`
  shipped `Helios_Delivery_Manager` with read and edit on `Installation__c.Signed_Off_By__c`, a field
  only US-017 creates. After **Reset this level** on Level 2, **Set up one of my training orgs**
  failed (*no CustomField named Installation__c.Signed_Off_By__c found*), and so did the deployment
  check of every Pull Request into `integration` except US-017's. A learner who finished Level 1
  without resetting never saw it. Fixed: the grant is removed, US-017 adds it in its alphabetical
  place.
- **F2. A second run on an open teammate Pull Request printed "The branch is not visible to the
  GitHub API yet, retrying" twice.** `gh pr create` fails the same way when the PR exists. Fixed: the
  open PR is looked up first.
- **F3. A learner merge in the same second as the command's merge was reported as "could not be
  merged, merge it yourself".** Measured twice: both merges in the same second, and GitHub still
  answered OPEN right after. Fixed: the state is read again for ten seconds, and a real failure now
  shows GitHub's own message.
- **F4. US-019's closing line talked about Lab 3.4 when run from Level 2**, and US-018's only about
  Lab 2.7 when run from Level 3. Both name the two labs now.

### Code review (high) of the course Pull Request

Fixed and walked again: the wait now gives the learner their branch and their work back before it
starts (the first version kept them on Romain's branch, work stashed, for minutes); checks are read
only once the Pull Request carries the pushed commit, and the merge uses `--match-head-commit`; the
wait reuses `waitForPullRequestChecks` of **Update my course**, so a fork with no checks is reported
after three minutes; a scripted `--yes` merges only with `--merge`; Level 2 wording only prints in
Level 2. Re-verified on PR #46 (merged by the command, learner branch and uncommitted file back
during the wait), #47 (learner merged first, detected) and #48 (`--yes` alone, left open).

### Not fixed

- **No picture of a Training command panel.** Labs 2.1 and 2.7 show the Training menu, then
  describe the three questions in a table. The extension screenshot harness has no scenario for a
  Training command, which is a node script rather than an `sf` command, so a capture needs a mock in
  `../vscode-sfdx-hardis` first.

## Deviations from what a learner does

- Every simulation ran from the course branch's script, committed on a local learner branch,
  because the published start branches do not carry it yet.
- The first US-017 check failed on `CrewCapacityBatchTest`, an Apex test left in
  `helios-integration` by the Level 3 walk: the org was not cleaned before this run. I tore it down
  and seeded it again, and the teardown also deleted the External Client App that the Lab 3.1 JWT
  login uses, which **Reset this level** keeps. I redid Add/Configure Org for `integration` with
  `auth.mjs` and merged the new key through config PR #41 on the fork, with the F1 fix in the same
  PR so the rest of the run had a correct start state.
- The GitHub merges of the "learner merges while it waits" cases were `gh pr merge`, not a click.
- The walks ran with `--yes`, which answers the questions without the panel; after the review
  fix, `--merge` stands for the Yes a learner clicks.
- The fork is left with `integration` at the Level 2 start plus US-017 and US-018, and the JWT key
  of PR #41 kept by the reset; `helios-integration` holds the Level 2 app plus those two stories.

## What this run did not cover

- The backpromote of Lab 2.1 (steps 2 to 5), and every lab of Level 2 beyond the simulate step.
- The panel: the command ran headless. Whether the VS Code command panel shows the new confirm and
  the PR address the way the table says was not seen. The lab driver does not cover Training
  commands.
- The **No** answer followed by the step 1b clicks on GitHub: the pages and screenshots were
  checked, the clicks were not made in a browser.
- Lab 2.1 **Check my work** passed, but `helios-dev` already had the field from an older walk, so it
  proves nothing about this run.
- French: structure and stamps only (`check-structure.mjs`, `check-translations.mjs`), not read as a
  learner.
- Prose clarity: an agent reads past what a first-timer stops at.

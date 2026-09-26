# Training end to end run, 2026-09-26 (night)

Seventh run of the `training-e2e` skill, the second full walk of the day: **all three levels, 26 labs
done and Lab 1.1 read**, from a fork deleted and recreated for the run, with **every CI job on
`sfdx-hardis-ubuntu:beta`** at the user's request. Every level ended on its own `Check my work`
green: **Level 1 6 of 6, Level 2 9 of 9, Level 3 11 of 11**. Lab 3.10, which this morning's run
could not finish on the released image (F30), went through end to end on the beta.

No badge was claimed: the three were awarded this morning, and a second claim writes a duplicate
record to the shared repository.

The run produced **11 findings** (N1 to N11), all but two fixed in course PR
[#48](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/48). Worth reading first:

- **N3 (blocker, fixed)**: **the course site has not published since this morning.** `pages.yml`
  refuses to build when `lab-crossrefs.mjs --check` fails, and PR #43 added four lab mentions without
  links. Both merges of 2026-09-25 (#43 and #47) never went live: the published Lab 1.4 still sends
  the learner to a Details tab that does not exist. The links are fixed, the check now runs on every
  Pull Request, and `preflight.sh` reports **site published** as MISSING when the last publish of
  `main` failed.
- **N8 (release)**: Lab 3.8 on the course's `main` describes the deployment repository question and
  the `AGENTS.md` of the backup (CLI #2241), which are in `8.10.1-beta` and not in the released
  8.10.0. **Release 8.10.1 before merging PR #48**, which would publish that text. The same release
  unblocks this morning's F30 (Lab 3.10).
- **N1, N2, N6 (fixed and proven)**: `Clean up a training org`, which the runbook runs before every
  walk, failed on all five used orgs, then left them unable to be seeded again, then left the
  External Client Apps that stop the next `Add/Configure Org`. All three fixed, and proven on
  `helios-uat`: teardown, then a clean seed.

## Versions under test

| Thing              | Version                                                                                                 |
|--------------------|---------------------------------------------------------------------------------------------------------|
| sfdx-hardis        | `main` at `6b09ed97d`, linked working copy (8.10.0 + unreleased #2236, #2239, #2241)                    |
| vscode-sfdx-hardis | `main` at `79f200cd` (8.8.0 + #528, #530), built `yarn compile && yarn dev` for the lab driver          |
| Course             | `main` at `ada37fd`, then branch `fix/training-e2e-2026-09-25-night` (PR #48)                           |
| CI images          | pipeline jobs `sfdx-hardis-ubuntu:beta` = `8.10.1-beta202609251713.0` (image pushed 17:25Z, npm 17:17Z) |
| Monitoring jobs    | `sfdx-hardis-ubuntu:latest` = 8.10.0, the image a learner gets (monitoring is not overridden)           |
| Salesforce CLI     | @salesforce/cli 2.151.6, node 24.11.1                                                                   |
| Published site     | **behind `main` by two merges** (N3): what a learner reads today is the course before 2026-09-25 midday |

## Environment

| Item             | State                                                                                                                      |
|------------------|----------------------------------------------------------------------------------------------------------------------------|
| Fork             | `nvuillam/sfdx-hardis-training`, deleted by the user and recreated with `gh repo fork` (init's own call)                   |
| Beta override    | one fork-only `E2E ONLY` commit on the fork's `main` and `training/start-level-1..3` (image tag only)                      |
| Scratch orgs     | `helios-dev`, `-integration`, `-uat` of this morning, **torn down** (after N1 and N2), then re-seeded                      |
| `helios-prod`    | Developer Edition, Dev Hub, **French-speaking user**; torn down, deleted objects erased, re-seeded                         |
| `helios-preprod` | Developer Edition, French-speaking user; same                                                                              |
| Monitoring repo  | `nvuillam/sfdx-hardis-training-monitoring-0926`, new and private                                                           |
| Learner clone    | `C:/git/training-run`                                                                                                      |
| Browser on CDP   | the user's Chrome on 9222, used for Setup (field wizard, Required, Deleted Objects, Deliverability) and the Actions banner |

## The cheap checks

All green on `main` and on the branch: `universe --check` (27 labs), `check-commands` (14),
`check-links` (85 URLs, 2 bot-protected sign-up pages), `check-pills`, `check-i18n`,
`check-structure` (the known `index.md` difference), site build, `check-site`, `check-nav`,
`check-language-switch`, `start-branches --check`. **None of them caught N3**: `lab-crossrefs
--check` was not in the list. It is now, in `SKILL.md` and in the course's `translations.yml`.

## Lab by lab

Fidelity: **1** lab driver, **2** headless panel (`panel.mjs`, `auth.mjs`, `mon.mjs`), **3** direct
`sf` / `git` / `gh` / API, **browser** the real Setup or GitHub page over CDP. Pass A read, B do,
C look at the images.

| Lab  | Fidelity                                                              | A  | B  | C          | Findings            |
|------|-----------------------------------------------------------------------|----|----|------------|---------------------|
| 1.1  | read only                                                             | ok | -  | ok         | O3                  |
| 1.2  | `init` (x3), Actions banner in the browser                            | ok | ok | ok         | N1, N2, D1          |
| 1.3  | 1                                                                     | ok | ok | ok         |                     |
| 1.4  | browser (field wizard), 3 (grants, record values)                     | ok | ok | ok         | N3, D2              |
| 1.5  | 3 (retrieve, commit), 1 (Save/Publish)                                | ok | ok | ok         | O1                  |
| 1.6  | 3 (`gh pr create`, `prflow.sh`)                                       | ok | ok | ok         | N4, O2              |
| 1.7  | 2 (new, save), browser (field), 3 (grant, list view as metadata)      | ok | ok | not opened |                     |
| 2.1  | 2 (`backpromote --plan` / `--agent`)                                  | ok | ok | not opened |                     |
| 2.2  | browser (field), 3 (flow version), 2                                  | ok | ok | not opened |                     |
| 2.3  | browser (Required + its warning dialog), 3 (action file), 2           | ok | ok | not opened |                     |
| 2.4  | 3 (object, grants, records, workspace file, action file), 2 (export)  | ok | ok | not opened | N5                  |
| 2.5  | 3 (Apex paste, deploy), 2 (Apex tests, save)                          | ok | ok | not opened |                     |
| 2.6  | 3 (grants), 2                                                         | ok | ok | not opened |                     |
| 2.7  | 3 (flows as XML, merge resolution), 2, simulate                       | ok | ok | not opened |                     |
| 2.8  | 3 (layout, whole-org retrieve), 2 (`resetselection`)                  | ok | ok | not opened |                     |
| 2.9  | 3 (org build, grants through metadata), 2, simulate                   | ok | ok | not opened | N2 aftermath        |
| 3.1  | 3 (branch, protection, config), 2 (`auth.mjs` x4)                     | ok | ok | ok         | N6, O4              |
| 3.2  | simulate, 3 (review comment), squash                                  | ok | ok | ok         | H1                  |
| 3.3  | log read, simulate, fix                                               | ok | ok | ok         | D3                  |
| 3.4  | simulate x2, 3 (comment)                                              | ok | ok | ok         |                     |
| 3.5  | 3 (UAT hand edit, no-overwrite file, ticks), 2 (notes)                | ok | ok | ok         | N5 verified, N7, O5 |
| 3.6  | 3, browser (Deliverability), 2 (DORA)                                 | ok | ok | sampled    | N7, N9, O6          |
| 3.7  | simulate, 3, 2 (retrofit)                                             | ok | ok | sampled    | N10, N11            |
| 3.8  | 2 (`mon.mjs`), 3 (Run workflow)                                       | ok | ok | sampled    | N8, H2              |
| 3.9  | 2, protected page proven                                              | ok | ok | ok         |                     |
| 3.10 | simulate x5, 2 (`promotion:create`), 3 (resolution by hand), **beta** | ok | ok | ok         |                     |
| 3.11 | simulate, 3, 2 (notes, DORA)                                          | ok | ok | ok         |                     |

Levels 1 and 2 had their pictures recaptured and reviewed this morning; tonight's pass C opened
Level 1 and 30 of Level 3's 60 images, and **no Level 2 image**.

## Findings

### Course, PR [#48](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/48)

- **N1**: teardown failed on every used org: a deactivated flow with old versions refuses the
  destructive deploy (*insufficient access rights on cross-reference id*), and each version holds
  the objects. `helios-preprod` had 31. Teardown deletes the versions now.
- **N2**: after a teardown, **Set up my training environment** failed on all three scratch orgs with
  *There is already a Child Relationship named Installations on Account*, and clicking again, as its
  message says, failed the same way: the deleted `Installation__c` keeps its lookup's relationship
  name under Deleted Objects for 15 days. Lab 3.1 documented the symptom; teardown now passes
  `--purge-on-delete`. Aftermath in `helios-dev`: Handover Item and Panel Batch refused Erase with
  an internal server error, and the undeleted-but-not-erased Handover Item made `ObjectPermissions`
  DML resolve `Handover_Item__c` to the deleted object in Lab 2.9 (*Invalid object*). Grants were
  deployed as metadata instead.
- **N3**: the site did not publish (above). Links fixed, check added to the Pull Request workflow.
- **N4**: **Trigger my workflows** refused whenever any workflow of the fork was not active, and
  GitHub leaves the two scheduled ones at `disabled_fork` after the banner click. Lab 1.6's remedy
  for "the checks never start" (click the banner, then Trigger) refused forever. Only the three
  pipeline workflows count now.
- **N5**: Lab 2.4 step 6 had the learner tick the manual action after the merge, "and the next
  sfdx-hardis job records it". A job only reads the boxes of the Pull Requests it carries, so no job
  read it before Lab 3.5's promotion. Verified: PR #8's jobs never touched PR #7's comment, and the
  promotion into `uat` recorded the tick. Reworded in English and French.
- **N6**: teardown left the four External Client Apps of Lab 3.1 (`sfdxhardis<branch>`), and the next
  `Add/Configure Org` on the same org stops on *already exists ... Have you deleted it?*. All four
  orgs had them from this morning. Teardown removes them now (the app and its four settings types in
  one destructive deploy).
- **N7**: Lab 3.5 step 5 said to do the manual steps after the deployment, step 7 promised the
  notes would show the deliverability step as *manual*, and step 4 said to tick the box once done.
  A pre-deploy step done and ticked before the merge is recorded by the merge job (*confirmed as
  done in org branch uat*) and the notes read *success*. Lab 3.5 and Lab 3.6 reworded.
- **N9**: the DORA report is named after the day, so Lab 3.11's report replaces the Lab 3.6
  baseline it is meant to be compared with, for anybody finishing Level 3 in one day. Lab 3.6 says
  so now.
- **N11**: Lab 3.7 step 6 names the tickets as pill 3 of the deployment comment; the picture (a
  Level 1 comment, 34 sent / 5 changed) has no tickets, and its pill 3 marks the Quick Deploy line.
  Text aligned on the picture, and it says the counts are from an earlier deployment.
- **N12 (reported by a learner after the walk)**: Lab 2.2 has the learner leave **Visible** unticked
  for every profile on the new `Crew_Warning_Sent__c`. Flow Builder only lists the fields the person
  editing the flow can read, so **Update Triggering Record** cannot pick it and the `crewTooSmall`
  formula cannot use it: the lab stops at step 2. Both walks of the day missed it because they wrote
  the flow as XML instead of clicking Flow Builder. Reproduced in `helios-dev` with the admin's
  describe. The lab ticks **Visible** for System Administrator only now, and says how to fix a field
  created without it.
- Changelog `## 2026-09-26`; French `source_rev` restamped for the five labs edited in both
  languages.

### Release

- **N8**: release 8.10.1 before merging PR #48. Until then Lab 3.8 describes a question and a file
  (`deploymentRepository`, `AGENTS.md`) the released CLI does not have, and Lab 3.10 cannot be
  finished (F30).

### Not fixed

- **N10**: `work-new-story-type--retrofit` (Labs 3.7 and 3.10) shows *Automatically selected target
  branch is integration*; at Level 3 the command asks, and the lab's table lists the question. The
  harness has no Level 3 state with two target branches to capture it from.
- F29 of this morning (Lab 3.8's first report picture) is still stale, and it does not show the
  new **Deployment repository** link either.

### Harness (this skill)

- **H1**: `prflow.sh` merged on the previous commit's green checks after a teammate's push (Lab 3.2),
  and branch protection refused it. It waits for the two checks of the head commit now.
- **H2**: `mon.mjs` had no rule for the deployment repository question of #47, and named the app
  *Helios Monitoring*, which teardown's `sfdxhardis*` pattern cannot find. It answers the fork's
  address and accepts the offered name now.
- `preflight.sh` reports **site published** from the last `pages.yml` run of `main`; `SKILL.md`
  lists `lab-crossrefs` and `lab-command-links` among the cheap checks; the runbook has seven new traps
  (teardown of a used org, Git Bash path conversion, anonymous Apex compile, API grants invisible to
  source tracking, an override push fooling `init`, French orgs, release order).

## Observations

- **O1**: Lab 1.5's Source Control picture marks all four files `U`; in a walk three are `M`.
- **O2**: Lab 1.6's comment read 36 sent / 7 changed, the lab says 34 / 5 within its "may differ"
  note. Second run in a row on those numbers.
- **O3**: Lab 1.1 and 1.2 pictures show extension v8.6.1 (current 8.8.0).
- **O4**: Lab 3.1's `work-save-completed` illustrates the configuration branch with the Level 1
  US-014 publish (*Git Delta package.xml (4)*), where the text says the branch changes no metadata.
- **O5**: Lab 3.5's notes count 20 Pull Requests, the lab says 19: the promotion itself is listed.
  Lab 3.5's `integration` window picture shows 2 Pull Requests where a learner sees about 19.
- **O6**: the DORA report of `helios-prod` counts 97 deployments: that org served every walk since
  mid-September. A learner's is fresh.
- **O7**: 13 French labs read *behind* in `check-translations`: `source_rev` stamps taken on a branch
  point at commits a squash merge then discards. Stamping after the merge, or on the English file's
  content, would keep them true.
- O9 of this morning again: US-045's squash commit carries the symptom as its title.

## Deviations from what a learner does

- **D1**: the beta override was pushed onto the new fork **before** `init`; its change to the
  workflow files made GitHub list every workflow as active, `init` said *Actions are on*, and PR #1
  got no run. The banner was clicked over CDP, `init` re-run, and `Trigger my workflows` pushed.
  A learner's fork gets no such push; the runbook now says to click the banner first.
- **D2**: Lab 1.4's first wizard run left the default profile field-level security ticked (a script
  bug), removed through Apex. The permission set grants and the record values of 1.4, 1.7, 2.4,
  2.6, 2.7 and 2.9 went through the API, so the Metadata Retriever lists of those labs differed from
  a learner's (permission sets absent from Recent Changes, profiles present).
- **D3**: Lab 3.3's review comment on `.forceignore` was not posted (a line computation of mine);
  Romain's fix went in regardless.
- The Actions banner, the protection rules, the `preprod` branch, the PR review comments, the
  manual-action ticks and the promotion Pull Request descriptions were done through `gh` or the API,
  not by clicking the GitHub pages.
- Every org of the course was torn down and erased by hand before Level 1: that is the runbook's
  start state, and it is what surfaced N1 and N2.

## What this run did not cover

- **The webview DOM was not clicked.** The lab driver ran Labs 1.3 and 1.5; every other panel step
  went through `panel.mjs` or the CLI with `--agent`.
- **Dialogs done at fidelity 3 that a learner clicks**: Flow Builder (2.2, 2.7, 2.9), the Edit
  Deployment Action dialog (2.3, 2.4, 2.9), Create Workspace (2.4, 2.9), the package viewer (3.5),
  the list view editor (1.7), Pipeline Settings (3.1, 3.8), the VS Code merge editor (2.7, 3.10), the
  Metadata Retriever itself (every retrieve was `sf project retrieve start` with the lab's
  components), the GitHub review and branch pages.
- **Lab 3.8 step 7** (a notification channel): no webhook here.
- **Lab 1.2 step 7** (the extension's GitHub sign-in): an OAuth round trip.
- **Badge claims**: not made (awarded this morning).
- **Pass C**: no Level 2 image opened tonight, Level 3 about half.
- **French** was not walked; the five French labs edited tonight were edited alongside English and
  restamped.
- The `--purge-on-delete` and External Client App paths of teardown were proven on `helios-uat`
  only; the Developer Edition orgs were erased by hand.
- **An agent is not a beginner.** Prose clarity was not really tested.

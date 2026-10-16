# Training end to end run, 2026-10-16

The whole course walked again, all three levels, in order, on the same fork and the same orgs, with
**no reset between levels**. Four agents walked it one after the other: Level 1, Level 2, Level 3
Labs 3.1 to 3.6, Level 3 Labs 3.7 to 3.11. Every CI job of the fork ran the **released image**
`latest` (8.18.1), with no override. **Level 1 6 of 6 (Lab 1.1 read, not performed), Level 2 9 of
9, Level 3 11 of 11**, each lab's own `Check my work` passing.

- **The open item of 2026-10-12 is closed: the whole Profile reaches production.** The Helios Crew
  Profile retrieved whole in Lab 2.6, as the Metadata Retriever's Auto mode does, with no
  `cleanXmlPatterns`, seeded `helios-preprod` and `helios-prod` in Lab 3.1 and was validated and
  deployed through `uat` (#66), `preprod` (#67) and `main` (#68). The only edit was the one Lab 2.6
  already teaches: two layout blocks that only one scratch org has (L2-F2).
- **One defect every learner meets (L2-F1)**: after the backpromote of Lab 2.1, the extension offers
  to merge `integration` into the Level 1 story branch, already squash merged, and that merge stops
  on a conflict. Fixed in the extension (vscode-sfdx-hardis, `isOriginalBranchGone`), and Lab 2.1
  covers the extensions released before the fix.
- **One defect every learner's first Pull Request shows (L1-F1)**: a line of Lab 3.10 rendered as a
  heading, which markdownlint reports in MegaLinter on every Pull Request of the fork. Fixed.
- Fourteen course fixes in all, English and French, and one extension fix (L2-F1). No defect was
  fixed in sfdx-hardis: its branch carries walk helpers, runbook traps and this report.

## Versions under test

| Thing              | Version                                                                                                                     |
|--------------------|-----------------------------------------------------------------------------------------------------------------------------|
| sfdx-hardis        | `main` at `1aa09d537` (v8.18.1), linked (`sf plugins link`), `yarn compile` at the start of the run                         |
| vscode-sfdx-hardis | `main` at `a67c69ed`, `yarn compile` then `yarn dev`                                                                        |
| Course             | `main` at `026e4bb`, branch `fix/e2e-2026-10-16` cut from it                                                                |
| CI image           | the released `sfdx-hardis-ubuntu:latest`, 8.18.1, pushed 2026-10-14 23:31 UTC, on the fork and on the monitoring repository |
| Published site     | `main` at `026e4bb`. Pass A read the published text. The fixes of this run are on the course branch, ahead of the site      |

The sfdx-hardis branch `fix/training-e2e-2026-10-16` changes no product code: `1e9393798`,
`fff013e59`, `0c181942d`, `077e1a3f5` are helpers and runbook, then this report.

## Environment

| Item            | State                                                                                                                                                                                                                 |
|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Fork            | `nvuillam/sfdx-hardis-training`, **reset, not recreated** (`reset-fork.sh` closed #22 of the last run). Pull Request numbers start at #44                                                                             |
| Orgs            | `helios-dev`, `helios-integration`, `helios-uat` (scratch), `helios-preprod`, `helios-prod` (Developer Editions, users in English, `helios-prod` is the Dev Hub). All five torn down before Level 1, each with exit 0 |
| Monitoring repo | `nvuillam/sfdx-hardis-training-monitoring-run7`, new and private                                                                                                                                                      |
| Learner clone   | `C:/git/training-run`, cloned by `reset-fork.sh` at `026e4bb`                                                                                                                                                         |
| Browser on CDP  | the e2e Chrome profile (`%LOCALAPPDATA%\sfdx-hardis-e2e-chrome`) on port 9222, signed in to GitHub, not to Salesforce (frontdoor URLs)                                                                                |

Started clean: the fork and the orgs, yes. Two traces of earlier walks stayed:

- the fork's Actions runs and Pull Requests #1 to #43 of the 2026-10-12 walk are inside the 90 day
  window, so DORA counts them (L3-E2);
- `helios-dev` is the scratch org recreated on 2026-10-12, newer than the other two, which is what
  made L2-F2 show at Lab 2.6 instead of Lab 3.1.

The teardown ran in the background and was stopped by Claude Code for low memory during
`helios-prod`; it was run again in the foreground for that org, exit 0. No scratch org was created
during the run.

## Lab by lab

Fidelity: **1** lab driver (real VS Code panel, real CLI), **2** headless panel (`panel.mjs`,
`panel-node.mjs` for the Training menu, `auth.mjs`, `mon.mjs`), **3** direct `sf` / `git` / `gh` /
API or a file edit, **browser** the real page over CDP.

| Lab  | Fidelity                                                                                                                                                                 | A  | B                                         | C                  | Findings                     |
|------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----|-------------------------------------------|--------------------|------------------------------|
| 1.1  | read only                                                                                                                                                                | ok | not covered                               | ok (8)             | L1-O1                        |
| 1.2  | 1 (`init`, 514 s), then 2 to read its output; steps 1 to 4 done before, step 7 not drivable                                                                              | ok | ok, partly                                | 9, one stale       | L1-S1, L1-O2, L1-O3          |
| 1.3  | 1                                                                                                                                                                        | ok | ok                                        | ok (6)             |                              |
| 1.4  | browser (field wizard clicked, grants, record values); step 1 by frontdoor URL                                                                                           | ok | ok                                        | ok (4)             |                              |
| 1.5  | 3 (retrieve, staging, commit), 1 (Save / Publish)                                                                                                                        | ok | ok                                        | 10, one off by one | L1-S2                        |
| 1.6  | browser (Pull Request creation, merge box), 3 (merge, comments, Files)                                                                                                   | ok | ok                                        | ok (11)            | L1-F1, L1-O4, L1-O5          |
| 1.7  | 2, browser (field, grant, list view, Pull Request), 3 (retrieve, merge)                                                                                                  | ok | ok                                        | ok (1)             | L1-P1                        |
| 2.1  | 2 (simulate), 3 (`backpromote --plan` then `--auto`, Back, merge question)                                                                                               | ok | ok                                        | ok (8)             | L2-F1                        |
| 2.2  | 2, browser (field, record test, Pull Request), 3 (flow as XML)                                                                                                           | ok | ok                                        | 9 of 12            | L2-S1, L2-O1                 |
| 2.3  | 2, browser (Required, refused save, Pull Request), 3 (retrieve, `action:create`, merge)                                                                                  | ok | ok                                        | ok (5)             | L2-P1, L2-P2                 |
| 2.4  | 2 (records, export), 3 (object, fields, tab as XML, `action:create`, rerun), browser (grants, tick, Pull Requests)                                                       | ok | ok                                        | 6 of 9             | L2-P3, L2-S2, L2-O2          |
| 2.5  | 2 (Apex Tests card), 3 (pastes, deploy to the org), browser (Pull Request)                                                                                               | ok | ok                                        | ok (2)             | L2-P4                        |
| 2.6  | 2, browser (field security, permission set grant), 3 (Auto retrieve, dry-runs)                                                                                           | ok | ok after the lab's own "If it goes wrong" | ok (3)             | L2-F2, L2-P5                 |
| 2.7  | 2 (simulate, Save / Publish), browser (grant, Pull Request), 3 (flows as XML, merge by git)                                                                              | ok | ok                                        | 4 of 11            | L2-P6                        |
| 2.8  | 2 (`resetselection`), 3 (layout as XML, over-wide selection by script, discard)                                                                                          | ok | ok                                        | ok (4)             |                              |
| 2.9  | 2, 3 (object, flow, records from the Level 3 start state), browser (grant, Pull Request)                                                                                 | ok | ok                                        | 0 of 1             | L2-P7                        |
| 3.1  | 2 (seed x2, `work:new`, `auth.mjs` x2, Save / Publish), browser (branch, rule up to Create, Policies page, Pull Request), 3 (rules, secrets, Pipeline Settings as files) | ok | ok                                        | ok (18)            | L3-P1, L3-O1, L3-E1          |
| 3.2  | 2 (simulate), 3 (review, Files, merge)                                                                                                                                   | ok | ok                                        | ok (4)             |                              |
| 3.3  | log read, 2 (simulate, Retry, Mark as done), 3 (review, group, merges)                                                                                                   | ok | ok                                        | ok (9)             | L3-O2, L3-O3                 |
| 3.4  | 2 (simulate x2), 3 (review)                                                                                                                                              | ok | ok                                        | ok (2)             |                              |
| 3.5  | 3 (remote site, no-overwrite entry, rerun, description), 2 (publish, release notes), browser (Pull Request, Deliverability, tick)                                        | ok | ok                                        | ok (7)             | L3-P2, L3-O4, L3-O5          |
| 3.6  | browser (Pull Requests, Deliverability, ticks), 3 (DORA call, rerun, merges), 2 (export)                                                                                 | ok | ok                                        | ok (5)             | L3-E2                        |
| 3.7  | 3 (reproduce in prod, merges, merge of `origin/main`), 2 (simulate, `work:new`, Save / Publish), browser (Pull Requests)                                                 | ok | ok                                        | ok (12)            | L3-O6, L3-S1                 |
| 3.8  | 2 (`mon.mjs`, publish), 3 (repository, secret, config edits, Run workflow, Pipeline Settings); steps 5, 6 read against the log                                           | ok | ok                                        | ok (4)             | L3-O7, L3-O8                 |
| 3.9  | 2 (`project2markdown --with-history`), paragraphs written by script                                                                                                      | ok | ok                                        | ok (1)             |                              |
| 3.10 | 2 (simulate x5, `promotion:create`, `work:new`), browser (Pull Requests), 3 (resolutions by file edit, description, merges)                                              | ok | ok                                        | ok (10)            | L3-P3, L3-O9, L3-O10, L3-E3  |
| 3.11 | 2 (simulate, release notes, DORA export), browser (Pull Requests), 3 (merges, DORA call)                                                                                 | ok | ok                                        | ok (1)             | L3-O11, L3-O12, L3-E4, L3-E5 |

Every "ok" in column B ended with the lab's own `Check my work` passing. At the end, from the
clone: `check --level 1` 6 of 6, `--level 2` 9 of 9, `--level 3` 11 of 11.

Fork Pull Requests, by lab:

| Lab  | Pull Requests of the fork                                                                                              |
|------|------------------------------------------------------------------------------------------------------------------------|
| 1.6  | #44 US-014                                                                                                             |
| 1.7  | #45 US-016                                                                                                             |
| 2.1  | #46 US-017 (simulate)                                                                                                  |
| 2.2  | #47 US-021                                                                                                             |
| 2.3  | #48 US-024                                                                                                             |
| 2.4  | #49 US-026 metadata, #50 US-026 actions                                                                                |
| 2.5  | #51 US-027                                                                                                             |
| 2.6  | #52 US-033 profile, #53 US-033 permission set                                                                          |
| 2.7  | #54 US-018 (simulate), #55 US-034                                                                                      |
| 2.8  | #56 US-038                                                                                                             |
| 2.9  | #57 US-019 (simulate), #58 US-041                                                                                      |
| 3.1  | #59 US-050 configuration                                                                                               |
| 3.2  | #60 US-052                                                                                                             |
| 3.3  | #61 US-056, #62 US-062, #63 US-062 fix                                                                                 |
| 3.4  | #64 US-020, left open on purpose                                                                                       |
| 3.5  | #65 no-overwrite configuration, #66 integration to uat                                                                 |
| 3.6  | #67 uat to preprod, #68 release 2026-09                                                                                |
| 3.7  | #69 US-045 hotfix, #70 hotfix to production, #71 retrofit US-045                                                       |
| 3.8  | #72 `monitoringRepository` configuration                                                                               |
| 3.10 | #73 US-058, #74 US-057, #75 US-059, #76 US-060, #77 US-061, #78 integration to uat, #79 promotion branch, #80 retrofit |
| 3.11 | #81 US-055, #82 integration to uat, #83 uat to preprod, #84 release 2026-10 week 4                                     |

What the walk showed, on the released image:

- **Lab 1.6**: "7 components would change (1 created, 6 updated), 36 validated", coverage 100%,
  then "Full Quick Deploy: 7 components changed". The comment matched the lab word for word.
- **Lab 2.2**: the check red with the field integrity error and the flow diff comment of five
  properties, as the lab says.
- **Lab 2.5**: three rounds: Mega-Linter red on `OperationWithLimitsInLoop`, then the check red at
  76.92% under the 80% target, then green at 95.38%.
- **Lab 2.7**: the permission set conflict is the lab's snippet character for character.
- **Lab 2.8**: the reset asked one question, the second Pull Request carried one layout.
- **Lab 3.3**: #61 red on exactly `Crew_Workload__c`, #62 deployed with a failed action, Retry,
  "Run the next action only" failing on `CrewCapacityBach`, #63 with `movedFrom: 62`.
- **Labs 3.5 and 3.6**: each promotion red once on the deliverability step, green after the tick
  and a rerun. The seven actions ran in lab order in `uat`, `preprod` and `main`. First JWT logins
  to `preprod` and `main` green. RemoteSiteSetting protected by the no-overwrite file.
- **Lab 3.8**: the four monitoring jobs green in 9 min 20; the backup committed 1468 files plus
  `AGENTS.md` and `CLAUDE.md`; `ActiveScratchOrgs` at 100% in the report; "Sent email" in the log.
- **Lab 3.10**: US-057 clean, US-059 conflicting on exactly the layout and the Helios Delivery
  Manager permission set, US-061 clean; check red on the markers, green after the resolution;
  retrofit #80 with 0 changed files; `git merge-tree integration preprod` clean.
- **Lab 3.11**: the promotion into `preprod` without a conflict; the release into `main` read 13
  components, nothing deleted.

## The whole-Profile verdict

The 2026-10-12 run proved the fix with dry-runs of the Profile alone. This run walked it.

- Lab 2.6, Auto retrieve (`sf hardis mdapi read -m "Profile:Helios Crew" --active-only`): **1808
  lines, 59 layout assignments, 139 tabs, 185 field permissions**. After Save / Publish ("clean
  sfdx project"): 743 lines, 59 layouts, 139 tabs, no field, object or user permissions.
- #52 went red on `no Layout named ContactPointOttSvc-Contact Point OTT Service Layout found`, then
  on `SecurityDefenseActionEventStore`. Both blocks were removed on the story's branch, as the lab's
  troubleshooting entry says. Nothing else was refused: the French-named layouts of 2026-10-12 are
  gone since the teardown.
- A dry-run of the whole package then **Succeeded** on `helios-prod` and `helios-preprod`. The
  Profile alone fails on `no CustomTab named Crew_Capacity__c`, which the package carries: test the
  whole package, not the file.
- Lab 3.1 seeded both orgs ("Created Helios Crew Profile", exit 0). #66, #67 and #68 validated and
  deployed it, green.

## Findings

Ids are those of NOTES, prefixed by level. F a defect a learner meets, P prose, C a check rule, S a
picture, O an observation, E a harness question, X maintenance.

### Defects a learner meets

- **L2-F1 (Lab 2.1, fixed in the extension, course `3fedb4d` then reworded)**: Back returns to
  `features/US-016-crew-notes`, the Level 1 story, squash merged and deleted on the fork. The
  extension asks *Merge integration into it?*, because `shouldOfferParentMerge` only tests whether
  `origin/integration` is an ancestor, which a squash-merged branch never is. **Merge integration**,
  as the lab said, stops on a conflict in the Installation layout and leaves the clone mid-merge.
  Every learner who did Level 1 meets this. The lab now says to close the question when the branch
  is a story already merged. Fixed in the extension after the walk: Back no longer offers the merge
  when the branch tracks a remote that no longer has it (`git config branch.<b>.remote`, then
  `git ls-remote --heads`). Unit tests 946 passing; the signal was read on the walk's clone
  (`features/US-016-crew-notes` gone, `integration` present). The panel was not driven again with
  the fix. Lab 2.1 now says recent extensions no longer ask, and to close the question otherwise.
- **L2-F2 (Lab 2.6, open)**: only `helios-dev` has the `ContactPointOttSvc` and
  `SecurityDefenseActionEventStore` layouts (Tooling `Layout` query on the five orgs). It was
  recreated on 2026-10-12, the other orgs are older. Here it showed on Lab 2.6's own Pull Request; a
  learner whose three scratch orgs come from the same Lab 1.2 meets it in Lab 3.1 instead, whenever
  the scratch orgs are newer than the Developer Edition orgs. The lab's troubleshooting covers it.
  Whether a Developer Edition org signed up today has the two layouts is still not known.
- **L1-F1 (Lab 3.10 text, fixed in `40328fe`)**: a reflow of #153 put "#65" at the start of a
  line and `markdownlint --fix` made it `# 65; yours carry other numbers`, a top-level heading in the
  middle of step 6, English and French. MegaLinter's markdownlint then reports 4 errors (MD025,
  MD001) on every Pull Request of the fork, starting with the learner's first one in Lab 1.6, which
  explains only the workflow auditor's warning.

### Check rules

None found this run. Every rule passed after its lab and none passed early: rule 3.4 waited for the
US-020 branch (#64), as fixed on 2026-10-12.

### Prose, fixed in English and French

- **L1-P1 (Lab 1.7, `da433c8`)**: "Long Text Area" where the wizard lists **Text Area (Long)**.
- **L2-P1, L2-P2 (Lab 2.3, `018349b`)**: the Required warning opens the moment the box is ticked,
  before Save. On save a record page shows "We hit a snag" and the field, not `Required fields are
  missing`, which is what a script meets.
- **L2-P3 (Lab 2.4, `1dc025e`)**: no Record Name was given for Crew Capacity. Setup's default is
  Text, and the 12 records then show their ids as names. Now the Auto Number `CAP-{00000}` the
  start state and the picture use.
- **L2-P4 (Lab 2.5, `1ccc40a`)**: the Apex Tests card read 100% on `helios-dev` while the check
  read 76.92%: the batch classes of Labs 2.3 and 2.4 went to `integration` and never came down. A
  paragraph explains it.
- **L2-P5 (Lab 2.6, `8f80258`)**: the troubleshooting entry did not say where to remove the block
  when the lab's own Pull Request goes red: on that branch, or in a Fix story once merged.
- **L2-P6 (Lab 2.7, `d11e318`)**: the merge message ends with `into features/US-034-crew-override`,
  and during a merge the button reads **Continue**, not Commit.
- **L2-P7 (Lab 2.9, `9be93b6`, `2328584`)**: the Handover Item fields had no types and no Record
  Name. Now given, from the Level 3 start state.
- **L3-P1 (Lab 3.1, `85d0094`)**: step 7 named a "Permitted Users" label. The page shows **App
  Authorization** above the tabs and **App Policies > Selected Profiles** on the Policies tab.
- **L3-P2 (Lab 3.1, `efc7730`)**: the promotion comment of Lab 3.5 counted 16 tickets, without
  US-050. The commit message of Lab 3.1 had no story number, and GitHub reuses it for the Pull
  Request title and the squash commit. The lab now commits as `US-050 Configure the pipeline up to
  production`. On the CLI side, the promotion comment and the release notes find tickets from
  different sources: the notes read the carried Pull Request titles, the comment does not. Not
  changed.
- **L3-P3 (Lab 3.10, `44ddbd6`)**: step 9, the same defect as L2-P6: the message ends with `into
  retrofit/US-059-retrofit` and the button reads **Continue**.
- **X1 (`7e16754`)**: `i18n/fr.json` read BEHIND: #170 changed three stats strings in both
  languages without the stamp. Stamped.

### Pictures, open

- **L1-S1** (F1 of 2026-10-12): `training-menu-authorization.png` shows extension v8.6.1 and 5
  cards; the Level 1 menu has 7. Unknown to `shots.mjs`.
- **L1-S2**: `package-xml--custom-field.png` reads 13 CustomField members and 35 in total; a
  learner reads 14 and 36. The text quotes no number.
- **L2-S1**: `editor-field-file.png` shows a `<description>` the lab does not ask for.
- **L2-S2**: `crew-capacity-records.png` was taken in the Sales app; the lab opens the tab of the
  Helios Delivery app.
- **L3-S1**: `work-new-story-type--retrofit.png` reads "Automatically selected target branch is
  integration"; at Level 3 the target branch is asked first, as the lab's table says.
- Still true from 2026-10-12: S3 (side bar versions v8.12.1 / v8.13.0 on the action pictures and
  `pipeline-config-user-stories--target-branches`).

### Observations, not fixed

- **L1-O1**: pill 3 of `setup.png` boxes only the Git card; the text says "Node.js and Git".
- **L1-O2**: `init` prints "will work in English from now on" on every run, also when the user
  already does.
- **L1-O3**: `helios-integration` and `helios-uat` expire on 2026-10-24.
- **L1-O4**: the zizmor ⚠️ is the tokenless 401, as expected.
- **L1-O5**: the maintainer's fork shows two Socket Security checks a learner does not have.
- **L2-O1**: the simulated US-017 does not update `manifest/package.xml`; the field still deploys.
- **L2-O2**: the export's first question names the org by its username, not `helios-dev`.
- **L3-O1**: the External Client App page carries Salesforce's banner on retiring the OAuth
  user-agent flows. JWT is not affected; no lab says so.
- **L3-O2**: after the recovery of Lab 3.3, the deployment comment of #62 still shows the failed
  action; only the Deployment Actions comment turns green, which is the one the lab names.
- **L3-O3**: the Mark as done note names the git user, not "(your username)".
- **L3-O4**: in the table of a promotion check the post-deploy rows show ⚪ while the summary counts
  them "🕒 after the merge". The picture matches the product.
- **L3-O5**: Publish my pipeline configuration asks "Put it on a new branch ... ?", which no lab
  names.
- **L3-O6** (seen on 2026-10-12): the retrofit asks two org questions; the lab's table names only
  `helios-dev`.
- **L3-O7**: seven monitoring repositories of earlier runs (`sfdx-hardis-training-monitoring`,
  `-run2` to `-run5`, `-0925`, `-0926`) still run their workflow and fail every night.
- **L3-O8**: the Monitoring Config Workbench shows a Data anonymization card no lab mentions.
- **L3-O9**: the conflict prompt file name has another format than the lab's example; the lab says
  the numbers differ.
- **L3-O10**: the check comment of #79 reads "3 tickets · 3 other Pull Requests" for the three Pull
  Requests it carries.
- **L3-O11** (O7 of 2026-10-12): the release notes also list stories against the retrofit Pull
  Requests, and US-045, in `main` since Lab 3.7, comes back in the notes of the release.
- **L3-O12**: the DORA Export names its file by date. Done the same day as Lab 3.6, Lab 3.11's
  export overwrites the baseline the lab says to compare with.
- Known: `action:create --agent` writes `command: ""` and `allowFailure: false`; the Lab 3.1 check
  reads "3 components would change" on a configuration Pull Request (O3 of 2026-10-12).

### Harness

- **L3-E1**: `helios-preprod` and `DevHub` are two aliases of the same username on this
  workstation; `auth.mjs` was given `DevHub`. A learner has one alias.
- **L3-E2**: the reused fork's history inflates DORA: `main` read 0.4 then 0.5 deployments a week
  where the lab prints 0.1 for one release. Only the shapes were compared.
- **L3-E3**: the first merge of #78 was refused while Mega-Linter ran; the retry merged.
- **L3-E4**: the first `doc:release-notes` run asked its question in the terminal instead of the
  headless panel, then exited; the retry asked the panel. Not reproduced.
- **L3-E5**: `doc:dora-report` headless needs `GITHUB_TOKEN`.
- Level 2: `walk/l14-record.mjs` typed every value into Panels Required whatever label was asked.
  Fixed in `fff013e59`.

### Skill changes

New helpers in `scripts/walk/`: `l14-field.mjs` (the field wizard of Labs 1.4 and 1.7),
`l22-field.mjs`, `l23-required.mjs`, `deliv-read.mjs`, `deliv-set.mjs`, `l31-policies.mjs`.
Runbook traps added for each level, and the Lab 3.8 line corrected: the first monitoring run is
green now, the scratch org limit shows in the report.

## Open decisions for the maintainer

- **L2-F1**: fixed in the extension. The sentence of Lab 2.1 for older extensions can go once
  most learners run the release that carries it.
- **L2-F2**: scratch orgs newer than the Developer Edition orgs carry two layouts the others lack.
  The lab covers it; whether to align orgs some other way is open.
- **Pictures**: L1-S1, L1-S2, L2-S1, L2-S2, L3-S1, and S3 of 2026-10-12.
- **L3-O12**: the DORA export overwrites a same-day baseline. A course sentence, or a file name with
  the time.
- **L3-O7**: seven old monitoring repositories fail every night. Disable or delete them (`gh` has
  no `delete_repo` scope here).
- **L3-P2**: the promotion comment and the release notes find tickets differently.
- The open O items above.

## What this run did not cover

- **Lab 1.1** was read, not performed.
- **Lab 1.2 steps 1 to 4** were done before the run; **step 7** (the extension's GitHub sign-in) is
  not drivable; step 8 was not checked.
- **The webview DOM.** Only Labs 1.2, 1.3 and the Save / Publish of Lab 1.5 ran in the lab driver.
  No panel was clicked anywhere else: the Metadata Retriever, Source Control, the package viewer,
  the merge editor, the Pull Request window and its tabs, the DevOps Pipeline diagram, its windows,
  `+ PR` chips and toggles, the Deployment Actions tab and editor, Pipeline Settings, the
  Backpromote panel, the Data Workbench, the DORA panel, the Orgs Manager, the Documentation,
  Monitoring and Monitoring Config Workbenches. Their commands ran instead.
- **Fidelity 3 where a learner clicks**: every merge; every **Re-run all jobs**; every review
  comment and Pull Request description; the retrieves of Labs 1.5 to 2.9; the flows of Labs 2.2,
  2.7 and 2.9 (XML, never Flow Builder); the objects, fields and tabs of Labs 2.4 and 2.9 (XML);
  the ten records of Lab 2.9 (bulk upsert); the layout move of Lab 2.8; the conflict resolutions of
  Labs 2.7 and 3.10 (git and file edits); every `action:create`; the public group of Lab 3.3; the
  remote site and the no-overwrite entry of Lab 3.5; Pipeline Settings of Labs 3.1 and 3.8; the
  repository, secret and Run workflow of Lab 3.8; the DORA panel (its command).
- **GitHub's Confirm access page** (sudo mode) blocked the branch rules of Lab 3.1: created with
  the lab's `gh api` call, secrets with `gh secret set`.
- **Email Deliverability** already read "All email" in `uat`, `preprod` and `prod` from earlier
  walks (the teardown does not undo it): the Setup change itself was never made.
- **About 15 of the Level 2 pictures were not opened** (Labs 2.2, 2.4, 2.7, 2.9 have counts in the
  table).
- **The monitoring email**: the job logs it as sent; no mailbox was read.
- **The badge claims** of the three levels: not run (a claim opens a public issue on the shared
  repository). The claim text was read.
- **The reset path**: no **Reset this level** was run.
- **The French side** was edited with every English fix and stamped, not walked.
- **An agent is not a beginner**: prose clarity was tested only as far as an agent can.

## Left behind

- The fork with Pull Requests #44 to #84: #64 (US-020) open on purpose, the others merged.
  `delete_branch_on_merge` on; the major branches stay.
- The monitoring repository `nvuillam/sfdx-hardis-training-monitoring-run7`, its workflow
  **disabled**, and `-run6`'s workflow disabled too. Seven older ones still active (L3-O7).
- The five orgs in their end-of-Level-3 state. The External Client Apps of Labs 3.1 and 3.8 are in
  `helios-preprod` and `helios-prod`. `helios-integration` and `helios-uat` expire on 2026-10-24.
- The clone `C:/git/training-run` on `integration`, default org `helios-prod`, with untracked
  `hardis-report/` and `docs/` (release notes, DORA export, project documentation). The monitoring
  clone `C:/git/training-monitoring-run7`. Notes and logs in `C:/git/training-e2e/run-1016`.
- The e2e Chrome on port 9222.
- The local CLI still linked to `C:/git/sfdx-hardis` (`sf plugins install sfdx-hardis` gives the
  release back).
- The course branch `fix/e2e-2026-10-16` (14 commits) and the sfdx-hardis branch
  `fix/training-e2e-2026-10-16`, local at the time of writing.

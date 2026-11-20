# Training end to end run, 2026-10-12

The whole course walked "all levels like a newbie": a learner who reads the published page and does
what it says, in its order. Three agents walked one level each, in order, on the same fork and the
same orgs, with **no reset between levels**. The fork did not exist at the start: `init` created it,
as a learner's does. Every CI job of the fork ran the **released image** `latest`, with no override.
**Level 1 7 labs (check 6 of 6, Lab 1.1 read, not performed), Level 2 9 of 9, Level 3 11 of 11.**

The walk found **one blocker on the path walked straight from Level 2 (F4)**, two check rules that
passed before their lab was done, and about twenty places where the text or a picture disagreed with
what a learner gets. No defect was fixed in sfdx-hardis or in the extension: every fix is in the
course.

- **F4 (blocker, fixed in the course, proof partial)**: a learner who did Lab 2.6 as written could
  not seed `helios-preprod` nor `helios-prod` in Lab 3.1. The Helios Crew profile retrieved whole
  from a scratch org named layouts and tabs the Developer Edition orgs do not have. The cause is two
  org features and the language of the user, not the product. See Findings.
- **C1 and C2 (fixed)**: the rules of Labs 2.8 and 3.4 passed on an environment where the lab had
  not been done, so "Where am I?" showed Level 2 at 1 of 9 on a new fork, and Level 3 at 1 of 11
  before Level 3 started.
- **The whole release passed on the released image**: the three promotions of Labs 3.5 and 3.6 each
  stopped red once on the deliverability step and went green after the tick, with no harness Pull
  Request. Read "What this run did not cover" before relying on it: the promotions ran with a
  cleaning rule that was reverted afterwards.

## Versions under test

| Thing              | Version                                                                                                                                                    |
|--------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| sfdx-hardis        | 8.17.0, linked (`sf plugins link`) from branch `fix/training-e2e-2026-10-12`, cut from `origin/main`: the released v8.17.0 plus documentation commits only |
| vscode-sfdx-hardis | `main` at `38df7cee`, `yarn compile` then `yarn dev`                                                                                                       |
| Course             | branch `fix/e2e-2026-10-12`, cut from `main` at `aadf504`                                                                                                  |
| CI image           | the released `sfdx-hardis-ubuntu:latest`, no source-build override, on the fork and on the monitoring repository                                           |
| Published site     | `main` at `aadf504`. Pass A read the published pages. The fixes of this run are on the course branch, ahead of the site                                    |

The sfdx-hardis branch sits on `430ae2c41` (v8.17.0 is `4077ce021`). Its commits (`654486cc3`,
`22b8caacf`, `0dda317aa`, `27b2b5929` for the runbook, then this report) change no code, and `lib/`
was not touched.

## Environment

| Item            | State                                                                                                                                                                                                                      |
|-----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Fork            | `nvuillam/sfdx-hardis-training`. It did not exist. `init` created it in Lab 1.2; the Actions banner was clicked over CDP 17 s after the fork appeared. Not reset between levels                                            |
| Orgs            | `helios-dev`, `helios-integration`, `helios-uat` (scratch), `helios-preprod`, `helios-prod` (Developer Editions, French; `helios-prod` is the Dev Hub). All five torn down before Level 1, each teardown ended with exit 0 |
| Monitoring repo | `nvuillam/sfdx-hardis-training-monitoring-run6`, new and private                                                                                                                                                           |
| Learner clone   | `C:/git/training-run`, cloned for the run. Its scripts stayed the course as forked (`aadf504`) for the whole walk                                                                                                          |
| Browser on CDP  | the dedicated Chrome profile on port 9222, signed in to GitHub, not to Salesforce                                                                                                                                          |

Started clean: yes for the fork (created by the walk) and for the five orgs (torn down). One trace
of the previous walk stayed: nine SourceMember rows of `helios-dev` named fields that no longer
exist. A learner whose org was never torn down has none.

During the run the maintainer's decision on branch deletion was applied to the fork:
`delete_branch_on_merge` was switched on while Lab 3.3 ran. Level 1, Level 2 and the start of Level
3 ran with it off.

## Screenshots

- **VS Code** (Level 1 agent): `shots.mjs --all --kind vscode`, compared pixel by pixel with the
  previous pictures. 71 raw pictures changed, all under 0.3% (side bar versions and dates) except
  `promotion-create-conflict` at 8.65%. 160 picture files committed (`644c7b8`). Annotated pictures:
  largest difference 0.18%, no pill moved.
- Retried: `promotion-create-conflict` (the fourth answer was cut, see E1) and
  `metadata-retriever-recent-changes` / `-selected` (the org combo read "Select an Option", the same
  flake as on 2026-10-08). Kept as it was: `backpromote-loading` (the harness stops at the third
  step, the lab names the fourth).
- **Retaken at Level 3**: `github-pr-promotion-actions` from the walk's promotion #24, with three
  pills pinned again (the comment gained a Validation | Deployment line);
  `github-pr-deployment-actions` from a throwaway Pull Request #25, now reading "Retry" (S1);
  `promotion-create-conflict`, with its four answers whole. NOTES counts four pictures retaken at
  Level 3 and names these three.
- **Pinned again**: pill 1 of `sidebar.png` (S2).
- **Not retaken, unknown to `shots.mjs`**: `training-menu-authorization` (F1), and the four of S3.
- No Salesforce picture was retaken. The Flow Builder toolbar of Lab 2.2 was compared with a capture
  of the day: same, with one more history button.

## Lab by lab

Fidelity: **1** lab driver (real VS Code panel, real CLI), **2** headless panel (`panel.mjs`,
`panel-node.mjs` for the Training menu, `auth.mjs`, `mon.mjs`), **3** direct `sf` / `git` / `gh` /
API or a file edit, **browser** the real page over CDP.

Pass A is the read of the published page, B the walk, C every picture opened and compared. NOTES
records pass A for Lab 1.1 and for the eleven Level 3 pages, all fetched from the published site. For
the other labs it records no pass A line, so the column says "not recorded" and not "ok".

| Lab  | Fidelity                                                                                                                                                  | A            | B                | C                       | Findings              |
|------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|------------------|-------------------------|-----------------------|
| 1.1  | read only                                                                                                                                                 | ok           | not covered      | ok (8 pictures)         |                       |
| 1.2  | 1 (lab driver); banner over CDP; steps 1 to 4 and 7 not performed                                                                                         | not recorded | ok, partly       | count not recorded      | F1, P1, O1, C1 (seen) |
| 1.3  | 1                                                                                                                                                         | not recorded | ok               | ok (6)                  | P2                    |
| 1.4  | browser (field wizard by direct URL, grants, record values)                                                                                               | not recorded | ok               | not recorded            | P2                    |
| 1.5  | 3 (retrieve, commit), 1 (Save / Publish)                                                                                                                  | not recorded | ok               | ok (10)                 | P3                    |
| 1.6  | browser (Pull Request creation, merge box read), 3 (merge, branch delete, Files by `artifacts:download`)                                                  | not recorded | ok               | ok (11)                 |                       |
| 1.7  | 2 (`work:new`, Save / Publish), browser (field, grant, list view, Pull Request), 3 (retrieve, merge)                                                      | not recorded | ok               | not recorded            | P4                    |
| 2.1  | 2 (simulate), 3 (`backpromote --plan` then `--auto`)                                                                                                      | not recorded | ok               | ok (8)                  | P5, P6                |
| 2.2  | 2 (`work:new`, Save / Publish), browser (field, Pull Request), 3 (flow as XML, test by Apex, retrieve, merge)                                             | not recorded | ok               | ok (12)                 | P7                    |
| 2.3  | 2, browser (Required, Pull Request, refused save), 3 (retrieve, `action:create`, merge)                                                                   | not recorded | ok               | ok (5)                  |                       |
| 2.4  | 3 (object, fields, tab as XML, export, `action:create`, rerun), browser (grants, box tick, Pull Requests), 2 (records)                                    | not recorded | ok               | ok (9)                  | F2, O2, S1            |
| 2.5  | 3 (file edits, deploy to the org), 2 (Apex tests), browser (Pull Request), CI                                                                             | not recorded | ok               | ok (2)                  | P8                    |
| 2.6  | browser (field security, permission set grant), 3 (profile read, retrieve)                                                                                | not recorded | ok               | ok (2)                  | F3, F4 (origin)       |
| 2.7  | 3 (flows as XML, merge, resolution by file edit, deploy), browser (grant, Pull Request), 2 (simulate, Save / Publish)                                     | not recorded | ok               | ok (11)                 | P9                    |
| 2.8  | 3 (layout as XML, retrieve, profile read, discard), 2 (`resetselection`)                                                                                  | not recorded | ok               | ok (4)                  | C1, P10, S2           |
| 2.9  | 3 (object, flow as XML, records by Apex, export, `action:create`), browser (grants, Pull Request), 2 (simulate)                                           | not recorded | ok               | ok (1)                  | P11, C2 (seen)        |
| 3.1  | 2 (seed x2, `work:new`, `auth.mjs` x2, Save / Publish), browser (branch, rule up to Create, Pull Request), 3 (rules, secrets, Pipeline Settings as files) | ok           | ok after F4      | ok (count not itemised) | F4, O3, O4            |
| 3.2  | 2 (simulate), 3 (review, merge, branch delete)                                                                                                            | ok           | ok               | ok (4)                  |                       |
| 3.3  | log read, 2 (simulate, `action:run`), 3 (review, group, `set-status`)                                                                                     | ok           | ok               | ok (8)                  | P12, S3               |
| 3.4  | 2 (simulate x2), 3 (review)                                                                                                                               | ok           | ok               | ok (2)                  | C2                    |
| 3.5  | 3 (remote site, no-overwrite entry, rerun, description), 2 (publish, release notes), browser (Pull Request, Deliverability, tick)                         | ok           | ok               | ok (7)                  | S1 (retake)           |
| 3.6  | browser (Pull Requests, Deliverability x2, ticks), 3 (DORA call, rerun, merges), 2 (export)                                                               | ok           | ok               | ok (count not itemised) | P13, O4               |
| 3.7  | 3 (reproduce in prod, merge of `origin/main`), 2 (simulate, `work:new`, Save / Publish), browser (Pull Requests)                                          | ok           | ok               | ok (12)                 | O5                    |
| 3.8  | 2 (`mon.mjs`, publish), 3 (repository, config edit, secrets, Run workflow, Pipeline Settings); steps 3, 5, 6 read                                         | ok           | ok (partly read) | ok (4)                  | P16, F6, S4           |
| 3.9  | 2 (`project2markdown --with-history`), paragraphs written in the files                                                                                    | ok           | ok               | ok (1)                  | P14, P15              |
| 3.10 | 2 (simulate x5, `promotion:create`, `work:new`), browser (Pull Request), 3 (resolution by file edit, description, merges)                                 | ok           | ok               | ok (10)                 | E1                    |
| 3.11 | 2 (simulate, release notes, DORA export), browser (Pull Request), 3 (merges)                                                                              | ok           | ok               | ok (2)                  | P11, O7               |

Every "ok" in column B ended with the lab's own `Check my work` passing. At the end:
`check --level 1` 6 of 6, `--level 2` 9 of 9, `--level 3` 11 of 11, and the course's updated rules
(2.8 and 3.4) run against the finished clone: 26 rules, none misses.

Fork Pull Requests, by lab:

| Lab  | Pull Requests of the fork                                                                                              |
|------|------------------------------------------------------------------------------------------------------------------------|
| 1.6  | #1 US-014                                                                                                              |
| 1.7  | #2 US-016                                                                                                              |
| 2.1  | #3 US-017 (simulate)                                                                                                   |
| 2.2  | #4 US-021                                                                                                              |
| 2.3  | #5 US-024                                                                                                              |
| 2.4  | #6 US-026 metadata, #7 US-026 actions                                                                                  |
| 2.5  | #8 US-027                                                                                                              |
| 2.6  | #9 US-033 profile, #10 US-033 permission set                                                                           |
| 2.7  | #11 US-018 (simulate), #12 US-034                                                                                      |
| 2.8  | #13 US-038                                                                                                             |
| 2.9  | #14 US-019 (simulate), #15 US-041                                                                                      |
| 3.1  | #16 US-050 configuration, #17 the F4 profile fix                                                                       |
| 3.2  | #18 US-052                                                                                                             |
| 3.3  | #19 US-056, #20 US-062, #21 US-062 fix                                                                                 |
| 3.4  | #22 US-020, left open on purpose                                                                                       |
| 3.5  | #23 no-overwrite configuration, #24 integration to uat, #25 closed without a merge (E2E ONLY, picture of Lab 2.4)      |
| 3.6  | #26 uat to preprod, #27 release 2026-09                                                                                |
| 3.7  | #28 US-045 hotfix, #29 hotfix to production, #30 retrofit US-045                                                       |
| 3.8  | #31 `monitoringRepository` configuration                                                                               |
| 3.10 | #32 US-058, #33 US-057, #34 US-059, #35 US-060, #36 US-061, #37 integration to uat, #38 promotion branch, #39 retrofit |
| 3.11 | #40 US-055, #41 integration to uat, #42 uat to preprod, #43 release 2026-10                                            |

What the walk showed, on the released image:

- **Lab 1.6**: the first Pull Request of a new fork gets its two checks (Mega-Linter and Simulate
  Deployment to Major Org, green in about 2.5 minutes). The comment matched the lab word for word.
- **Lab 2.2**: the check red exactly as the lab says, with the field integrity sentence and the flow
  diff comment of five changed properties.
- **Lab 2.5**: three rounds as the lab tells them: Mega-Linter red on the PMD rule, then the
  deployment check red at 76.92% under the 80% target, then green at 95.38%.
- **Lab 2.7**: the permission set conflict is the lab's snippet character for character on the path
  walked straight from Level 1.
- **Lab 3.3**: the deployment of US-062 red as the lab says, the comments word for word, the verdict
  "1 failed, 2 waiting", then "moved to #21" after the fix.
- **Labs 3.5 and 3.6**: each promotion first red on "Set Email Deliverability to All Email (from
  #7)", green after the box was ticked in the browser and the jobs run again. The seven actions ran
  in the lab order in `uat`, `preprod` and `main`, because the learner's own Pull Request numbers
  (5, 7, 15, 20, 21) are in lab order. First JWT logins to `preprod` and `main` green.
- **Lab 3.8**: the four monitoring jobs green in 8 min 30 on the released image. The log of the
  Monitoring job says the org limits email was sent.
- **Lab 3.10**: US-057 clean, US-059 conflicting on exactly the two files, US-061 clean. Check red
  on the conflict markers, green after the resolution. The retrofit had 0 changed files.
- **Lab 3.11**: the promotion into `preprod` merged without a conflict, and the release into `main`
  read 13 components changed, nothing deleted.

## Findings

Ids are those of NOTES: F a defect a learner meets, P prose, C a check rule, S a picture, O an
observation, E a harness question. NOTES has no F5 and no O6.

### F4: the profile of Lab 2.6 could not be deployed to a Developer Edition org

**What a learner would have seen.** In Lab 3.1, **Set up one of my training orgs** failed on
`helios-preprod` and on `helios-prod`: "Profile Helios Crew: In field: layout - no Layout named
ApptBundleConfig-Appointment Bundle Config Layout found". The message the seed prints after it ("The
most common cause is a connection that expired") sends the learner the wrong way. A learner who had
passed the seed would have been stopped at the promotion from `uat` to `preprod`: the same sources
validate in `helios-uat`, a scratch org. Only the path walked straight from Level 2 meets it. After
**Reset this level**, Level 3 starts with a 24 line profile and never does.

**First fix, rejected.** The Level 3 agent added a `cleanXmlPatterns` rule to
`config/.sfdx-hardis.yml` so that Save / Publish strips the profile. The maintainer rejected that
rule and it was reverted: commits `559614f` and `1436bf4` are undone.

**Cause, found afterwards.**

- Scratch orgs come with Field Service (`FieldServiceSettings.fieldServiceOrgPref`) and the Thanks
  badges (`WorkDotComSettings.enableWorkThanksPref`) on. Developer Edition orgs have both off. A
  profile retrieved whole names the layout and the tab of every object, so it named 33 Field Service
  layouts and 59 tabs the Developer Edition orgs lack. It is not the API version (68 everywhere),
  not the edition, not the licences.
- Salesforce names the layouts it creates in the language of the user at work. Both Developer
  Edition orgs have `en_US` in Company Information, but the user was `fr`. So `Crew_Capacity__c` and
  `Handover_Item__c` got a `Présentation ...` layout there and a `... Layout` one in the scratch
  orgs. Proven in `helios-preprod` with two throwaway objects deployed before and after the switch:
  `Présentation E2E Lang Fr` and `E2E Lang En Layout`. The two objects were deleted afterwards.

**Tried and dropped.** Enabling Field Service in the Developer Edition org: 46 of 49 tabs pass, but
its 34 layouts are created with French names. It was switched back off.

**Fix in the course** (commits `76888f5` and `d0cbed9` on the course branch, English and French):

- `config/project-scratch-def.json` switches both features off and sets `language: en_US`.
- `init` sets the Dev Hub user to English and switches the two features off, once, in scratch orgs
  that already exist (`alignScratchOrgs`).
- **Set up one of my training orgs** sets the user to English before it deploys.
- Lab 2.6 gets a troubleshooting entry for `no Layout named` / `no CustomTab named`: is it yours,
  why does one org have it, fix the cause. Lab 3.1 points to it. Lab 1.2 explains the definition
  file and the one-language rule.

**Proof.**

- `helios-dev` was deleted and created again from the new definition. Both settings read back
  false.
- Its Helios Crew profile, read whole with `hardis:mdapi:read --active-only`, has 60 layout
  assignments and 135 tabs. The old `helios-dev` had 92 and 194, then 59 and 135 once the two
  settings were deployed to it. The counts are those measured: the new org has two layouts the old
  one lacked and one fewer of another kind, which was not identified, and the 34 standard layouts
  quoted for the Field Service trial were counted against a Developer Edition org, not between
  scratch orgs.
- A dry-run against `helios-prod` is refused on four names only: the two French-named custom
  layouts above, and the `ContactPointOttSvc` and `SecurityDefenseActionEventStore` layouts. Only the
  scratch org created today has those last two. The scratch orgs of 2026-09-24 and both Developer
  Edition orgs have the objects without a layout: org age, not a setting.
- Without those four names the dry-run passes in both Developer Edition orgs.
- The same settings deployed to the old `helios-dev` gave 59 layout assignments and 135 tabs.
- `helios-integration` and `helios-uat` were aligned by `alignScratchOrgs`.

What is **not** proven is listed in "What this run did not cover".

### Other defects a learner meets

- **F1 (picture, not fixed)**: `training-menu-authorization.png` (Lab 1.2 step 5) shows the Level 1
  menu with 5 cards and extension v8.6.1. The menu has 7 now. `shots.mjs` does not know this
  picture. A capture needs an extension branch and a gate in the course: left for the maintainer.
- **F2 (Lab 2.4 step 6, fixed twice)**: "The Crew Capacity tab of the Helios Delivery app, on its
  All list view, has 12 records". `helios-integration` had no All list view: the lab did not
  retrieve it and the Level 3 start state did not carry it. The tab opened on Recently Viewed. First
  fix: the text said Recently Viewed and why (`cd3530a`, French `6bfab22`). Then the maintainer
  decided the lab should deliver the list view, see "Maintainer decisions".
- **F3 (rendering, Lab 2.6 step 5)**: on the site the path "Setup > Permission Sets > ... > Panel
  Batches > Edit" was cut in two, with its asterisks showing and the end in a quote block. A line of
  the markdown started with ">". Reflowed in English (`cd3530a`). The same defect in the French Lab
  3.8, line 337, reflowed too (`6bfab22`).
- **F6 (Lab 3.8)**: the monitoring report lists a second unsecured connected app the lab did not
  name, `orgfarm_app_1`, next to Salesforce CLI. One sentence added, English and French (Level 3
  commits `a4187be`, `ca9ddc8`).
- **Lab 3.1 step 3 (no id)**: the **Create** click of the branch rule lands on GitHub's "Confirm
  access" page (GitHub Mobile, passkey or email code). The lab does not mention it and the run could
  not answer it. A troubleshooting entry was added to Lab 3.1, English and French (`12edfda`,
  `c4564c7`).

### Check rules

- **C1 (rule 2.8, fixed in `cd3530a`)**: "The repository carries only what belongs to it" passed on
  any repository with no stray file, a new fork included. It now also asks for the story's own
  outcome: `Crew_Size__c` above `Install_Date__c` on the Installation layout of `integration`.
  Proven both ways: it misses on the upstream `start-level-1`, `start-level-2` and on this fork
  before #13; it passes on this fork after #13 and on the upstream `start-level-3`.
- **C2 (rule 3.4, fixed in `12edfda` / `c4564c7`)**: "The colliding Pull Requests were ordered, and
  both grants survived" passed as soon as US-018 and US-019 were in `integration`, which the Level 2
  capstone delivers. It now also asks for the teammate branch of US-020 in the fork. Proven: it
  misses on the upstream `start-level-3`, on this walk after Lab 2.9 and before the simulate; it
  passes once the US-020 branch is there. With `delete_branch_on_merge` on, the branch of an open
  Pull Request stays, so the rule holds.
- A side effect of C1 on this walk: the receipt of Lab 2.8 is dated before Lab 2.1, so the course
  statistics will read Lab 2.8 of this walk as done first.
- The learner's clone ran the old rules for the whole walk. The new ones reach a learner through
  **Update my course** once the course Pull Request is merged.

### Prose, fixed in English and French

Level 1 in `0f2e7b4` (French and changelog `848e40a`), Level 2 in `cd3530a` (French `6bfab22`).
Level 3 fixes are in `12edfda`, `c4564c7`, `a4187be`, `ca9ddc8` and the commit on Labs 3.10 and 3.11;
NOTES does not map each Level 3 id to one commit.

- **P1 (Lab 1.2 step 2)**: "they appear in this table under those names (2), each with a green
  Connected (3)" sat under the alias picture, whose pills are also 1 and 2. The pills meant are those
  of the Orgs Manager picture, far above.
- **P2 (Labs 1.3 and 1.4)**: Lab 1.4 said the Status section "shows helios-dev as the current org".
  A scratch org has a generated username, nothing in the Status section says `helios-dev`, and Lab
  1.3 said the opposite.
- **P3 (Lab 1.5)**: the lab announced two tool commits. Save / Publish made one ("update package
  content"): there was nothing to clean.
- **P4 (Lab 1.7)**: the claim paragraph did not say that **Claim my badge** asks for a Trailblazer
  username.
- **P5 (Lab 2.1)**: "his Signed Off By field is at the bottom of the field column, under Crew
  Notes". The learner does not see Crew Notes on the record, so Signed Off By sits under Panels
  Required.
- **P6 (Lab 2.1 step 4)**: the rows that cannot be picked did not name "Point the pipeline at my
  training orgs", the one a Level 1 learner has right under #1.
- **P7 (Lab 2.2 step 2)**: "tick Visible for System Administrator only" while the screen arrives
  with 19 boxes ticked. A beginner ticks one more and leaves 19. Reworded with the header checkbox
  of Lab 1.4. Same paragraph: "missing from the list of step 2", read inside step 2.
- **P8 (Lab 2.5 steps 2 to 4)**: "paste in the method below" never said where in the file, and step
  3 showed the fixed method without saying it replaces the one of step 2. Pasting both does not
  compile. Three sentences added.
- **P9 (Lab 2.7 step 4)**: Source Control also shows two files under Staged Changes. The lab spoke
  only of Merge Changes, and step 7 said "when both are there" where a learner counts four.
- **P10 (Lab 2.8)**: step 2 said "Open the Pull Request" with none opened yet, and the lab never
  said to merge the corrected one, while Lab 2.9 and the Level 3 start state expect it merged.
- **P11 (Labs 2.9 and 3.11)**: same gap as P4 in both claim paragraphs.
- **P12 (Lab 3.3 step 13)**: "Add your user to Selected Members". The user was already a member: the
  first action puts every holder of Helios Delivery Manager in the group, and the seed grants it to
  the learner. A learner opens the group and finds nothing to add. The step now says the learner is already in the group
  (`12edfda`, French `c4564c7`).
- **P13 (Lab 3.6 step 7)**: "Yours waited 4 d in integration, 0.8 d in uat ... 5.7 d, High, over the
  ten User Stories you delivered" read as the learner's own numbers. The walk read 0.1 d, Elite, 22
  stories. One sentence added.
- **P14 (Lab 3.9, If it goes wrong)**: an entry told the learner what to say in the Pull Request
  description, while step 6 says this course opens no Pull Request for documentation. Rewritten.
- **P15 (Lab 3.9 step 1)**: "Open the Documentation Workbench" with no word on where it opens from.
  One sentence added (the Welcome page card).
- **P16 (Lab 3.8 step 8)**: "merge it with Merge pull request" where the check comment of that Pull
  Request says to squash. Fixed.

### Pictures

- **S1 (fixed)**: `github-pr-deployment-actions` read "the Run button of the Deployment Actions
  tab". Today's comment reads "the Retry button". Retaken from the throwaway #25.
- **S2 (fixed, `cd3530a`)**: on `sidebar.png` the box of pill 1 crossed the text "CI/CD (simple)"
  and the pill hid "Level 3 (custom)". Pinned again.
- **S3 (open)**: `pipeline-branch-modal-actions-failed`, `action-run-prompts`,
  `pipeline-edit-action-moved` and `pipeline-config-user-stories--target-branches` still show
  sfdx-hardis v8.12.1 or v8.13.0 in the side bar. `shots.mjs` does not know them.
- **S4 (open)**: `org-monitoring--first-report.png` is the Workbench opened on a CI/CD repository,
  with the banner "Org Monitoring Not Present (CI/CD Repo)". The lab says so, but no picture shows
  what a learner has in the monitoring repository.
- **E1 (answered)**: `promotion-create-conflict` came back twice with the fourth answer cut off.
  Retaken alone, the four answers are whole. The two cut captures were taken inside the full batch
  on a loaded machine (the test waits a fixed 1.5 s after the prompt). Harness timing, not an
  extension defect. No extension branch.
- Left as it is: in the capture behind `sidebar.png`, the row "Reset selected list of items to
  merge" is half hidden under the Status header. The Commands pane is that short in the harness.

### Observations, not fixed

- **O1**: on `clone-repository.png` pills 1 and 2 float well under their boxes.
- **O2 (fixed, `cd3530a`)**: the YAML of Lab 2.4 step 6 showed the data action without
  `runOnlyOnceByOrg`, which the dialog sets to true by default. Line added.
- **O3**: the check of #16 reads "3 components would change (3 updated)", one LWC and two profiles,
  on a Pull Request that changes no metadata. The full deployment always counts them and the lab
  says nothing of it.
- **O4**: creating the `preprod` branch in Lab 3.1 step 2 starts a Process Deployment run that ends
  green with its deployment step skipped, and DORA counts it: `preprod` reads 2 deployments where
  one promotion went there.
- **O5**: the retrofit Pull Request of Lab 3.7 lists three more checks, all skipped: "Build with
  Zensical", "Build the start branches from main and push them", "Deploy the redirect site to the
  old URL". They are the course's own workflows, which a fork carries on `main`. No lab names them.
- **O7** (same as on 2026-10-08): in the release notes of Lab 3.11, US-057, US-059 and US-061 are
  listed against the retrofit #39, and US-058 against #34. A ticket is attached to every Pull
  Request that mentions it.
- `action:create --agent` still writes `command: ""` and `allowFailure: false`, which the YAML of
  Lab 2.3 does not show.
- Lab 3.2: **Simulate my teammates** asks two questions, the work then "Create it?", which the lab
  does not name.
- Lab 3.7 part 3: the lab's table says only "helios-dev" for the two org questions (Scratch org,
  then Reuse scratch org `helios-dev`).
- Lab 2.7 step 1 asks for a decision in Flow Builder in two sentences, with no element name and no
  condition spelled out. The picture carries them. Course design, not rewritten.
- Lab 3.5 step 7: the walk's release notes count 23 Pull Requests where the lab prints 22. The extra
  one is #17, the F4 fix.
- The Badges page counts "0 sfdx-hardis Release Manager" above a table that lists one. Maintainers
  are left out of the counters by design.
- `labs/en/help.md` line 72 sends the reader to a terminal.
- Checks that were already failing and were left: `doc-links --check` reads two files of sfdx-hardis
  out of date (`src/commands/hardis/work/new.ts`, `docs/hardis/project/promotion/create.md`), and
  `check-structure` reads one difference in `labs/fr/index.md`.

### Harness errors of the run

- Lab 3.3 part 2: the review comment call failed on a Git Bash path conversion. The fix scenario and
  the merge ran first; the review on the `.forceignore` line was posted afterwards, on the first
  commit.
- Lab 3.5 step 5: `promo.sh` was started twice. The second run found the Pull Request merged and
  printed a false "no deployment job".

## Maintainer decisions applied during the run

1. **`init` turns on `delete_branch_on_merge` in the fork.** Labs 1.2, 1.6 and 3.2 updated. Major
   branches stay because they are protected: seen on the eight promotion merges of the walk (#24,
   #26, #27, #29, #37, #41, #42, #43). Head branches merged after the switch were deleted by GitHub,
   and nothing later needed them, the promotion branch of #38 included. Not seen: what the DevOps
   Pipeline diagram and the `uat` / `preprod` windows show once the promotion branch is deleted.
2. **Lab 2.4 retrieves the `All` list view of Crew Capacity.** The Level 3 start state is updated.
   Rule 2.4 is left unchanged. The start branches need republishing after the course Pull Request
   merges.

The sources do not give the commits of these two changes.

## Open decisions for the maintainer

- **French stamps**: 9 French files still read BEHIND their English source. Stamp them, or read them
  again. Every translation read BEHIND on `main` since #126, whose generator changed both languages
  without stamping. The agents kept the stamp only on the files they translated.
- **Rule 2.4**: should it require the list view, now that the lab delivers it?
- **F1**: the stale picture `training-menu-authorization.png`.
- **The open O and S items**: O1, O3, O4, O5, O7, S3, S4, and the unnumbered observations above.

## What this run did not cover

- **Lab 1.1** was read, not performed.
- **Lab 1.2 steps 1 to 4 and 7** (signup, connect, clone, `gh` install, OAuth of the extension): done
  before the run, or not drivable.
- **The badge claims** of the three levels. A claim opens a public issue on the shared repository.
  **Claim my badge** was not run. The claim text, the form and the badge pages were read.
- **F4, the full path without the cleaning rule.** Lab 2.6 retrieve, its Pull Request, the seed of
  `helios-preprod` and `helios-prod` and the promotions were not walked again with the final fix. The
  proof is dry-runs of the profile alone. Every promotion of Level 3 ran with the profile cleaned by
  the rejected rule (fork Pull Request #17).
- **F4, other unknowns.** Whether a Developer Edition org signed up today has the two "new org"
  layouts. The two French-named custom layouts still exist in `helios-preprod` and `helios-prod`
  until the next teardown creates the objects again with an English user. The troubleshooting entry
  of Lab 2.6 was written, not walked by a learner. `init` was not run end to end with the new code:
  only its scratch org steps were (`ensureScratchOrgs` then `alignScratchOrgs`, twice).
- **The two maintainer decisions** were written into the course. The sources record no walk of Labs
  1.2, 1.6, 2.4 or 3.2 as they now read.
- **The reset path.** No **Reset this level** was run. What a learner gets after a reset into Level
  2 or Level 3 was not walked.
- **The webview DOM.** Only Labs 1.2, 1.3 and the Save / Publish of Lab 1.5 ran in the lab driver.
  Not driven: the Metadata Retriever, the package viewer and its report button, Source Control, the
  merge editor, My Pull Request card, the Pull Request window and its tabs, Show feature branches,
  the Deployment Actions tab and dialog, the Backpromote panel, the Data Workbench, Pipeline
  Settings, the DevOps Pipeline diagram and its counters, the DORA panel, the Monitoring Config
  Workbench, the Documentation Workbench. The test host has no GitHub session.
- **Lab 2.1**: "nothing is picked for you this first time" was not verified (the row was passed to
  the command). Step 1b was not walked.
- **Fidelity 3 where a learner clicks**: every merge; the retrieves of Labs 1.5 to 2.9; the flows of
  Labs 2.2, 2.7 and 2.9 (deployed as XML, never built in Flow Builder); the objects, fields and tab
  of Labs 2.4 and 2.9; the layout move of Lab 2.8; the ten templates of Lab 2.9; every
  `action:create`; **Re-run all jobs**; the two Command Palette entries of the merges; SFDX: Deploy
  This Source to Org; the branch rules of `preprod` and `main` and the four secrets of Lab 3.1;
  Pipeline Settings of Labs 3.1 and 3.8 (file edits); the remote site address and the no-overwrite
  entry of Lab 3.5; the public group and its member of Lab 3.3; **Mark as done**; every review
  comment; the Pull Request descriptions; the repository, secrets and **Run workflow** of Lab 3.8;
  the conflict resolutions of Labs 2.7 and 3.10 (file edits).
- **Lab 1.4**: the field wizard was opened by its direct URL. The Setup navigation was not clicked.
- **Lab 3.1 step 7** (the Policies page) was not opened. The **Create** click of the branch rule was
  not completed in the browser.
- **Lab 3.8 steps 3, 5 and 6** (Workbench panels, triage) were read, not done. **The email**: the
  job log says it was sent and the org's daily email limit dropped by two. Nobody read a mailbox:
  delivery, subject, attachment and spam folder are not proven. A second email (DEPLOYMENTS) went
  out because the first seed failed on F4; a learner without that failure gets one.
- **The nightly job in `helios-preprod`** is known from its green deployment action, not queried.
- **Pass A for Levels 1 and 2** is not recorded lab by lab in NOTES, except Lab 1.1.
- **Picture counts** are not recorded for Labs 1.2, 1.4 and 1.7, and not itemised for 3.1 and 3.6.
  The inner panels of Flow Builder were not compared.
- **The French side** was edited with every English fix and checked for structure, not walked.
- **An agent is not a beginner**: prose clarity was tested only as far as an agent can.

## Left behind

- The fork with Pull Requests #1 to #43: #22 (US-020) open on purpose, #25 closed without a merge.
  `delete_branch_on_merge` is on. Branches merged before the switch are still there. The
  `cleanXmlPatterns` rule merged by #17 is still in the fork's branches: the next run resets the
  fork, which removes it.
- The monitoring repository `nvuillam/sfdx-hardis-training-monitoring-run6`. Its workflow runs every
  night at 00:00 UTC against `helios-prod` until the repository is removed or the workflow disabled.
  Expect one email a night to the address in its secret while the scratch org limit stays at 3 of 3.
- The five orgs in their end-of-Level-3 state, with both Developer Edition users now in English.
  One exception: `helios-dev` was deleted and created again for the F4 proof, so it is a new scratch
  org, until 2026-11-11. It holds the metadata of the fork's `integration` branch and no data.
  `helios-integration` and `helios-uat` have Field Service and the Thanks badges off since the
  alignment. The External Client Apps of Labs 3.1 and 3.8 are in
  `helios-preprod` and `helios-prod`.
- Chrome with remote debugging on port 9222.
- The local CLI still linked to `C:/git/sfdx-hardis` (`sf plugins install sfdx-hardis` gives the
  release back).
- The clones `C:/git/training-run` and `C:/git/training-monitoring-run6`.
- The course branch `fix/e2e-2026-10-12` (training Pull Request #131) and the sfdx-hardis branch
  `fix/training-e2e-2026-10-12` (Pull Request #2332), both pushed whole.
- The extension clone is clean: the generated fixture that had copied the rejected rule was
  restored.

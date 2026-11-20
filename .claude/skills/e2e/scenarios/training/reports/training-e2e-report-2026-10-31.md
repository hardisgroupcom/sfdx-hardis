# Training end to end run, 2026-10-31

Part of the unattended night run of 2026-10-31. One agent per level; this report covers
**Level 1**, walked on a reset fork and torn-down orgs. Levels 2 and 3 follow on the same fork with
no reset and are appended below when they run.

- **Level 1: 6 of 6** (`check --level 1 --lab all`), Lab 1.1 read and not performed, every other lab
  ending on its own `Check my work` passing. Pull Requests #85 (US-014) and #86 (US-016), both green
  at the first try and deployed to `helios-integration`.
- **One defect every learner meets (L1-F1)**: the MegaLinter comment of every learner Pull Request
  reads **markdownlint ⚠️ 21 errors**, all of them in the course (duplicate `Why` headings since the
  step template, and one French anchor). Fixed in the course.
- **Three prose fixes** (Labs 1.2, 1.3, 1.5), English and French, in training PR
  [#352](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/352).
- **No product defect** found in sfdx-hardis 8.21.0 or the extension on Level 1.
- **Level 2: 9 of 9, Level 3: 11 of 11**, walked by two more agents on the same fork with no
  reset; their sections are at the end. Level 3 fixed two course defects (L3-F1, L3-F2) on the same
  training PR, and found no product defect.
- **The teardown of `helios-dev` failed** on metadata that is not the course's (L1-E1), a project
  deployed into that scratch org on 2026-10-16 by something outside the course. One foreign flow
  version was deleted to let the teardown pass. Runbook trap added.

## Versions under test

| Thing              | Version                                                                                                                                                                              |
|--------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| sfdx-hardis        | 8.21.0, linked (`sf plugins link`) to `C:\git\sfdx-hardis` on `e2e/night-run-2026-10-31` (`main` `da92636cb` plus `.claude` changes only)                                            |
| vscode-sfdx-hardis | `main` at `5ed4c6d4`, `yarn compile` done; the lab driver was not run (memory)                                                                                                       |
| Course             | `main` at `bd2fb19`; fixes on `fix/e2e-2026-10-31` (`66e26948`)                                                                                                                      |
| CI image           | `ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:latest`, released image, no override. MegaLinter 10.1.0                                                                                   |
| Published site     | `main` at `bd2fb19`, the same text as the course clone. Pass A read the lab text with that equivalence, and fetched the published Lab 1.1 page to check how the indented tips render |

## Environment

| Item          | State                                                                                                                                                                                                                                 |
|---------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Fork          | `nvuillam/sfdx-hardis-training`, **reset, not recreated** (`reset-fork.sh` closed #64 of the 2026-10-16 walk). First Pull Request of this walk: #85                                                                                   |
| Orgs          | `helios-prod` (Dev Hub, DailyScratchOrgs 6/6, API 14977/15000 at the start), `helios-preprod`, `helios-dev` torn down; `helios-integration` and `helios-uat` had expired and were recreated by `init` (2 of the 6 daily scratch orgs) |
| Learner clone | `C:/git/training-run`, cloned by `reset-fork.sh` at `bd2fb19`                                                                                                                                                                         |
| Browser       | the e2e Chrome profile (`%LOCALAPPDATA%\sfdx-hardis-e2e-chrome`) started by this run on port 9222 (PID 23444), **not signed in to GitHub**, Salesforce through frontdoor URLs only; stopped at the end                                |

Teardown, with what it cost:

- `helios-dev` failed the first time: *This custom object is used by another feature ... Flow
  Version 301h1000003tZOy* (`Meter_Reading_After_Save`). See L1-E1. Second run exit 0.
- `helios-prod`: its destructive deploy sat **Pending** at Salesforce for more than 25 minutes with
  no start date, then passed, exit 0. `helios-preprod` exit 0.
- `init` was started while the `helios-prod` teardown waited in Salesforce's queue: Level 1 only
  reads the Dev Hub state there, and both finished green.

Memory was the constraint all along: 2.4 to 3.6 GB free. The lab driver (fidelity 1) needs more
than 3 GB beside the user's VS Code, so every VS Code step ran at fidelity 2.

## Lab by lab

Fidelity: **1** lab driver, **2** headless panel (`panel.mjs`, `panel-node.mjs`), **3** direct
`sf` / `git` / `gh`, **browser** the real Salesforce page over CDP.

| Lab | Fidelity                                                                                                           | A  | B                         | C                                                    | Findings            |
|-----|--------------------------------------------------------------------------------------------------------------------|----|---------------------------|------------------------------------------------------|---------------------|
| 1.1 | read only                                                                                                          | ok | not covered               | ok (8)                                               | L1-O1               |
| 1.2 | 2 (`init`, 20 min); steps 1 to 4 done before the run; step 7 not drivable; step 8 read at 3 from `config/branches` | ok | ok                        | 9, one stale (L1-S1)                                 | L1-P1, L1-O2, L1-O3 |
| 1.3 | 2 (`work:new`, the lab driver's rules)                                                                             | ok | ok                        | ok (6)                                               | L1-P2, L1-S3        |
| 1.4 | browser (field wizard, both grants, three records); step 1 by frontdoor URL                                        | ok | ok                        | ok (4)                                               | L1-O4               |
| 1.5 | 3 (Recent Changes as `SourceMember`, retrieve, staging, commit), 2 (Save / Publish)                                | ok | ok                        | 10, three with stale rows (L1-S4), one count (L1-S2) | L1-P3               |
| 1.6 | 3 (`gh pr create`, Files as `git:artifacts:download`, squash merge with `prflow.sh`)                               | ok | ok, comment word for word | ok (11)                                              | **L1-F1**, L1-O5    |
| 1.7 | 2 (`work:new`, Save / Publish), browser (field, grant, list view), 3 (retrieve, commit, Pull Request, merge)       | ok | ok                        | ok (1)                                               |                     |

Every "ok" in column B ended with the lab's own check passing, run from `$RUN`; at the end
`check --level 1 --lab all` printed 6 of 6.

What the walk showed:

- **Lab 1.2**: the eight steps printed as the lab shows them, except the lines a rerun gives
  (`helios-prod is already a Dev Hub`, `helios-dev already exists, until 2026-11-11`). The push of
  step 7 started a Process Deployment run on `integration`. Branch files:
  `integration` merges into `[uat]`, `uat` into `[]`.
- **Lab 1.3**: four questions as the lab says, branch `features/US-014-panels-required`, default org
  `helios-dev`.
- **Lab 1.4**: the FLS screen arrived with 19 of 23 profiles ticked, two header clicks cleared them;
  `Installation Layout` ticked by default. `INST-00001` adds up to 39 (23 + 16), as the picture
  says; the three values were 39, 64, 49. `FieldPermissions`: crew Read, managers Read + Edit.
- **Lab 1.5**: the four components on top of Recent Changes, 128 rows in all; the retrieve wrote
  exactly four files, no source conflict; report **Git Delta package.xml (4)**; `manifest/package.xml`
  gained one line (14 CustomField, 36 members); one tool commit, `chore(sfdx-hardis): update package
  content`.
- **Lab 1.6** (#85): *Ready to merge into `integration`*, *7 components would change (1 created, 6
  updated), 36 validated*, coverage 100%, one ticket with its title. Files: the six files of the
  picture, in a git-ignored folder. After the merge: *Full Quick Deploy: 7 components changed (1
  created, 6 updated)*, *Already run during the validation*, head branch deleted by GitHub, the
  field in `helios-integration` and not in `helios-uat`.
- **Lab 1.7** (#86): report of four, *7 components would change (2 created, 5 updated), 38
  validated*, deployed; in `helios-integration` Crew Notes Read + Edit on Helios Delivery Crew and
  the `Open_Installations` list view.

## Findings

F a defect a learner meets, P prose, S a picture, O an observation, E the environment or the
harness.

### Defects a learner meets

- **L1-F1 (Labs 1.6, 2.1, 2.2, 2.4, 2.5, French 3.1; fixed in training #352)**: MegaLinter's
  markdownlint reports 21 errors on every Pull Request of a fork, starting with the learner's first
  one. 20 are MD024: the step template (course #211) gives a step with several Do blocks several
  `#### Why` / `#### Pourquoi` headings, and `siblings_only` does not cover siblings. One is MD051:
  French Lab 3.1 links `#12-regarder-le-diagramme-a-nouveau`, the site folds the accent and
  markdownlint does not. Lab 1.6 prepares the learner only for the workflow auditor's ⚠️. Each later
  Why now has a title (`#### Why the card can lag`, rendered as a Why block like Lab 1.1's), and the
  French heading reads *Regarder le diagramme de nouveau*. `markdownlint-cli2` on `labs/en` and
  `labs/fr`: 21 issues before, 0 after.

### Prose, fixed in English and French (training #352)

- **L1-P1 (Lab 1.2 step 5)**: items 4 to 7 put the yes for `helios-prod` before the GitHub sign-in
  and the account question. `init` asks the GitHub part first (`confirmGhAccount`, then
  `Build your training environment from helios-prod?`), which the lab's own Why already said. Items
  reordered, references renumbered.
- **L1-P2 (Lab 1.3, Under the hood item 4)**: the user configuration file records the branch the
  story targets (`localStorageBranchTargets`), not the org; the org is item 5 (`.sf` config).
- **L1-P3 (Lab 1.5 step 7)**: "Read the two lines about cleaning: references to deleted components,
  and the pixel positions inside Flows". Since 8.10.0 (`30ea62c67`, #2107) the flowPositions rule is
  scoped to the Flows of the delta and, on a story with none, logs a `uxLog("log")` line the panel
  hides. The panel shows four `action` rows instead: destructive changes, local fields,
  ProductRequest, minimizeProfiles (`src/commands/hardis/project/clean/references.ts`, lines 307,
  315, 319). Read from the source and the command output at fidelity 2, not from the webview.

### Pictures, open

- **L1-S1** (still open from 2026-10-12): `training-menu-authorization.png` shows extension v8.6.1
  and 5 cards; the Level 1 menu has 7 (Trigger my workflows and Update my course are missing).
- **L1-S2** (still open): `package-xml--custom-field.png` reads 13 CustomField members and 35 in
  total; the walk read 14 and 36. The text quotes no number.
- **L1-S3**: `work-new-org-type.png` and `work-new-org.png` show *Checking out latest version of
  branch integration from `https://github.com/hardisgroupcom/...`*; a learner after `init` reads
  their fork's URL.
- **L1-S4**: `work-save-package-xml.png`, `work-save-package-xml--cleaning.png` and
  `work-save-completed.png` show the two cleaning rows of L1-P3 (destructive changes and
  flowPositions); 8.21.0 shows four others. They are mocks from the Helios fixtures, so the mock
  has to change before a retake fixes them. The text now says the picture shows two.
- Every VS Code picture shows the side bar of extension v8.13.0 and sfdx-hardis 8.17.0, and several
  show a learner state the lab has not reached yet (`welcome--first-open` with the Training menus
  in Lab 1.1, `org-select-alias` on branch `features/US-024-...`). Not wrong for the step, but a
  retake after 8.21.0 was not done (below).

### Observations, not fixed

- **L1-O1**: the old L1-O1 is closed: pill 3 of `setup.png` now boxes the Git card the text names.
- **L1-O2**: `init` still prints "will work in English from now on" before its confirmation,
  also when the user already does.
- **L1-O3**: `helios-dev` expires on 2026-11-11, `helios-integration` and `helios-uat` on 2026-11-30.
- **L1-O4**: `work:new` opens the scratch org in the default browser of the workstation, also
  headless: two tabs opened outside the e2e Chrome during this walk.
- **L1-O5**: the zizmor ⚠️ is the tokenless warning as expected; Socket Security adds two checks on
  this fork a learner does not have.

### Environment and harness

- **L1-E1**: `helios-dev` held a foreign project (`Meter__c`, `Meter_Reading__c`, an Apex service,
  a `meterReadingHistory` LWC, a *Helios Energy* app and the flow `Meter_Reading_After_Save`, all
  deployed on 2026-10-16 22:45 UTC, after that day's walk, by something outside the course).
  `MetadataComponentDependency` listed that flow as a dependency of `Installation__c` although its
  XML never names Installation, and the teardown's destructive deploy rolled back whole: every field
  of the last walk stayed, and Lab 1.4 could not have created its field. Its definition was saved
  (`meter-reading-after-save-flow-backup.json` in the session scratchpad), the flow deactivated and
  that one version deleted; the teardown then passed. The rest of the Meter metadata is still in
  `helios-dev`: 43 of the 128 Recent Changes rows of Lab 1.5 are Meter rows, and a record opened by
  URL lands in the *Helios Energy* app. Runbook trap added. Who deploys into the training scratch
  orgs should be found out.
- **L1-E2**: `review-lab.mjs` prints `MISMATCH` for seven Level 1 pictures whose pills are cited in
  the Why or You should now see block under them, which it does not read as part of the step since
  the step template. `check-pills.mjs` is right. Runbook note added in section 4.
- **L1-E3**: the `helios-prod` destructive deploy waited more than 25 minutes in Salesforce's queue
  with no start date. Nothing to fix; a teardown of `helios-prod` can take that long.

## Pull Requests

| Repository                             | Pull Request                                                                               | State                     |
|----------------------------------------|--------------------------------------------------------------------------------------------|---------------------------|
| `hardisgroupcom/sfdx-hardis-training`  | [#352](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/352) L1-F1, L1-P1 to P3 | open, not merged          |
| `nvuillam/sfdx-hardis-training` (fork) | #85 US-014, #86 US-016                                                                     | merged (squash), deployed |

No sfdx-hardis or extension Pull Request: no product defect found. The sfdx-hardis branch carries
the runbook changes and this report, uncommitted.

## What this run did not cover

- **Lab 1.1** was read and its pictures checked, not performed.
- **Lab 1.2 steps 1 to 4** were done before the run (org signed up, connected, clone, `gh`);
  **step 7** (the extension's GitHub sign-in) is an OAuth round trip nobody can drive; **step 8**
  was checked from the branch files `init` pushed, not in the DevOps Pipeline panel. The rerun of
  `init` that proves "running it twice is harmless" was not done.
- **The lab driver (fidelity 1) did not run**: free memory stayed under 3 GB. Labs 1.2, 1.3 and the
  Save / Publish of 1.5 and 1.7, which it covers, ran at fidelity 2. **No webview was clicked**:
  Orgs Manager, the Metadata Retriever, Source Control, the package viewer, the DevOps Pipeline,
  its cards, the Pull Request window and its tabs, the Files button. Their commands or queries ran
  instead.
- **GitHub at fidelity 3**: no browser was signed in to GitHub. The Pull Request creation page (its
  prefilled title *Features/us 014 panels required*, the base repository warning, the template),
  the Checks tab, the merge box and its method menu were not seen; `gh pr create` and `prflow.sh`
  stood in for them, and the comments were read through the API.
- **The badge claim of Lab 1.7** was not made: it opens a public issue on the shared repository and
  writes a badge record there.
- **The picture retake** after the release of 8.21.0 (`shots.mjs --all --kind vscode`) was not
  done: about 1 GB for twenty minutes, with 2.4 GB free. The pictures were read one by one instead.
- **French**: not walked. The French side of every fix was edited and restamped; the structure and
  translation checks pass.
- **An agent is not a beginner**: prose clarity was not really tested. Two sentences needed a
  second read: Lab 1.2 item 4 (the order, L1-P1) and Lab 1.5 step 7 (L1-P3), both fixed.

## State left for Level 2

- Fork: `integration` at `a0ee59c` (US-014 #85, US-016 #86), no open Pull Request, secrets
  `SFDX_AUTH_URL_INTEGRATION` and `SFDX_AUTH_URL_UAT` set, `integration` and `uat` protected,
  `delete_branch_on_merge` on.
- Clone `C:/git/training-run` on `features/US-016-crew-notes` (merged and deleted on the fork),
  clean. Level 2 follows with no **Reset this level**, as the runbook says.
- Orgs: `helios-dev` holds US-014 and US-016 (and the foreign Meter metadata, L1-E1),
  `helios-integration` has both deployed, `helios-uat` neither. `helios-prod` and `helios-preprod`
  torn down. Daily scratch orgs used: 2 of 6.
- Chrome on 9222 stopped; no process of the run left running.

## Level 2

Walked straight after Level 1 on the same fork and orgs, no **Reset this level**, sfdx-hardis
8.21.0 linked as for Level 1, released CI image, no override.

- **Level 2: 9 of 9** (`check --level 2 --lab all`). Pull Requests #87 to #99, every one merged and
  deployed to `helios-integration`.
- **No product defect** found in sfdx-hardis or the extension.
- **Two course fixes** (Labs 2.1 and 2.4, English and French) added to training PR
  [#352](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/352), whose description now has
  a Level 2 part.
- **Fidelity was low on purpose**: 1.8 to 2 GB free all along, so no Chrome and no lab driver.
  Every Salesforce Setup step was replaced by a deployment of the course's own Level 3 start state
  (runbook, Level 2 at fidelity 3), then retrieved from the org as the lab says.
- **The foreign metadata of `helios-dev`** (L1-E1) showed twice: in the whole Profile of Lab 2.6,
  whose first check went red, and in the Apex Tests card of Lab 2.5.

### Lab by lab

| Lab | Fidelity                                                                                                                                  | A  | B                                         | C                     | Findings     |
|-----|-------------------------------------------------------------------------------------------------------------------------------------------|----|-------------------------------------------|-----------------------|--------------|
| 2.1 | 2 (simulate), 3 (`backpromote --plan`, plan from #87, `--auto`, Back as a checkout)                                                       | ok | ok                                        | 3 of 8 opened, ok     | L2-P1        |
| 2.2 | 2 (`work:new`, Save / Publish), 3 (field and flow as XML, admin read as `FieldPermissions`, record test by API, retrieve, `gh pr create`) | ok | ok                                        | 2 of 12 (web), ok     | L2-O1        |
| 2.3 | 2, 3 (Required as XML, refused save by API, retrieve, `action:create --agent`)                                                            | ok | ok                                        | 1 of 5, ok            | L2-S1        |
| 2.4 | 2 (`work:new`, Create my lab records, Data Workbench export), 3 (object, fields, tab, grants as XML, `action:create`, tick by API)        | ok | ok                                        | 1 of 9, ok            | L2-O2, L2-O3 |
| 2.5 | 2 (`work:new`, Save / Publish), 3 (pastes, deploy, `hardis:org:test:apex --agent` for the card)                                           | ok | ok                                        | 0 of 2                | L2-E1        |
| 2.6 | 2, 3 (grant as `FieldPermissions`, Auto retrieve as `mdapi:read --active-only`, blocks removed by script)                                 | ok | ok after the lab's own "If it goes wrong" | 1 of 3, ok            | L2-E2        |
| 2.7 | 2 (simulate, Save / Publish), 3 (flow as XML, merge by git, Accept Incoming as `merge-file --theirs`, "Accept both" written by hand)      | ok | ok                                        | 1 of 11, ok           |              |
| 2.8 | 2 (`resetselection`, Save / Publish), 3 (layout as XML, twenty rows from `SourceMember`, Profiles whole)                                  | ok | ok                                        | 1 of 4                | L2-S2        |
| 2.9 | 2 (simulate, export, Save / Publish), 3 (object, tab, flow, grants as XML, ten records by bulk upsert, `action:create`)                   | ok | ok after an approval                      | none (no lab picture) | **L2-F1**    |

What the walk showed, against the lab text:

- **2.1**: the plan picked nothing the first time, then one Pull Request in the window and three
  items (field, layout, permission set); *3 deployed, 0 deleted*, the Backpromotes comment on #87.
  Back left `features/US-016-crew-notes`, gone on the fork, so no merge offer.
- **2.2**: #88 red on `Installation_Crew_Warning field integrity exception: unknown (The field
  "Crew_Warning_Sent__c" ...)`, word for word; the flow diff comment with **Mark Warning Sent**
  green. One task after two saves in `helios-dev`. Green once the field was retrieved.
- **2.3**: the two permission sets refused on `You cannot deploy to a required field`, each losing
  five lines and nothing else; `Required fields are missing: [Crew_Size__c]` on an API save;
  **🕒 1 after the merge** and *skipped: Runs after the merge only*; the deployment log printed
  `Crew size backfill started, batch job 707...`; 30 of 30 installations with a crew size.
- **2.4**: #90 green and inert (0 records, no job); the export asked its two questions; the
  MegaLinter robot commit arrived as the lab says and was pulled; #91 stopped on
  **⚠️ ... Manual actions to perform before the merge**, green after the tick and a rerun
  (*Already done in integration on Oct 31*); 12 records and `Helios crew capacity nightly` in
  `helios-integration`.
- **2.5**: Mega-Linter red on `pmd:OperationWithLimitsInLoop` with the check green at 80.64%; then
  76.92% word for word; then 95.38%.
- **2.6**: the whole Profile 1829 lines (62 layouts, 142 tabs), 764 after the cleaning commit; #93
  red on a foreign tab (L2-E2), green once six blocks were removed on the branch; Helios Crew not
  granted in `helios-integration` after the merge; #94 granted Cost through the permission set.
- **2.7**: the permission set conflict is the lab's snippet character for character; Accept
  Incoming gave Mariia's whole flow; the merge message is the lab's; in `helios-integration` the
  active flow holds the four elements and the permission set both grants.
- **2.8**: delta of 4 with `Admin` 1706 lines longer and six classes changed by their last line
  break; `resetselection` asked one question, set `canForcePush`; the second publish pushed over
  the branch without asking, delta of 1, one file.
- **2.9**: delta of 10, the count of what was made; US-019 merged clean with both grants; 10
  templates and the refused close (*Complete the handover checklist before closing this
  installation.*) in `helios-integration`.

### Findings of Level 2

- **L2-F1 (Labs 2.9 and 2.4, fixed in training #352)**: in the capstone the action file was
  published before MegaLinter finished on the first push, so its `chore(megalinter): apply linters
  fixes` commit landed last. Both checks of that commit were `action_required`, the merge was
  blocked, and Lab 2.4's way out (Pull, then Save / Publish: "your push is what starts the checks
  again") had nothing to push. Approving the two runs (API, the Pull Request's **Approve and run**
  for a learner) started them and #99 went green. Lab 2.4's entry now covers that case. The button
  label is GitHub's documented one; it was not seen (no browser signed in to GitHub).
- **L2-P1 (Lab 2.1, fixed in training #352)**: the backpromote branch was given as
  `backpromote/integration/<your org>`; the command uses the org id in lower case, as the picture
  of step 5 shows.
- **L2-S1 (Lab 2.3, open)**: behind the Edit Deployment Action dialog, the mock Pull Request lists
  nine actions; a learner's has none at that step. Not wrong for the step.
- **L2-S2 (Lab 2.8, open)**: `metadata-retriever-recent-changes--pick-rows.png` shows 11 results,
  not sorted newest first, none ticked, while the step sorts and ticks twenty (this walk listed
  more than 100 rows).
- **L2-O1**: the flow diff comment of #88 read 6 properties, the picture 5: the extra one is the
  decision description of the course's start-state flow this walk deployed, not the lab.
- **L2-O2**: **Create my lab records** prints *Left in the temp folder, still in use: ... (EPERM)*
  on Windows, a dim line by design (`removeTempDir`).
- **L2-O3**: the action dialog defaults **Run Only Once By Org** on (`runOnlyOnceByOrg ?? true`),
  which is why the lab's YAML shows it on the data action while its table does not list it.
- **L2-E1**: the Apex Tests card read *Failed* on `helios-dev` because of the foreign
  `MeterReadingAfterSaveFlow_Test` (L1-E1 deleted its flow version); every course test passed and
  `InstallationScheduler` read 100%.
- **L2-E2**: the whole `Helios Crew` from `helios-dev` named the layouts and tabs of three foreign
  objects (`Energy_Contract__c`, `Meter__c`, `Meter_Reading__c`). The two "new org" layouts of
  2026-10-16 (L2-F2 then) exist in both orgs today and did not show. Runbook trap added.

### What Level 2 did not cover

- **No VS Code panel was driven** (fidelity 1 and the webview): DevOps Pipeline cards, the
  Backpromote panel, Metadata Retriever, package viewer, Pull Request window and its Deployment
  Actions tab, the action editor dialog, Data Workbench, Org Monitoring Workbench, Pipeline
  Settings, the merge editor. Their commands ran instead, through `panel.mjs` where they prompt.
- **No Salesforce Setup screen was used**: field wizards, Flow Builder (Labs 2.2, 2.7, 2.9),
  Object Manager, permission set pages, the tab wizard, list views, record pages. All were
  replaced by metadata deployments and API calls. Flow Builder's behaviour on the hidden checkbox
  of Lab 2.2 was not tested. Email Deliverability of `helios-integration` was not read.
- **GitHub at fidelity 3**: Pull Request pages, Files changed, merge boxes, the conflict banner of
  Lab 2.7 (read as `mergeStateStatus: DIRTY`), the tick of Lab 2.4 (a comment edit) and the
  approval of L2-F1 (API).
- **About 50 of the 60 Level 2 pictures were not opened**: those of Flow Builder and Setup could
  not be compared with anything this walk did.
- **The badge claim of Level 2** was not made (public issue on the shared repository).
- **French**: not walked; the two fixes have their French side, restamped.
- **An agent is not a beginner**: prose clarity was not tested.

### State left for Level 3

- Fork: `integration` at `6bdf9fd` (US-041 #99 on top of #87 to #98), `uat` and `main` at
  `bd2fb19`; branches `integration`, `uat`, `main`, `training/start-level-1..3`; **no open Pull
  Request**. Level 2 action files carry the fork's numbers (`.sfdx-hardis.89.yml`, `.91.yml`,
  `.99.yml`), so Level 3 promotions collect them.
- Clone `C:/git/training-run` on `features/US-041-handover-checklist` (merged, gone on the fork),
  clean. A private ref `refs/e2e/l3start` (`5c52710`, the Level 3 start state) is left in it,
  harmless; delete it with `git update-ref -d refs/e2e/l3start` if wanted.
- Orgs: `helios-dev` (until 2026-11-11) and `helios-integration` hold Level 2; `helios-uat`
  (until 2026-11-30) holds neither Level 1 nor Level 2; `helios-integration` until 2026-11-30;
  `helios-prod` and `helios-preprod` torn down. No scratch org created by Level 2 (`helios-prod`
  reads DailyScratchOrgs 0 of 6 used, DailyApiRequests 19 of 15000).
- No process of the run left running; no Chrome started. Free memory 1.96 GB at the end.
- Level 3 can start straight after, with no **Reset this level**, as the runbook describes.

## Level 3

Walked straight after Level 2 on the same fork and orgs, no **Reset this level**, sfdx-hardis
8.21.0 linked as for Levels 1 and 2, released CI image, no override.

- **Level 3: 11 of 11** (`check --level 3 --lab all`), and `status` reads 6/6, 9/9, 11/11. Pull
  Requests #100 to #126 of the fork, every one merged except US-020 (#106), sent back as the lab
  says.
- **No product defect** found in sfdx-hardis 8.21.0 or the extension.
- **Two course defects fixed** (L3-F1, L3-F2) on training PR
  [#352](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/352), whose description now has
  a Level 3 part.
- **The whole Profile of Lab 2.6 reached production**, once a Fix story removed two layouts that
  Developer Edition orgs do not have (L3-E1). Lab 2.6's own troubleshooting covers it.
- **Fidelity 2 and 3 only**: 0.9 to 2.8 GB free, so no lab driver and no Chrome. No Setup page, no
  GitHub page, no webview was seen.
- **Lab 3.8's first monitoring run never started**: GitHub refused the job of the private monitoring
  repository for an account billing reason (L3-E2). Its checks ran locally instead.

### Lab by lab

| Lab  | Fidelity                                                                                                                                                                | A  | B                                                      | C                  | Findings            |
|------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----|--------------------------------------------------------|--------------------|---------------------|
| 3.1  | 2 (seed x3, `work:new` x2, `auth.mjs` x2, Save / Publish x2), 3 (branch and rules by `gh api`, secrets, Pipeline Settings as file edits, app policies read as metadata) | ok | ok after Lab 2.6's "If it goes wrong" (Fix story #100) | 2 of 22 opened, ok | L3-E1, L3-O1, L3-O2 |
| 3.2  | 2 (simulate x2), 3 (review comment by API, Files as `git:artifacts:download`, merge, layout read by tooling query)                                                      | ok | ok                                                     | 0 of 4             |                     |
| 3.3  | 2 (simulate x4, Retry as `action:run`), 3 (log read, review, group by API, Mark as done as `action:set-status`, merges)                                                 | ok | ok                                                     | 0 of 9             |                     |
| 3.4  | 2 (simulate), 3 (review, diffs)                                                                                                                                         | ok | ok                                                     | 0 of 2             |                     |
| 3.5  | 3 (remote site by metadata deploy, no-overwrite entry as a file edit, `gh pr create`, tick by `tick.mjs`, tester check by API, description), 2 (publish, release notes) | ok | ok                                                     | 0 of 7             | **L3-F1**, L3-O3    |
| 3.6  | 3 (`gh pr create`, ticks, merges, tester checks by API, DORA as `dora-report --data-only`), 2 (none), export as `dora-report --agent`                                   | ok | ok                                                     | 1 of 5, ok         | L3-O4               |
| 3.7  | 3 (refused save and fixed save by API, merges, `git merge`), 2 (simulate, `work:new`, Save / Publish)                                                                   | ok | ok after a fix of the org question                     | 1 of 12, ok        | **L3-F2**, L3-O5    |
| 3.8  | 2 (`mon.mjs`, publish), 3 (repository, secret, routing as file edits, Run workflow by `gh`, checks run locally)                                                         | ok | partly: the CI run never started                       | 0 of 4             | L3-E2, L3-O6        |
| 3.9  | 3 (`project2markdown --with-history --agent`, paragraphs by script)                                                                                                     | ok | ok                                                     | 0 of 1             |                     |
| 3.10 | 2 (simulate x5, `promotion:create` with the button's flags, `work:new`, Save / Publish), 3 (resolutions by file edit, description, merges)                              | ok | ok, except the red marker check (not observed)         | 0 of 10            | L3-E3               |
| 3.11 | 2 (simulate, release notes), 3 (merges, descriptions, DORA)                                                                                                             | ok | ok                                                     | 0 of 1             | L3-O4               |

Fork Pull Requests, by lab:

| Lab  | Pull Requests of the fork                                                                                                      |
|------|--------------------------------------------------------------------------------------------------------------------------------|
| 3.1  | #100 US-033 Fix (Profile layouts), #101 US-050 configuration                                                                   |
| 3.2  | #102 US-052                                                                                                                    |
| 3.3  | #103 US-056, #104 US-062, #105 US-062 fix                                                                                      |
| 3.4  | #106 US-020, left open on purpose                                                                                              |
| 3.5  | #107 no-overwrite configuration, #108 integration to uat                                                                       |
| 3.6  | #109 uat to preprod, #110 release                                                                                              |
| 3.7  | #111 US-045 hotfix, #112 hotfix to production, #113 retrofit US-045                                                            |
| 3.8  | #114 `monitoringRepository` configuration                                                                                      |
| 3.10 | #115 US-058, #116 US-057, #117 US-059, #118 US-060, #119 US-061, #120 integration to uat, #121 promotion branch, #122 retrofit |
| 3.11 | #123 US-055, #124 integration to uat, #125 uat to preprod, #126 release                                                        |

What the walk showed, against the lab text:

- **3.1**: the seed of `helios-preprod` stopped on `Profile Helios Crew`, *no Layout named
  ContactPointOttSvc-Contact Point OTT Service Layout* (L3-E1); after Fix story #100 both seeds went
  green (30 installations, 80 panel batches, 53 accounts). Add or Reconnect a Major Org asked its
  twelve questions in the lab's order, word for word, for `preprod` and for `main`; `main` offered
  `integration`, `preprod` and `uat` and took the empty answer. Both apps read
  `AdminApprovedPreAuthorized` with **System Administrator**, read from the org metadata, not the
  Setup page. #101 green, squash.
- **3.2**: #102 *4 components would change (4 updated), 61 validated*, nothing deleted;
  `deployment-components.csv` named the layout, `installationTimeline`, `Admin` and `Helios Crew`.
  The diff removed `Total_Capacity_kW__c` with nothing adding it back; Mariia's commit put it back
  read only under the cap, and `helios-integration` shows both fields in column 2.
- **3.3**: the log of #102 in its five parts, `Successfully logged using sfdxAuthUrl`,
  `Deployment mode: FULL + Quick Deploy`, `Components: 61 deployed`. #103 red on exactly
  `Installation__c-Installation Layout ... no CustomField named Installation__c.Crew_Workload__c`
  (the permission set second, as step 7's Why says), green after Romain's exact path. #104 deployed
  then red on `System.QueryException: List has no rows for assignment to SObject`; both comments word
  for word (*In integration: ❌ 1 failed · ⏸️ 2 waiting*). Retry asked *2 action(s) were stopped by
  this failure. What do you want to do?*; **Run the next action only** gave the first action green and
  *Apex class 'CrewCapacityBach' not found in the org*. #105 moved it with `movedFrom: 104`, added
  the group and its `package.xml` block; US-062's comment read ↪️ *moved to #105*. Mark as done wrote
  *Not run in CI, then closed by hand by ...*.
- **3.4**: #106 red on `InstallationSchedulerTest` *Illegal assignment from Datetime to Date*,
  twice. US-019 (#98) added one `fieldPermissions` block; the two grants sit 75 lines apart.
- **3.5**: #108 stopped on **⚠️ Cannot merge into `uat`: Manual actions to perform before the
  merge**, green after the tick. The deployment skipped the deliverability step (*already run in
  uat*), kept `Helios_Warehouse` (`Type RemoteSiteSetting: 1 item(s) skipped ...`, word for word,
  **1** in the protected table) and ran the seven post-deployment actions in lab order. The test
  installation came back at crew size 3 and `Scheduled`, the quote PDF grant was there, the remote
  site still read the test URL. Release notes: 23 Pull Requests, 17 tickets, 39 components (the
  lab: 22, 17, 38; the extra one is #100).
- **3.6**: `sf org login jwt ... Successfully logged to https://login.salesforce.com` on the first
  check into `preprod`; #109 and #110 each red once on the deliverability step, green after the
  tick. The release read *7 components would change (2 created, 5 updated), 62 validated*, no
  deleted. DORA: every box *Nothing waiting*; `integration` 88 deployments, `main` 9 on this reused
  fork.
- **3.7**: production refused the back-dated cancel with *The install date cannot be moved into the
  past. Pick today or a later day.*; #111 (+2 -1, the diff of the picture) to `preprod`, #112 to
  `main`, *✅ Deployed to `main`*, then the same save went through. The retrofit merge of
  `origin/main` was a fast-forward (L3-O5); #113 merged with a merge commit, as its **How to merge**
  line says.
- **3.8**: Install Org Monitoring asked its questions in the lab's order, in one pass, and ended on
  *The monitoring workflow on main now runs monitoring_...*. The first run never started (L3-E2).
  Run locally: `ActiveScratchOrgs` 3 of 3, **Salesforce CLI** *Unsecured*, as step 5 says.
- **3.9**: `project2markdown --with-history` in 11 s; `Installation__c.md`,
  `Installation_Assign_Crew.md` and its `-history.md`; two pages protected; nothing to commit.
- **3.10**: the five stories merged in the lab's order. `promotion:create` offered the five
  stories, then the retrofit and the configuration under them, as step 4 says; US-057 clean, US-059
  conflicting on exactly the layout and `Helios_Delivery_Manager`, US-061 clean; the markers exactly
  as the runbook describes. After the by-hand resolution, both files read as the lab prints them;
  the check went green naming #116, #117 and #119 and the promotion branch line. In
  `helios-preprod`: Awaiting Parts, Gate Code, Supplier; no Warranty Years, no Scaffolding Required.
  The retrofit #122 had 0 changed files, and `git merge-tree integration preprod` was clean.
- **3.11**: #123 *4 components would change (4 updated)*; `uat` into `preprod` without a conflict,
  after which `helios-preprod` had Warranty Years and Scaffolding Required; the release #126 read
  *13 components would change (4 created, 9 updated)*, nothing deleted (13 as on 2026-10-16). Release
  notes: 10 Pull Requests, 7 tickets. DORA: zero waiting in every org.

### Findings of Level 3

- **L3-F1 (Labs 3.5 and 3.8, fixed in training #352)**: **Publish my pipeline configuration** wrote
  *Merge it with **Merge pull request**, not with a squash* into the Pull Request body and its last
  lines, while the check comment of that Pull Request says **Squash and merge**, as do Lab 3.8 step
  8, Lab 3.5 ("as in Lab 3.1") and the runbook. A learner gets two opposite instructions on the same
  Pull Request. `scripts/training/publish.mjs` now asks for **Squash and merge**. The fork's copy of
  the script still has the old text until the learner runs **Update my course**.
- **L3-F2 (Labs 3.7 step 7 and 3.10 step 9, fixed in training #352)**: the retrofit story is to be
  started in `helios-dev`, but **Which Salesforce org do you want to work in?** offers Sandbox,
  Scratch org, **Current org** and no org, and **Current org** is `helios-prod`, production: Add or
  Reconnect a Major Org made it the default in Lab 3.1. A learner who takes the visible answer works
  in production. The table now says **Scratch org** then **Reuse scratch org helios-dev**, as Lab 1.3
  taught, and not **Current org**. English and French, restamped.
- **L3-O1 (Lab 3.1)**: **Where am I?** gives Lab 3.1 *~50 min* (the estimate of
  `training-universe.json`), the lab page *~2 h 05* (observed); the level reads *about 6 h 55*
  against *about 8 h 30*. Not changed.
- **L3-O2 (Lab 3.1)**: the seed runs on the branch the clone is on. Seeding is listed before step 4
  in the lab, so from `integration`; nothing says so.
- **L3-O3 (Lab 3.5)**: the uat release notes list *Recalculate the crew capacity once* twice, ✅
  from #105 and ↪️ *moved* from #104. Right, and a little noisy.
- **L3-O4 (Labs 3.6, 3.11)**: the second DORA export of the day overwrote the baseline of Lab 3.6
  (`docs/dora/dora-report-2026-10-31.md`), so the capstone's comparison needs a copy taken by hand.
  Still open from 2026-10-16 (L3-O12 then).
- **L3-O5 (Lab 3.7)**: the merge of `origin/main` into the retrofit branch was a fast-forward, since
  everything in `integration` had been released; the lab's "merged, with no conflict tonight" holds.
- **L3-O6 (Lab 3.8)**: `Check my work` for Lab 3.8 reads `monitoringRepository` only, so it passed
  with no monitoring run at all. It cannot see a private repository, so it is the best it can do.
- **Pictures**: the four opened (`configure-auth-variables--secrets`, `devops-pipeline-level3--four-stages`,
  `dora-metrics`, `github-pr-files-hotfix`) match their steps; the four-stage diagram shows feature
  branches and open Pull Requests a learner does not have at that step (mock state, as noted before).

### Environment and harness of Level 3

- **L3-E1**: `helios-preprod` and `helios-prod` (Developer Edition) have the `ContactPointOttSvc` and
  `SecurityDefenseActionEventStore` objects with no layout; `helios-dev` and `helios-integration`
  (scratch orgs) have both layouts, and the whole `Helios Crew` of Lab 2.6 names them. It is row 3 of
  Lab 2.6's table; the lab's way out worked as written (Fix story #100, seeds green, every promotion
  to production green with the whole Profile). It answers the runbook's open question: a Developer
  Edition org does not get those two layouts. Runbook updated.
- **L3-E2**: GitHub refused to start the job of the private monitoring repository
  `nvuillam/sfdx-hardis-training-monitoring-run8`: *recent account payments have failed or your
  spending limit needs to be increased*. The public fork ran all day. The backup, the monitoring job,
  MegaLinter there and the email were not covered; limits and unsecured apps ran locally. The
  workflow is disabled.
- **L3-E3**: the resolution of Lab 3.10 was pushed before the first check of #121 finished, and the
  workflow's concurrency cancelled it: the red check naming the two files (step 5) was not observed
  this time. Proven on earlier walks.
- **L3-E4**: `helios-preprod` is still the `DevHub` alias on this workstation, so `auth.mjs` took
  `DevHub` (L3-E1 of 2026-10-16).
- **L3-E5**: the first merge of #112, #120, #124 and #125 was refused while Mega-Linter of the head
  still ran; `promo.sh` retried and merged.
- Seven monitoring repositories of earlier walks still have an active nightly workflow (`-run5`,
  `-run4`, `-run3`, the unsuffixed one, `-0926`, `-0925`, `-run2`); `helios-prod` read
  DailyApiRequests 8455 of 15000 mid-afternoon. Left for the maintainer.

### What Level 3 did not cover

- **No VS Code panel was driven** (fidelity 1 and the webview): DevOps Pipeline and its gear menu,
  `+ PR` chips, branch windows, the promotion checkboxes and button, Pipeline Settings (Labs 3.1,
  3.8, 3.10), the package viewer's No Overwrite list, the Pull Request window and its Files button,
  the Deployment Actions tab (Retry, Mark as done, Move to my Pull Request), the Orgs Manager, the
  DORA panel, the Documentation, Monitoring and Monitoring Config Workbenches, the merge editor.
  Their commands ran instead, through `panel.mjs` where they prompt.
- **No Salesforce Setup page**: External Client App Manager (read as metadata), Remote Site
  Settings (metadata deploy), Public Groups (API), the validation rule page, record saves (API),
  **Email Deliverability**: the click was never made, the three boxes were ticked by `tick.mjs`.
- **No GitHub page**: branch creation, the branch rules form and Confirm access, secrets, every Pull
  Request, review, merge box and Checks tab, Run workflow (`gh` and the API instead).
- **Lab 3.8's CI run** (L3-E2): the backup, the monitoring job, its report and the email.
- **Lab 3.10 step 5's red marker check** (L3-E3), and the coding agent route of step 6.
- **Pictures**: 4 of the 77 Level 3 pictures were opened.
- **The badge claim of Level 3** was not made (public issue on the shared repository).
- **French**: not walked; the two fixes have their French side, restamped.
- **An agent is not a beginner**: prose clarity was not really tested.

### State left at the end of Level 3

- Fork `nvuillam/sfdx-hardis-training`: `integration` at `d74faa0`, `uat` at `d64fedf`,
  `preprod` at `e7be47b`, `main` at `01afb82`; four protected branches; secrets
  `SFDX_AUTH_URL_INTEGRATION`, `SFDX_AUTH_URL_UAT`, `SFDX_CLIENT_ID/KEY_PREPROD`,
  `SFDX_CLIENT_ID/KEY_MAIN`. Open Pull Request: #106 US-020, on purpose.
- Monitoring repository `nvuillam/sfdx-hardis-training-monitoring-run8` (private), its workflow
  disabled; clone `C:/git/training-monitoring-run8`.
- Clone `C:/git/training-run` on `integration`, clean, with untracked `hardis-report/` and `docs/`
  (git-ignored). Logs in `C:/git/training-e2e/run-1031-l3`.
- Orgs: all five torn down with **Clean up a training org** at the end (`helios-integration`, `helios-uat`, `helios-preprod`, `helios-dev`, `helios-prod`, each exit 0, about 2 to 3 minutes each, `helios-prod` included); no `Installation__c` left in any of them, and the two External Client Apps of Labs 3.1 and 3.8 are gone, so the four JWT secrets of the fork now point at nothing (runbook trap: redo Add or Reconnect a Major Org after a teardown). `helios-dev` expires 2026-11-11, `helios-integration` and `helios-uat` 2026-11-30. No scratch org created by Level 3: `helios-prod` reads DailyScratchOrgs 0 of 6, ActiveScratchOrgs 3 of 3, DailyApiRequests 3300 of 15000 at the end. The foreign Meter metadata of `helios-dev` (L1-E1) did not block this teardown.
- Training PR [#352](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/352) open, checks
  green, not merged. No sfdx-hardis or extension Pull Request.
- No process of the run left running; no Chrome started. Free memory 3.43 GB at the end (0.87 to 2.97 GB during the walk).

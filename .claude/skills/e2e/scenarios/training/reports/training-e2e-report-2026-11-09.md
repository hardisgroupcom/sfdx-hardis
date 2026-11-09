# Training e2e report, 2026-11-09 (badges run)

Scope asked by the user: the `training badges` scenario, walked from Level 1, on the real published
site and a real VS Code (the lab driver), unattended. The user deleted the fork before the run, so
`init` created it the way a learner's does.

## Versions under test

| What                       | Value                                                                          |
|----------------------------|--------------------------------------------------------------------------------|
| sfdx-hardis                | `main` at v8.24.0 (`2f0aebffe`), linked in the extension host                  |
| vscode-sfdx-hardis         | `main` at v8.19.0 (`b4659ac8`), built `yarn compile && yarn dev`               |
| sfdx-hardis-training       | `main` at `b8e7ea81` (#367), the published site was on the same commit         |
| Fork                       | `nvuillam/sfdx-hardis-training`, created by `init` (new, Pull Requests from #1) |
| Orgs                       | `helios-prod` (Dev Hub), `helios-preprod`, scratch orgs `helios-dev`, `-integration`, `-uat` of an earlier walk, put back with the course teardown |
| Course images in CI        | released (`latest`), no override                                               |

## Cheap checks before the walk

`universe --check`, `lab-crossrefs --check`, `lab-command-links --check`, `check-pills`, `check-i18n`,
`check-links`: all green. `check-commands`: failed at first, see F2. `check-site`, `check-nav` and
`check-language-switch` were not run (they open a browser and the workstation was short of memory).

## Level 1

| Lab | Fidelity                                                                                              | A    | B  | C                          | Findings |
|-----|-------------------------------------------------------------------------------------------------------|------|----|----------------------------|----------|
| 1.1 | Not walked (installs tools already installed)                                                         | read | -  | -                          |          |
| 1.2 | 1, real VS Code: `init`, the Actions banner clicked over CDP                                          | read | ok | -                          | F1       |
| 1.3 | 1, real VS Code: `work:new`                                                                           | -    | ok | -                          |          |
| 1.4 | 3 for the Setup steps, in the real Salesforce Setup over CDP (field, grants, record page, 3 values)   | read | ok | record page opened         | F3       |
| 1.5 | 3 for steps 1 to 4 (retrieve, stage file by file, commit), 1 for Save / Publish                       | read | ok | -                          |          |
| 1.6 | 3 for the Pull Request (browser), the checks and the squash merge through `prflow.sh`                 | read | ok | -                          |          |
| 1.7 | Own driver specs for `work:new` and `work:save`, Setup over CDP for the field, grant and list view    | read | ok | list view picture opened   |          |

What was observed, in the lab's own terms: the FLS screen arrived with 19 of 23 profiles ticked and two
header clicks cleared them; `INST-00001` adds up to 39; `FieldPermissions`: crew Read, planners Read and
Edit; the retrieve wrote exactly four files, no source conflict; Pull Request #1 comment *Ready to merge*,
*7 components would change (1 created, 6 updated), 36 validated*, coverage 100%; merge job
*DEPLOY ... success*, head branch deleted by GitHub; capstone Pull Request #2 green and deployed, the
list view and `Crew_Notes__c` (crew Read and Edit) in `helios-integration`. Whole level:
`Check my work` 6 of 6.

### The Level 1 badge claim

`Claim my badge` run headless through the real command (`panel-node.mjs`, Trailblazer username
asked and answered, profile found), the form submitted in the e2e Chrome (signed in as the fork
owner): issue `hardisgroupcom/sfdx-hardis-training#380`. The audit answered *Level 1 verified, 6
checks passed*, awarded **sfdx-hardis Contributor Basics**, closed the issue. The record
`badges/nvuillamy.json` updated its Level 1 entry (`issuedOn` 2026-11-09, 6 of 6) and kept the two
others; `/badges/nvuillamy/` and `/fr/badges/nvuillamy/` answer 200 with the hexagon artwork, the
French page in French, `/badges/img/nvuillamy-level-1.svg` and `banner-level-1.svg` answer 200.
It was a re-claim over a badge awarded on 2026-09-24, which also proves a second claim replaces the
entry of its level and leaves the others alone.

## Findings

| Id | What                                                                                                                                                                                                                                      | Where fixed                                                                                                                       |
|----|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| F1 | The lab driver stopped at *Fork the course into the GitHub account nvuillam?*, which Lab 1.2 describes for a computer already signed in to GitHub. `lab-drivers.json` had no rule for it. The question is right and the lab covers it.     | `labs/_assets/lab-drivers.json` of the course, optional rule `^Yes, use`, branch `fix/lab-driver-fork-account-answer`, no PR yet  |
| F2 | `sf commands` failed with *VAR is not defined* and `check-commands.mjs` with it. Cause: the linked `sfdx-browserforce-plugin` (branch `feat/docs-site`) had `\${VAR}` in the description of `plugins validate`, which oclif evaluates. Also a stale git-ignored `oclif.manifest.json`. Not in Browserforce `main`, not in sfdx-hardis. | `../sfdx-browserforce-plugin`, commit `5171c0e` on `feat/docs-site`, not pushed (the manifest regenerated with `oclif manifest`)   |
| F3 | `helios-dev` holds metadata that is not the course's (the *Helios Energy* app: Meters, Meter Readings, Energy Contracts tabs). Same as the 2026-10-31 run. The course teardown does not remove it, so the Recent Changes list of Lab 1.5 is longer than the lab says. | Not fixed: environment, not course                                                                                                |

## Traps found (also for the runbook)

- `?lang=en` pins the language preference of that browser for a year: a `/fr/` page opened afterwards in
  the same browser lands on English. Check a French page with `curl`, which has no cookie.
- A hook of this workstation (`Skills-first enforcement`) refuses a raw `sf data query` or `sf project
  retrieve start` until the matching `salesforce-development` skill has been loaded.
- GitHub's new issue form: the Level dropdown is a React menu (a `button` reading *None*, then
  `menuitemradio`), the form holds a fourth checkbox, *Create more*, that must stay unticked, and the
  green button is the **last** `button` named *Create...* (the first is the header's *Create new* menu).
  `scripts/walk/claim-submit.mjs` of this run does it.
- `claim` opens the user's default browser with `cmd /c start`: a run on a machine in use sets
  `NO_OPEN=true` with a temporary one-line guard in `openUrl` of the clone (reverted after).

## What this run did not cover

- Lab 1.1 (read only), the French labs, `check-site` / `check-nav` / `check-language-switch`.
- No click of the webview DOM: the driver answers the question the panel received. Lab 1.5 steps 1 to 4
  (Metadata Retriever, Source Control panel) and Lab 1.6 step 1 (the *Create Pull Request* button of the
  panel) were done at fidelity 3 with the same commands and the browser.
- An agent is not a beginner: prose clarity was not tested.

## Level 2

Walked straight after Level 1 on the same fork and orgs, with no **Reset this level**. Pull Requests #3
to #15 of the fork, all merged and deployed to `helios-integration`. Every `work:new`, every
`Save / Publish`, `Simulate my teammates`, `Create my lab records`, the data export and `resetselection`
ran in the real VS Code through the lab driver (own one-lab specs, `badges/mkspec.mjs`). Everything a
Setup wizard or Flow Builder does was done at fidelity 3 (metadata deployed from the course's own
Level 3 start state, then retrieved as the lab says), except the Setup steps with a helper in
`scripts/walk/`, which ran in the real Salesforce Setup over CDP (Labs 2.2, 2.3, 2.6 and the grants).

| Lab | Fidelity | A | B | C | Findings |
|-----|----------|---|---|---|----------|
| 2.1 | 1 for `simulate`; backpromote as the CLI plan and run (the panel is not promptable) | read | ok | - | |
| 2.2 | 1 for `work:new` and publish; Setup field over CDP; flow as XML | read | ok | - | |
| 2.3 | 1; Setup `Required` over CDP, refused save in the browser; action by CLI | read | ok | - | |
| 2.4 | 1 for the story, records and export; object, fields, tab, app, grants as metadata; tick over CDP | read | ok | - | F4 |
| 2.5 | 1 for publish; the lab's code blocks pasted from the published page; tests run with `sf hardis:org:test:apex` | read | ok | - | |
| 2.6 | 1; Setup FLS over CDP; whole Profile retrieve as `mdapi read --active-only` | read | ok after the lab's own "If it goes wrong" | - | F3 |
| 2.7 | 1 for `simulate` and publish; merge by git, `merge-file --theirs`; flow as XML | read | ok | - | |
| 2.8 | 1 for `resetselection` and publish | read | ok | - | |
| 2.9 | 1; object, fields, flow, grants as metadata, ten records by bulk upsert | read | ok | - | |

Against the lab text, in numbers: 2.2 red on `Installation_Crew_Warning field integrity exception: unknown (The
field "Crew_Warning_Sent__c" ... doesn't exist.)` word for word, one task after two saves; 2.3 red on the
two permission sets word for word, `We hit a snag. Review the following fields: Crew Size`, `1 after the
merge`, 0 installations without a crew size in `helios-integration` afterwards; 2.4 red on the manual step
with the lab's verdict lines, green after the tick and a re-run, 12 records and the job `Helios crew
capacity nightly`; 2.5 coverage 80.64%, 76.92%, 95.38% and the PMD finding word for word; 2.6 the Profile
1829 lines, 764 after the cleaning commit, Cost absent from `helios-integration`, then present through the
permission set; 2.7 the permission set markers are the lab's snippet character for character, two
conflicting files, both survived; 2.8 14 files (+1742 -14) down to one after the reset, `canForcePush`
set; 2.9 the package.xml delta lists the 6 fields, the object and the tab, no robot commit this time.
Whole level: `Check my work` 9 of 9.

### The Level 2 badge claim

Same route as Level 1: issue `hardisgroupcom/sfdx-hardis-training#381`, audit *Level 2 verified, All 14
checks passed*, **sfdx-hardis Contributor Advanced** awarded, the claim also re-ran the Level 1 audits.

### Findings of Level 2

| Id | What | Where fixed |
|----|------|-------------|
| F4 | The data export of Labs 2.4 and 2.9 asks *Do you want to use org ...?* and *Do you confirm you want to export the data of ...?*: both are the two questions the lab describes. No lab-driver spec records them yet (the specs of 2.4 and 2.9 say "answers not recorded"). | Not fixed: the answers are in `badges/spec-24-exp.json` and `spec-29-exp.json` of this run |
| F5 | `resetselection` asks one question, *This command will git reset (soft) your branch ... Are you sure ?*, as the lab says. | Not a defect |

## Level 3

Straight after Level 2, no **Reset this level**. Lab 3.1 done (check green): the two Developer Edition
orgs seeded from `integration`, `preprod` created and the four branches protected with the lab's own
`gh api` call (GitHub asks for sudo confirmation before saving a rule in the browser), the story
`US-050-pipeline-up-to-production` started with the no-org answer in the real VS Code, **Add or Reconnect a
Major Org** for `preprod` and `main` with the course helper `auth.mjs` (panel at fidelity 2, the app
deployed into both orgs, the four secrets set), the settings of steps 8 to 10 written as the lab's YAML,
published through PR #17 and squash merged. Findings of the first labs:

| Id | What | Where fixed |
|----|------|-------------|
| F6 | The first seed of `helios-preprod` failed: the whole `Helios Crew` Profile of Lab 2.6 names `ContactPointOttSvc-Contact Point OTT Service Layout` and `SecurityDefenseActionEventStore-...`, which a Developer Edition org does not have (runbook, 2026-10-31). The error message points at Lab 2.6's *If it goes wrong*. Fixed as that lab says, with a **Fix** story (`fix/US-033-profile-layouts-new-orgs`, PR #16) deleting the two `<layoutAssignments>` blocks, validated with a dry-run of the whole package on `helios-preprod` first. | Not a defect: documented, but a learner meets it at Lab 3.1 after hours of work |
| F7 | `helios-preprod` and `DevHub` are one org with two aliases on this workstation, so the org list of Add/Configure Org shows `DevHub`. `auth.mjs` was given that alias. | Environment |
| F8 | A lab driver run with two `node scripts/training.mjs` steps in one lab spec times out opening the panel of the second one (120 s). One step per run works. | Not fixed: `../vscode-sfdx-hardis/src/test/ui/labDriver.ts` |
| F9 | The lab driver's VS Code host holds no GitHub session, so `sf hardis:project:action:run` (the **Retry** button of Lab 3.3) ends as an error there with no question asked: the command refuses to run without a provider token, as the lab says. Run headless with `GITHUB_TOKEN` (fidelity 2) it behaves as the lab describes word for word: action 1 green, *2 action(s) were stopped by this failure. What do you want to do?* answered *Run the next action only*, action 2 failing on `CrewCapacityBach`. | Not a defect of the course; a limit of the lab driver |
| - | Labs 3.2 and 3.3 matched the text throughout: US-052 comment *Ready to merge*, 4 components updated, no deletion, the removed `Total_Capacity_kW__c` line, the review comment on that line; the deployment log of PR #18 reads *Deployment mode: FULL + Quick Deploy* and *Components: 61 deployed*; US-056 red on `Crew_Workload__c` with the wildcard `Crew_W*` in `.forceignore`; US-062 red with `List has no rows for assignment to SObject`, *In integration: ❌ 1 failed · ⏸️ 2 waiting*, then *↪️ moved to #21*. Pull Requests #18 to #21. | |

### Labs 3.2 to 3.11, in numbers

| Lab  | Fidelity                                                                                                 | A    | B  | Notes against the lab text                                                                                                                                                                                                                                           |
|------|----------------------------------------------------------------------------------------------------------|------|----|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 3.2  | 1 for both `simulate`; review comment by API                                                             | read | ok | PR #18: *Ready to merge*, 4 components updated, nothing deleted; the removed `Total_Capacity_kW__c` line; after the fix the diff removes nothing                                                                                                                      |
| 3.3  | 1 for the simulations; Retry and `set-status` at fidelity 2 (F9); the group by API                       | read | ok | log: *FULL + Quick Deploy*, 61 components; US-056 red on `Crew_Workload__c` and the `Crew_W*` wildcard; US-062 red on `List has no rows`, then *Run the next action only*, then `CrewCapacityBach`, then PR #21 and *moved to #21*                                    |
| 3.4  | 1 for the simulation; review by API                                                                      | read | ok | US-020 (#22) red on *Illegal assignment from Datetime to Date* twice, left open with the comment; both grants present in the file and in the org                                                                                                                      |
| 3.5  | 1 for publish and the simulations; remote site by deploy; promotion PR through the browser helper        | read | ok | tick then green; *Type RemoteSiteSetting: 1 item(s) skipped because they already exist in the target org (protected)*; UAT keeps `warehouse-test.helios.invalid`; crew 3 and Scheduled in UAT; 23 PRs and 17 tickets in the notes                                    |
| 3.6  | Promotions through the browser helper and `promo.sh`                                                     | read | ok | preprod and main logins by JWT, red then green on the deliverability step; Release: *7 components (2 created, 5 updated), 62 validated*, no deletion; DORA read                                                                                                       |
| 3.7  | 1 for the simulation, the retrofit story and the publishes                                               | read | ok | incident reproduced in production by API (*The install date cannot be moved into the past*); hotfix #27, Hotfix PR #28, back-dated cancelled save accepted in production; retrofit #29 merged without a squash                                                       |
| 3.8  | `mon.mjs` (panel at fidelity 2) in a new repository                                                      | read | ok | all four jobs green; `ActiveScratchOrgs` 3/3; `[EmailProvider] Sent email to ***` (the address is a `.invalid` one: the mailbox was not read); the backup holds the hotfixed rule; `AGENTS.md` and `CLAUDE.md` written                                                |
| 3.9  | 1 for the generation (`--with-history`)                                                                  | read | ok | object pages, flow pages with Mermaid, the history page; the paragraph and `DO_NOT_OVERWRITE_DOC=TRUE`                                                                                                                                                              |
| 3.10 | 1 for five simulations, the retrofit story and the publishes; `promotion:create` at fidelity 2 (token)   | read | ok | three stories to preprod, two left in uat; the two conflicting files and the answer *commit with conflict markers*; Supplier kept, Warranty Years dropped; only the three reached `helios-preprod`; retrofit PR #38 with no file changed                              |
| 3.11 | 1 for the simulation and the publishes; promotions through `promo.sh`                                    | read | ok | US-055 #39, UAT #40, preprod #41 (no conflict, Warranty Years arrives), Release #42 (*13 components, 4 created, 9 updated*), the notes in the PR description, the second DORA report                                                                                  |

Whole level: `Check my work` 11 of 11.

### The Level 3 badge claim

Issue `hardisgroupcom/sfdx-hardis-training#382`: *Level 3 verified, All 24 checks passed*, **sfdx-hardis
Release Manager** awarded, the claim re-ran Levels 1 and 2. After the site rebuilt, `badges/nvuillamy.json`
reads Level 1 6/6, Level 2 14/14, Level 3 24/24 (superbadge), all dated 2026-11-09; `/badges/nvuillamy/`,
`/fr/badges/nvuillamy/` and the Level 3 image and banner answer 200.

### More findings of Level 3

| Id  | What                                                                                                                                                                                                                                              | Where fixed                                                                      |
|-----|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------|
| F10 | At Level 3 `Simulate my teammates` never asks *Merge it for you?*: every run ends after creating the Pull Request, and the Level 3 labs say to merge it yourself. At Level 2 the question was asked and my answer was used. Matches the lab text. | Not a defect                                                                     |
| F11 | The claim form (new GitHub issue UI) has a React Level dropdown, a fourth *Create more* checkbox and a header *Create new* button that matches before the green one. My first three scripts tripped on them.                                      | `scripts/walk/claim-submit.mjs` of this skill                                    |
| F12 | Eight monitoring repositories of earlier runs (`-run2` to `-run5`, the unsuffixed one, `-0925`, `-0926`) still had an active nightly workflow against `helios-prod`.                                                                              | Disabled (`gh workflow disable`), reversible with `gh workflow enable`           |

### Pull Requests and local commits of this run

| Repository                | What                                                                                                         | State                                |
|---------------------------|--------------------------------------------------------------------------------------------------------------|--------------------------------------|
| sfdx-hardis-training      | #383 `fix/lab-driver-fork-account-answer`: one optional rule in `lab-drivers.json` (F1) and a changelog line | open, mergeable, checks running      |
| sfdx-browserforce-plugin  | commit `5171c0e` on `feat/docs-site`: the description of `plugins validate` without a dollar-brace (F2)      | local, not pushed                    |
| sfdx-hardis, extension    | nothing: no product defect found                                                                             | -                                    |

### What this run did not cover

- **The webview DOM was never clicked** (runbook section 9): the lab driver answers the question the
  panel received. Not driven at all: the DevOps Pipeline cards and the `+ PR` chips, the Pull Request
  window and its Deployment Actions tab, the action editor, the Metadata Retriever and Source Control
  panels, the Data Workbench, the Backpromote panel, Pipeline Settings, the merge editor, the Org Monitoring
  and Documentation workbenches. Their commands ran instead, at fidelity 1 (the real panel and command
  together) where a lab spec could carry the answers, at fidelity 2 or 3 otherwise.
- **Setup and Flow Builder at fidelity 3**: the flows of Labs 2.2, 2.7 and 2.9, the objects, fields, tabs and
  apps of Labs 2.4 and 2.9, the permission set edit of Lab 2.7, the layout move of Lab 2.8, the remote site of
  Lab 3.5, the Crew Leads group of Lab 3.3 and the production checks were done by deploying the course's own
  Level 3 start state, or by the API, then retrieved or read as the lab says. What Flow Builder, the layout editor
  and the merge editor show a learner was not seen.
- **Lab 1.1 and the French labs** were not walked; **almost no lab screenshot was compared with a run**
  (the record page, the list view, the badge pages and the claim form were opened: about 5 of roughly 300).
- **GitHub pages at fidelity 3**: Files changed and the merge boxes, the Checks tab, the Settings pages for
  branch protection (sudo confirmation), secrets and the Actions banner (the banner was clicked over CDP).
- **The mailbox** of Lab 3.8 was not read, and nothing proves it: the alert address is a `.invalid` one.
- **An agent is not a beginner**: prose clarity was not tested.
- `check-site`, `check-nav` and `check-language-switch` were not run.

### State left behind

- Fork `nvuillam/sfdx-hardis-training`: four protected branches (`integration`, `uat`, `preprod`, `main`), six
  secrets, Pull Requests #1 to #42 (#22, the US-020 refactor, is open on purpose).
- Orgs: `helios-prod` and `helios-preprod` (the `DevHub` alias) seeded and in the pipeline; the scratch orgs
  `helios-dev`, `helios-integration` and `helios-uat` hold the app.
- Monitoring repository `nvuillam/sfdx-hardis-training-monitoring-run9`, its workflow disabled.
- Clone `C:\git\training-run` on `integration`, clean apart from `docs/` and `hardis-report/`.
- The e2e Chrome on port 9222 is still running with its own profile.
- Working notes and scripts of the run: `C:\git\training-e2e\badges\` (`STATE.md` holds the timeline).

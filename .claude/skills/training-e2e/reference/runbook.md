# Walking the course end to end: the runbook

Read this in full before starting. It holds the decisions that make a run meaningful and the traps
that cost previous runs hours.

The course is at <https://hardisgroupcom.github.io/sfdx-hardis-training/>: three levels, 27 labs,
7 + 9 + 11. A full walk of the three is a long session. Level 1 alone is worth running whenever the
contributor loop changed.

## 1. What a run proves, and what it cannot

A learner fails for four different reasons, and only the first is what unit tests catch:

| Failure                                                                                                             | Caught by                                                        |
|---------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------|
| A command was renamed, a flag dropped, a config key moved                                                           | `scripts/verify/check-commands.mjs`, the `training-impact` skill |
| A link rotted, a pill number drifted, a page lost an asset                                                          | `scripts/verify/check-*.mjs`                                     |
| The step works but the lab describes something else, or the screenshot shows a panel that no longer looks like that | **only this run**                                                |
| The step does not work at all on a clean environment                                                                | **only this run**                                                |

The two bottom rows are why this exists. Everything above them is cheap, runs in minutes, and must
be run first: there is no point walking 26 labs to discover a dead link.

What no run of this kind proves: that a human can follow the prose. An agent that already knows the
product reads past an ambiguity a beginner would stop at. Treat every sentence you had to re-read,
or any point where you knew what to do from the product rather than from the lab, as a finding.

## 2. Three ways to act like a user, in order of fidelity

Record, per lab, which one you used. A lab walked at level 3 is weaker evidence than one walked at
level 1, and the report must not hide that.

**Fidelity 1: the real VS Code UI, the lab driver.** `../vscode-sfdx-hardis` has a mode that opens a
real Extension Development Host **on the learner's own clone**, keeps the **real** `sf` CLI on the
PATH, and walks a lab through the real panels against the real orgs:

```bash
cd ../vscode-sfdx-hardis
yarn compile && yarn dev            # build order matters: tsc first, webpack last (see below)
SFDX_HARDIS_LAB_WORKSPACE="$RUN" SFDX_HARDIS_LAB_ONLY=1.3 yarn test:ui:labs
```

**Run it in the foreground, in a terminal of its own.** It launches a VS Code instance, and that
instance is a child of the run: a background job that gets torn down takes its window with it, and a
teardown that kills the process tree can reach the editor you are working in. This happened on
2026-09-21. Never start the lab driver as a killable background task, and never from the VS Code
session you are working in.

The answers come from `labs/_assets/lab-drivers.json` **in the course repository**, in the same rule
shape fidelity 2 uses, so a lab's answers are written once and replayed at either fidelity. A lab
carrying a `skip` there is one the driver cannot walk, and its reason is what the report prints as
not covered.

Use this for every lab the file covers. It is the only thing that exercises the real webview and the
real command at once. It does not reach a lab's browser or GitHub steps, and it is not everything
yet: [section 9](#9-what-the-lab-driver-still-does-not-cover) says what is left.

**Fidelity 2: the headless panel** (`scripts/panel.mjs`). This is the workhorse. It starts the same
WebSocket server the extension starts, runs the real `sf` command against the real org with
`--websocket`, and answers each prompt from a list of rules. It exercises the real command, the real
prompt protocol and the real org. It does not exercise a pixel of the webview.

The rule that makes it a test rather than a script: **a prompt no rule matches stops the run.** An
unanswered question is a finding, never something to guess, because a learner reading the lab would
be stuck on exactly that question. When it stops, decide which is wrong: the product asked something
it should not, or the lab failed to mention it.

```bash
node scripts/panel.mjs --cwd "$RUN" --answers '[
  {"q":"type of User Story","choice":"Feature"},
  {"q":"name of your User Story","value":"US-014 Panels Required field"},
  {"q":"org.*work","choice":"Current org"}
]' -- hardis:work:new
```

`{"value":"__INITIAL__"}` accepts what the panel pre-fills, which is what pressing Validate does.
`{"optional":true}` marks a rule that may not fire. Anything else unused is printed at the end: a
rule that was never asked is as much a finding as a question with no rule.

**Fidelity 3: `sf`, `git` and `gh` directly.** For the steps that are not clicks in the first place:
merging a Pull Request, reading a job log, editing a file. Legitimate for those. Whenever it replaces
a click, say so in the report.

**The browser.** Several labs end on a page: a Salesforce Setup screen, a Pull Request, a job log.
Those are read in the user's own signed-in Chrome over CDP, the same connection
`scripts/build/capture-web.mjs` uses. Ask the user to start it; never automate a sign-in, and never
type into a window you found by its title.

```bash
# the user runs this, with their own profile
chrome.exe --remote-debugging-port=9222 --restore-last-session
```

Four things the 2026-09-21 run paid for, driving Salesforce Setup over CDP:

- **Reach Setup through the Lightning domain, not the Setup domain.** With Enhanced Domains, Setup
  lives on `my.salesforce-setup.com` while the session belongs to `my.salesforce.com`. Navigating
  straight to the setup host renders a page whose actions all answer "Insufficient Privileges".
  Build the URL on the instance URL and let Salesforce redirect.
- **Open Object Manager by the object's durable id**, not its API name.
  `/ObjectManager/Installation__c/FieldsAndRelationships/view` lists the fields, and the matching
  `/new` denies the wizard. `/ObjectManager/01IE2000.../...` works, and is what clicking through
  Object Manager gives a learner anyway. `SELECT DurableId FROM EntityDefinition WHERE
  QualifiedApiName = '...'` (tooling API) gets it.
- **Setup buttons carry assistive text.** The New button's text content is `NewCustom Field`, so an
  exact-text selector finds nothing; `button[title="Custom Field"]` does. The wizard itself is a
  classic form in an iframe, with plain `input[name=...]` controls (`digleft` is Length).
- **Bring the tab to front before a screenshot.** Chrome throttles background tabs hard enough that
  `page.screenshot` times out. And after a long session the DevTools endpoint can wedge: `/json`
  still answers over HTTP while Playwright's attach hangs, and the cure is to close the instance's
  tabs through `/json/close/<id>` and relaunch it on the same `--user-data-dir`, which keeps the
  sign-in.

## 3. The environment

| Thing                                | Where                                     | Note                                                                  |
|--------------------------------------|-------------------------------------------|-----------------------------------------------------------------------|
| The course source                    | `$COURSE`, sibling `sfdx-hardis-training` | Read the rules and the images here; never do the labs here            |
| The learner's clone                  | `$RUN`, sibling `training-run`            | Every lab happens here                                                |
| The fork                             | `$FORK`, `<login>/sfdx-hardis-training`   | Reset before the walk                                                 |
| The monitoring repository            | `$MONREPO`, cloned into `$MONRUN`         | Lab 3.8 only                                                          |
| `helios-prod`                        | A Developer Edition org, Dev Hub          | Production in the fiction, and the Dev Hub the scratch orgs come from |
| `helios-preprod`                     | A second Developer Edition org            | Level 3 adds it to the pipeline                                       |
| `helios-dev`, `-integration`, `-uat` | Scratch orgs                              | Created by Set up my training environment                             |

`scripts/env.sh` and `scripts/env.mjs` derive all of this from the skill's own location and let every
value be overridden. Nothing is tied to one machine.

Traps that cost earlier runs time:

- **Build the extension `yarn compile && yarn dev`, in that order.** Both are needed: `yarn compile`
  (tsc) builds the test harness under `out/test/`, `yarn dev` (webpack) builds `out/extension.js` and
  `out/worker.js`. They both write `out/extension.js`, so whichever runs last wins, and
  `package.json` points `main` at it. Run tsc last and the extension loads the unbundled build, whose
  `out/utils/sfCoreInProcess.js` looks for the worker at `out/utils/worker.js`, where webpack never
  puts it. The log then says `worker error, using the CLI for every command: Cannot find module
  out/utils/worker.js`, the cache preload times out after 30 s, and every `sf` call costs ~38 s
  instead of being answered in process. It still works; it makes a Level 1 walk about twice as long.
  The 2026-09-23 run lost most of an hour to the old order, which said the opposite.
- **A VS Code window holding `$RUN` makes `reset-fork.sh` fail** with "Device or resource busy",
  after the fork itself has already been reset. The lab driver opens the clone, so this happens
  whenever a driver run was not closed. The script now says what to do; the way out is
  `RUN=/c/git/training-run2 bash reset-fork.sh`.
- **`Reset this level` reads the shared repository, not the fork.** `reset --level N` resets
  `integration` to `upstream/training/start-level-N`, and after `init` the `upstream` remote is
  `hardisgroupcom/...`. Two consequences (2026-09-24): a fork-only override (an unreleased build,
  the `beta` image tag) pushed onto the fork's start branches is lost on `integration` by the reset
  and has to be cherry-picked onto it again, with the protection lifted; and a stale
  `training/start-level-*` on the shared repository reaches the learner whatever the fork holds.
  `node scripts/build/start-branches.mjs --check` on the course's `main` says whether they are
  current. Since training PR #36 the course's `start-branches.yml` publishes them on every push to
  `main`; before it, only the monthly check looked, and a push by hand was the release step.
- **Docker Desktop is usually not running on the workstation.** `docker run ... sf plugins` to read
  the version inside an image fails on the daemon socket. Read the version from the job instead,
  or from the registry timestamps.
- **A brand new fork runs no workflow until someone clicks the Actions banner** ("I understand my
  workflows, go ahead and enable them"). The API lists zero workflows until then. Since 2026-09-25
  `init` notices it, opens the Actions page and waits up to 10 minutes: click the green button in
  the browser, which is also what Lab 1.2 now tells the learner. Before that fix `init` printed
  Actions OK and the first Pull Request got no checks. A run with no browser passes
  `--no-actions-wait` and clicks the banner some other way before step 7 pushes.
- **The CDP attach can hang** after hours of use, even once your own tab is closed. Do not restart
  the user's Chrome and never call `browser.close()`. For the badge claim, open the issue with
  `gh issue create` using the form's exact body and the `badge-claim` label, and record the step as
  fidelity 3.
- **Never chain a branch delete after a merge command.** When the merge is refused (a check still
  running, a review missing), deleting the head branch closes the Pull Request. Delete only after
  `gh pr view <n> --json state` says `MERGED`; `delete_branch_on_merge` is on in the fork anyway.
- **`backpromote --reset` is not the panel's Back button.** The button only checks out the branch
  you were on. `--reset` leaves the clone on a detached HEAD at `origin/<parent>`.
- **Leave MegaLinter's GitHub Actions auditor (zizmor) without a token.** Without one it prints a
  single warning. Giving it `GITHUB_TOKEN` (2026-09-25) turned that into about 70 findings on the
  project template's workflows, mostly unpinned actions and images. It warns and never blocks;
  Lab 1.6 explains the ⚠️ line it leaves on a green comment.

- **A teardown of an org that was used needs two things Salesforce does not do on its own**
  (2026-09-26). Old flow versions refuse the destructive deploy even deactivated (`insufficient
  access rights on cross-reference id`; `helios-preprod` had 31 after one walk), and deleted
  objects sit under Setup > Deleted Objects for 15 days, where `Installation__c.Account__c` keeps
  the `Installations` relationship name: the next `init` then fails on all three scratch orgs with
  *There is already a Child Relationship named Installations on Account*. The course's teardown
  deletes the versions and uses `--purge-on-delete` since training PR #48. On an org torn down
  before that, erase by hand: `/p/setup/custent/DeletedEntitiesList?setupid=CustomObjects`, and
  opening an **Erase** link hard-deletes at once (its token is the confirmation). Handover Item
  and Panel Batch answered "internal server error" to Erase and did not block the seed; Installation
  is the one that matters.
- **Git Bash rewrites arguments that look like paths.** A leading `/` becomes a Windows path:
  `sf org open --path /lightning/...` turns into `C:/Program Files/Git/lightning/...` and Salesforce
  answers *Invalid Page Redirection*. An argument with a `:` is read as a path list:
  `git show origin/integration:.github/workflows/x.yml` reached git as
  `origin\integration;.github\workflows\x.yml`. Prefix those commands with `MSYS_NO_PATHCONV=1`, and
  then give `git -C` a `C:/...` path, which the prefix no longer converts from `/c/...`.
- **Anonymous Apex compiles against the fields the running user can see.** A script that grants a
  new field and then writes it fails to compile at the first mention of the field. Two runs.
- **Writing a flow as XML skips what Flow Builder would refuse.** Flow Builder only offers the fields
  the person editing the flow can read. Lab 2.2 told learners to hide their new field from every
  profile, and a learner was stuck at the first Flow Builder step while two walks passed, both with
  the flow deployed as XML (2026-09-26). When a lab has a flow reference a field, check the admin
  can read it: `sf sobject describe` as that user lists only readable fields.
- **A Setup step done through the API is invisible to source tracking.** Granting a field through
  `FieldPermissions` DML does not put the permission set into Recent Changes the way the Setup
  screen does, so the Metadata Retriever list of that lab no longer matches the picture. Say so in
  the report when a lab is done that way.

**Always start from a reset fork.** `bash scripts/reset-fork.sh` closes the open Pull Requests,
deletes every branch but `main` and `training/start-level-*`, deletes the secrets, restores those
branches from the course, and clones the shared repository into `$RUN` the way a learner does. Three
of the five runs so far lost time to state left by the previous one.

**The orgs matter as much as the fork.** A scratch org that already holds Lab 2.3's Apex makes Lab
1.6 fail on metadata the repository does not carry yet, which reads exactly like a product bug.
Before Level 1, put each org back with `Training > Clean up a training org`
(`node scripts/training.mjs teardown`). Do **not** delete and recreate the scratch orgs:

- deleting does not return the daily allowance. A Developer Edition Dev Hub creates **6 a day**;
- the same Dev Hub also has a daily API cap, and a full walk gets close to it. `TotalRequests Limit
  exceeded` mid-Level-2 means waiting for the reset, not a bug.

Both limits are documented in Lab 1.2's "If it goes wrong", which is itself something to verify.

## 4. Three passes per lab

Do them in this order, for one lab at a time. Finishing the walk and then reviewing the text is how
the last two runs let stale screenshots through: by then you know the product too well to read the
lab as a beginner.

### Pass A: read it as a learner, from the published site

Fetch the lab's URL, not the markdown in the working copy. The published page is what a learner
reads, and the two differ whenever the course working copy is ahead of `main`. The URL of each lab is
in `training-manifest.json`.

**The site remembers a language, so the browser used for this pass can start lying to you.**
Clicking the flag in the header once writes `course-language` for a year, and from then on every
English URL opened in that browser lands on its French twin before it is painted. Two ways out,
and the first is the one to use: put `?lang=en` on the URL, which pins that page and resets the
preference. Otherwise clear the cookie for the site. A redirect you did not expect is worth a
second of doubt: read the address bar before concluding that a lab links to the wrong page.

Ask, of each step: is every term defined before it is used; does the step say where to click, not
just what to achieve; is a precondition stated that the previous lab did not deliver; does the "If it
goes wrong" section cover what can actually go wrong here.

### Pass B: do it

Every step, in order, at the highest fidelity that can do it (section 2). Do not skip a step because
you know it works. Do not fix the environment silently: if a step needs something the lab did not
tell the learner to do, that is the finding.

Then the lab's own check, which is what the learner clicks:

```bash
node scripts/training.mjs check --level 1 --lab 4      # Training > Check my work
node scripts/training.mjs status                       # Training > Where am I?
```

A check that passes while the lab is broken is itself a finding: the rules in
`scripts/verify/rules.mjs` are too loose. A check that fails on correct work is the same in reverse.

### Pass C: look at the images

```bash
node scripts/review-lab.mjs 1.4
```

It prints, for each image in reading order, the file to open, the pill numbers drawn on it, the pill
numbers the surrounding text refers to, and that text. **Open every image** with the Read tool and
compare it to what the product did in pass B.

What has actually gone wrong here before, none of it caught by a number check:

- a panel that has since gained or lost a column, or moved a button;
- a screenshot carrying story names or numbers from an older run, while the text uses today's;
- a red cross or an error banner from the run that took the shot;
- the side bar showing a view that lab never opened, because a capture before it left it there;
- a shot of the Extensions view, which has no marketplace access in that VS Code and renders an
  error.

A stale screenshot is regenerated with the harness, never edited by hand:
`node scripts/build/shots.mjs --lab 1.4` in the course repository, then the pills. The rules and the
traps of that harness are in the `training-update` skill; do not rediscover them here.

## 5. Level 1, seven labs

The pipeline and the contributor loop. Nothing else in the course works if this level does not.

| Lab | What it is                      | Driven by                                        | Proves                                                                      |
|-----|---------------------------------|--------------------------------------------------|-----------------------------------------------------------------------------|
| 1.1 | Install the tools               | Nothing to run: read it, check the 8 screenshots | The install page still matches the marketplace and the Setup panel          |
| 1.2 | Dev Hub, scratch orgs, pipeline | `training.mjs init`                              | The fork, the three scratch orgs, the branches, the secrets, the protection |
| 1.3 | Start a User Story              | `panel.mjs ... hardis:work:new`                  | The branch, its prefix, the story name rules                                |
| 1.4 | Build a custom field            | The browser, in Salesforce Setup                 | The field, both permission sets, the layout                                 |
| 1.5 | Retrieve, commit, publish       | `panel.mjs ... hardis:work:save`                 | Metadata Retriever, the commit, the push                                    |
| 1.6 | Pull Request, check, merge      | `gh pr create`, then `prflow.sh <pr> squash`     | The deployment check job, the merge, the deploy to integration              |
| 1.7 | Capstone, on your own           | The whole loop again, unaided                    | That a learner can repeat it without the step by step                       |

Level 1 notes that previous runs settled:

- The contributor loop the course teaches is **New User Story, then Commit changes (Metadata
  Retriever), then Save/Publish**. `hardis:work:save` has no component picker, and its "pull my
  latest updates" answer needs source tracking, which free Developer Edition orgs do not have. A lab
  that says otherwise sends the learner into a failure that reads like a broken tool.
- Lab 1.4 creates the field **not required** on purpose: Salesforce refuses field permissions on a
  universally required field, so a required field would make the permission set step impossible.
- Lab 1.6's Pull Request is squash merged. Feature Pull Requests are squashed; everything else in
  this course (promotions, retrofits, config) is merged.
- After rebuilding an org while a Pull Request is open, press **Update branch** before re-running the
  check, or the job replays the old merge ref.

## 6. Level 2, nine labs

The failures a contributor meets after the easy stories. Teammate branches and Pull Requests come
from `Training > Simulate my teammates` (`node scripts/training.mjs simulate`), never from you
opening them by hand: what the simulator produces is what the lab describes.

| Lab | What it is                             | Driven by                                                                            |
|-----|----------------------------------------|--------------------------------------------------------------------------------------|
| 2.1 | Backpromote                            | `panel.mjs ... hardis:work:backpromote`; the `backpromote` skill covers the protocol |
| 2.2 | A missing dependency breaks the deploy | `work:new`, `work:save`, then the failing check job                                  |
| 2.3 | Fix records with an Apex action        | A deployment action; the fix must be `Database.Batchable`, never a loop over a query |
| 2.4 | Reference data and a batch             | `hardis:org:data:import` and two deployment actions                                  |
| 2.5 | Code quality and Apex coverage         | The quality gate job on the Pull Request                                             |
| 2.6 | Permission sets and profiles           | `work:save`, and a grant that disappears                                             |
| 2.7 | A merge conflict with a teammate       | `simulate`, then the conflict resolved in `$RUN`                                     |
| 2.8 | Recover from the wrong metadata        | `hardis:work:resetselection`, which resets the commits                               |
| 2.9 | Capstone                               | Everything at once                                                                   |

- Level 2 **updates flows that already ship with the app** (`Installation_Crew_Warning`,
  `Installation_Close_Check`). A lab that creates one is wrong.
- `.forceignore` and `manifest/package-no-overwrite.xml` belong to Level 3 (Labs 3.4 and 3.6). They
  must not appear in Level 2.
- `hardis:work:resetselection` resets the **commits**: a soft reset, a restore of `manifest/`, and
  `canForcePush`. There is no stored list of ticked items, and no screen that shows one.

## 7. Level 3, eleven labs

The release manager. This is the level where the course touches the orgs and the repository hardest.

| Lab  | What it is                           | Driven by                                                                                         |
|------|--------------------------------------|---------------------------------------------------------------------------------------------------|
| 3.1  | Configure the pipeline to production | `scripts/auth.mjs <org> <branch> <urlRegex> <targetRegex>`, once per new branch, then the secrets |
| 3.2  | Review and merge a contributor PR    | `simulate`, then review and `prflow.sh <pr> squash`                                               |
| 3.3  | Read the deployment log              | The job log of the merge, and what `.forceignore` hides from it                                   |
| 3.4  | Three colliding Pull Requests        | `simulate`, then a merge order chosen and defended                                                |
| 3.5  | Promote to UAT, write release notes  | The `+ PR` chip of the DevOps Pipeline, `hardis:doc:release-notes`                                |
| 3.6  | Release to production, DORA          | The promotion into `main`, `hardis:doc:dora-report`                                               |
| 3.7  | Hotfix and retrofit                  | A hotfix from `main`, then the retrofit into `integration`                                        |
| 3.8  | Monitor production                   | `scripts/mon.mjs`, in a repository of its own                                                     |
| 3.9  | Project documentation                | `hardis:doc:project2markdown`                                                                     |
| 3.10 | Promotion branches (Beta)            | Five `simulate` stories, `hardis:project:promotion:create` with one conflict, a retrofit          |
| 3.11 | Capstone: a weekly release cycle     | One story all the way through, four promotions                                                    |

The role split is the point of this level, and it is easy to break by being helpful:

- **The release manager never opens a feature Pull Request.** Contributors do. In Level 3 the
  teammates (Sofia, Marco, Amina) come from `Simulate my teammates`, and the release manager reviews
  and merges their work.
- The release manager opens only the **promotion** Pull Requests, `integration -> uat -> preprod ->
  main`, from the DevOps Pipeline `+ PR` chips. The release notes go in the promotion Pull Request
  description.
- Their own configuration (`config/.sfdx-hardis.yml`, `config/branches/`, `.forceignore`,
  `manifest/package-no-overwrite.xml`) goes to `integration` through **Publish my pipeline
  configuration** (`node scripts/training.mjs publish`), which opens a Pull Request. **Nobody pushes
  to a major branch.**
- Pull Request titles say "Release" only into `main`, and "Promotion" otherwise.

**`work:new` sets the default org to the one of the story's branch.** After Lab 3.7's or 3.10's
retrofit the default is `helios-dev` again, which is why Labs 3.6 and 3.11 say to set `helios-prod`
before the DORA report. Skip that line and the report reads a scratch org with no history
(2026-09-25).

**The course and the CLI release in two steps, and the site publishes what `main` of the course
says.** On 2026-09-26 Lab 3.8 on the course's `main` described the deployment repository question
and the `AGENTS.md` of the backup (CLI #2241), which were in the beta and not in the released 8.10.0.
The walk ran the local linked CLI, so the question was asked, and the monitoring job ran the released
image, so no `AGENTS.md` was written. Compare a lab's claims with `git merge-base --is-ancestor <commit>
v<latest>` before reporting it as broken, and release the CLI before the course Pull Request that
describes it publishes.

**The Developer Edition orgs speak French.** Their Setup pages read *Écraser*, *Restaurer*, *Tous les
e-mails*, and a deployment error reads *Une relation enfant portant le nom ... existe déjà*. A CDP
script that matches English labels reports nothing to do there; match on link targets or element
names instead.

Lab 3.8 runs in a **second repository**, the monitoring one, with its own secrets
(`scripts/mon.mjs` then `scripts/setsecrets-mon.mjs`). Two things about its first run:

- **It is supposed to be red.** The Monitoring job fails on `ActiveScratchOrgs`, 3 of 3 at 100%, and
  the lab names that limit in advance and builds its triage exercise on it. Do not go fixing it.
- **Read the first lines of each step anyway.** "dubious ownership" inside the container has twice
  hidden a real defect behind a green-looking job: once a backup that silently never committed, once
  (2026-09-21) a `git pull` that ran before `safe.directory` was set and so never refreshed the
  branch. Both were in `defaults/monitoring/.github/workflows/org-monitoring.yml`, and both printed a
  reassuring fallback message. Check what the run actually did, not what it reported.

### Lab 3.10: the five stories, the conflict, the retrofit

The lab was proven on a synthetic repository (`node scripts/verify/prove-promotion-conflict.mjs`
in the course), never yet against real orgs in this shape. What a walk has to reproduce:

- **Five `Simulate my teammates` stories, merged into `integration` in this order**, each with
  **Squash and merge** before the next is simulated: US-058, US-057, US-059, US-060, US-061. The
  order gives the `uat` window US-061, US-060, US-059, US-057, US-058 from the top. US-059 carries
  `basedOn: us-058-warranty-term` and refuses to build while US-058 is not in `integration`: taking
  it early is the lab's own "If it goes wrong", not a defect.
- **The promotion carries rows 1, 3 and 4** (US-061, US-059, US-057). `promotion:create`
  cherry-picks oldest first: US-057 clean, **US-059 conflicts** on exactly
  `force-app/main/default/layouts/Panel_Batch__c-Panel Batch Layout.layout-meta.xml` and
  `force-app/main/default/permissionsets/Helios_Delivery_Manager.permissionset-meta.xml`, then
  US-061 clean. The `<<<<<<< HEAD` side is empty in both. In the layout, git cuts the block
  mid-element: `<layoutItems>` and `<behavior>Edit</behavior>` sit above the markers, the incoming
  side runs from `<field>Warranty_Years__c</field>` through the whole Supplier row to the
  `<layoutItems><behavior>Edit</behavior>` of the External Id row. In the permission set the
  incoming side is the Supplier grant **then** the Warranty Years grant (alphabetical). Proven
  against real orgs on 2026-09-24; the mock fixture of the editor screenshot was aligned on it.
  Headless, answer the conflict prompt with `commit-with-markers-all` (`panel.mjs` rule
  `{"q":"What do you want to do with","choice":"Recommended"}` or the `--on-conflict
  commit-with-markers` flag), and confirm the pre-ticked selection with
  `{"q":"Select the Pull Requests to carry","value":"__INITIAL__"}` when the button's
  `--pull-requests` flag is passed. Expect the check job of the promotion Pull Request red with the
  marker comment naming the two files.
- **Two resolution routes, and the walk should do the by-hand one** unless a coding agent is part
  of the run: on the promotion branch, in each file, keep the Supplier entry and drop the Warranty
  Years block (the expected results are printed in the lab, step 6). Push, check green, the
  sfdx-hardis comment names the three declared Pull Requests. The agent route pastes
  `hardis-report/promotion-conflicts-prompt-*.md` into a chat; if you run it, keep the agent's commit
  message and diff in the report.
- **Merge without squash, then assert in `helios-preprod`**: Awaiting Parts on Status, Gate Code on
  Installation, Supplier on Panel Batch; no Warranty Years, no Scaffolding Required.
- **Then the retrofit, step 9, is part of the lab**: `work:new` Retrofit `US-059-retrofit`, merge
  `origin/preprod`, the same two files conflict the other way round (integration side holds Warranty
  Years, preprod side nothing): keep the `integration` side, `work:save`, Pull Request into
  `integration` with **zero changed files**, merged. Without it, the capstone's `uat` into `preprod`
  promotion conflicts on those files, which is proven and is why the audit rule 3.10 checks that
  `git merge-tree integration preprod` is clean.
- `check --level 3 --lab 10` must pass right after step 9 and again after Lab 3.11's Thursday.
  Lab 3.11 now also asserts US-058 and US-060 reached `main`.
- **Known on the released CLI**: until a release ships `promotionConflictMarkersIgnoredFiles`
  (PR #2236, in `sfdx-hardis@beta` since 8.10.1-beta202609241317.0), the check job of a promotion
  Pull Request also names the two Lab 2.7 files; the lab's "If it goes wrong" says so. **On
  2026-09-25 that was still true of the released 8.10.0, and it blocks the learner**: branch
  protection forbids merging red, so Lab 3.10 cannot be finished until 8.10.1 ships. To prove the
  lab green in CI, point the fork's two deployment workflows at `sfdx-hardis-ubuntu:beta` (or use
  the unreleased-build override of section 8). **Check what the `beta` image really holds**: on
  2026-09-24 it was built two minutes before the registry served the beta it was meant to install,
  and ran the previous one; the symptom was the four-file marker comment on a job that said `beta`.
  Compare the image push time (Docker Hub tags API, `tag_last_pushed`) with `npm view sfdx-hardis
  time` for the beta version, and re-run the image job of `deploy.yml` if the image is older.
- The GitHub screens of this lab are captured by `capture-web.mjs` as
  `github-pr-promotion-description` and `github-pr-promotion-markers` (`web-captures.json`), from a
  real promotion Pull Request of the fork: the description with the folded prompt, and the red check
  comment naming the two files. Re-capture them when the Pull Request body or the comment changes.
- The deployment comment of the release into `main` lists US-057, US-059 and US-061 **twice** in
  its "Commits summary": once from the squash commits that arrive with the catch-up promotion, once
  from their cherry-picked copies on the promotion branch. The Tickets section lists each story
  once. Recorded in the 2026-09-24 report; not a lab failure.

### The badge claim

Claiming the level's badge is part of walking it, and the claim is what exercises the audit.

What a claim writes is the record and the image, `badges/<trailblazer>.json` and
`badges/img/<trailblazer>-level-N.svg`, and nothing else. The page is built from that record by
the site, once per language, so after a claim check both `/badges/<trailblazer>/` and
`/fr/badges/<trailblazer>/`, and that the badge on them is the hexagon rather than an older
drawing. After any change to the artwork, `node scripts/badges/rerender.mjs` redraws the badges
already awarded and `node scripts/badges/examples.mjs` the three on the home page; a run that finds
old and new artwork side by side has found a missing re-render, not a design problem.

If the audit does not run within a minute or two of the issue being opened, look at the issue's **labels**
before looking at the workflow: `claim.yml` gates on `badge-claim`, GitHub silently drops a label an
issue form asks for when the repository has no such label, and from the learner's side that is
indistinguishable from waiting. That was finding 12 of the 2026-09-21 run, and it meant no claim had
ever been audited.

## 8. Fixing what you find, inside the run

| The defect is                                            | Fix it in              | How                                                     |
|----------------------------------------------------------|------------------------|---------------------------------------------------------|
| The command, the flag, the report, the log               | `sfdx-hardis`          | The usual `implement` flow, plus a CHANGELOG entry      |
| The panel, the webview, the DevOps Pipeline              | `vscode-sfdx-hardis`   | Its own `CLAUDE.md` and skills, never this repository's |
| The lab text, a precondition, an "If it goes wrong"      | `sfdx-hardis-training` | `labs/en/` first, then the other locales                |
| A stale screenshot                                       | `sfdx-hardis-training` | Re-capture with the harness; never edit a PNG           |
| A check rule that passes broken work, or fails good work | `sfdx-hardis-training` | `scripts/verify/rules.mjs`                              |

Rules that hold whatever you found:

- **`labs/en/` is the reference.** Every change starts in English; `labs/fr/` follows with the same
  file names, ids, URLs and `depends_on`. A fix that lands only in `labs/fr/` is a fact nobody can
  find.
- One Pull Request per repository, cross-linked, in the order **CLI, then extension, then training**,
  each with its entry in that repository's `CHANGELOG.md`.
- A lab whose behaviour changed is affected in **every** language.
- Fix it inside the run, then re-do the step. A finding you noted and walked past is a finding the
  next run will have again.

### Proving an unreleased sfdx-hardis in the fork's CI

The course's jobs run in the released container image
(`ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:latest`), so a CLI fix made during the run is invisible
to them until a release ships: the labs the fix repairs stay red in CI, and the walk has to lift
branch protections to get past them, which is exactly what a learner cannot do. When the run has to
prove such a fix end to end, override the plugin **inside the jobs of the fork**, with a step
inserted right after the checkout of `check-deploy.yml` and `process-deploy.yml`:

```yaml
      # E2E OVERRIDE, fork only, never committed to the course: replace the
      # released sfdx-hardis of the container with an unreleased branch, to
      # prove a fix in CI before it ships.
      - name: Override sfdx-hardis with an unreleased branch (e2e only)
        run: |
          yarn --version || npm install --global yarn
          git clone --depth 1 --branch <the-fix-branch> https://github.com/hardisgroupcom/sfdx-hardis.git /tmp/sfdx-hardis-e2e
          cd /tmp/sfdx-hardis-e2e
          yarn install --frozen-lockfile
          npx tsc -b
          sf plugins link . 2>/dev/null
          sf plugins | grep hardis
```

How to get it onto every branch a job runs from, without touching the shared repository: commit it
in the course clone on a **local** branch cut from the branch under test, never pushed to the
course's origin, then reset the fork as usual and force-push that local branch to the fork's
`main`, and rebuild the start branches from it (`node scripts/build/start-branches.mjs`, pushed to
the fork only). Every major branch the learner's world derives then carries the step from the
start, so no Pull Request has to smuggle it in later.

**Pushing an override onto a brand new fork fools `init`** (2026-09-26). A push that touches a
workflow file makes GitHub list every workflow as `active` before anyone clicked the Actions
banner, so `init` prints "Actions are on" and no job ever runs. Either click the banner on the
fork's Actions page before the override push, or right after it and before `init`. `gh run list`
on the fork staying empty after the first Pull Request is the symptom.

**The image tag alone is a different override, for a different question.** Putting
`ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:beta` in the `container:` line of `check-deploy.yml` and
`process-deploy.yml` (one `E2E ONLY` commit on `main` and on each `training/start-level-*` of the
fork) runs whatever `beta` last published. It answers "does the course work on the next release",
costs nothing per job, and proves nothing about a fix branch that is not in that beta yet. Record the
beta version and the image push time, not a branch. The list below is for the source-build override.

What to expect and to record, with the source-build override:

- each overridden job pays the clone + `yarn install` + `tsc -b`, two to four minutes;
- the run report must say the jobs ran an unreleased build, name the branch and the commit, and
  keep the released image's failures on record (they are what a learner sees today);
- the override is a fork artifact: it disappears with the next fork reset, and nothing of it may
  land in a course Pull Request. `git log --oneline origin/feat-branch..local-branch` before
  opening any training Pull Request is the check;
- the monitoring repository of Lab 3.8 has its own workflows: override them only when the fix
  under test touches monitoring.

## 9. What the lab driver still does not cover

The lab driver (fidelity 1, section 2) closed the biggest hole: the real panel and the real command
now run together, so a defect that lives only in the webview over a correct command is caught. Three
things are still true, and every report says so.

**The webview DOM is still not reached.** The driver answers the question the panel *received* and
submits the answer the panel *would* submit; it does not click a pixel. A question that arrives
correctly and renders unreadably still passes. Only opening the screenshots (pass C) catches that.

**Only the labs in `lab-drivers.json` are driven**, and the ones that end in a browser or on GitHub
never will be: Lab 1.4 is Salesforce Setup, Lab 1.6 is a Pull Request. Every lab carrying a `skip`
prints its reason, so the gap is visible in the run rather than implied.

**A lab's "What you should see" is not asserted.** The driver opens the panels a lab declares
*before* its steps, and checks that a step's command completed. What the lab promises the learner
will see *afterwards* (the pipeline showing two branches with their orgs, the GitHub icon in colour)
is a post-condition the driver has no way to state yet. Pass C still has to read it by eye.

**Some steps are interactive by nature.** Lab 1.2 step 7 signs the extension in to GitHub through an
OAuth round trip in a browser; no harness can click that. The test host simply has no GitHub session,
and says so in its log.

**An agent is not a beginner**, which no harness fixes. See section 1.

Adding a lab to the driver is data, not code: record the questions the command asks, in order, as
answer rules in `labs/_assets/lab-drivers.json`, and drop the `skip`. The quickest way to get them
right is to run the lab with no rules at all: the driver stops at the first question and prints it
with its choices, which is the same loop that produced the rules already there.

## 10. The report

Write it into this skill's `reports/` folder as
`reports/training-e2e-report-<yyyy-mm-dd>.md`. Never at a repository root.

It contains:

- the versions under test: the sfdx-hardis commit, the extension commit, the course commit, and
  whether the published site was behind any of them;
- the orgs and the fork used, and whether they started clean;
- one row per lab: fidelity used, pass A / B / C verdicts, and the finding ids;
- every finding: what a learner would have seen, where it was fixed, the Pull Request;
- **what this run did not cover**, which is not optional: the labs skipped, the steps done at
  fidelity 3 that a learner does by clicking, and section 9.

A check that could not be run is "not covered", never "OK".

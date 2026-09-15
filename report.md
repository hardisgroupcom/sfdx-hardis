# Salesforce DevOps with sfdx-hardis: what was built overnight

**Date**: 2026-09-16
**Scope**: implement the training spec across three repositories, open the Pull Requests, then walk the course on a real fork and fix what it turned up.

---

## Summary

Three Pull Requests are open and cross-linked:

| Repository | Pull Request | What is in it |
|---|---|---|
| sfdx-hardis-training | [#1](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/1) | The whole course: 27 labs, the Helios app, the seed data, the Training menu, the checks, the badge machinery |
| vscode-sfdx-hardis | [#514](https://github.com/hardisgroupcom/vscode-sfdx-hardis/pull/514) | The Helios fixture universe, and four fixes building it exposed |
| sfdx-hardis | [#2206](https://github.com/hardisgroupcom/sfdx-hardis/pull/2206) | The two training skills, and three CLI bugs |

**The course exists and is complete**: three levels, 27 labs, 22 real screenshots, a working badge claim pipeline.

**Building it found six genuine product bugs**, three of which would have hit any user, not just a learner. That was the point of doing it, and it is the part of the night I would flag first:

1. `sf commands` crashed for **every user** with `ReferenceError: DS_PROMETHEUS is not defined`.
2. CI authentication with `SFDX_AUTH_URL_<ALIAS>` authenticated successfully and then left the job with no default org, so the very next command died with `NoDefaultEnvError`. **The Level 1 shortcut did not work at all**, and neither does that documented path for anyone using it today.
3. `hardis:work:backpromote` refused a Developer Edition org as if it were production, which rules out every project whose developers work in Developer Edition orgs.
4. The Welcome page ignored `customCommandsPosition`: a project's own menu always rendered last.
5. The screenshot harness hardcoded the fixture project in three places, and `click()` failed silently on every call rather than erroring.
6. My own `check.mjs` silently did nothing on Windows, found by running it rather than by reading it.

**What is not done**: the `training/start-level-N` reset branches, the upstream teammate Pull Requests, the GitHub web UI screenshots, and a full end-to-end walk of all three levels. Details and reasons in [Not done](#not-done).

---

## What was verified, and how

Nothing below is an assertion about code I wrote and did not run.

| Claim | How it was proven |
|---|---|
| The Helios app deploys **cold** on a Developer Edition org | Real deployment to an untouched org: 30 components, 4 tests, 0 failures, 100% coverage on `InstallationScheduler` |
| The seed data loads | 235 records in 7.5 seconds, upsert on external ids |
| The teammate branches deploy | US-018 and US-019 dry-run green together, 32 components |
| US-020 fails as the lab says it fails | Dry-run with tests: `Illegal assignment from Datetime to Date` in the test class, which is exactly what Level 3 lab 4 asks the release manager to send back |
| The Helios screenshots are accurate | 22 images inspected. Helios orgs, Helios Pull Requests, Helios deployment actions, the right branch in the status bar |
| The product screenshots did not move | Base-universe capture run, `git status doc-screenshots` empty |
| Every link resolves | 52 external URLs checked, plus every relative link between labs |
| The fiction is consistent | `universe.mjs` passes on 27 labs, and fails when a lab mentions a story the universe does not define |
| The checks work on a real fork | Level 1 run against a genuine fork: 2 of 7 pass, and the 5 failures name the right lab, the right artifact and the right path |
| The CI authenticates to a real org from GitHub | Job log: `Successfully logged using sfdxAuthUrl`, connected to the integration org |
| The auth fix works | Local run: `--set-default` now passed, `target-org` set |

---

## Detail

### 1. The training repository

[hardisgroupcom/sfdx-hardis-training#1](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/1), 195 files.

**The course.** 27 labs across three levels, plus three level home pages and a site home page. Every lab follows the same shape: the situation, what to have ready, numbered steps with screenshots, what you should see, what goes wrong and how to fix it, how to check your work, where to read more.

Every action is a click in the extension. The only typed command a learner meets in the whole course is reading one auth URL in Level 1 lab 1, and the lab says plainly why that exception exists and that Level 3 lab 1 deletes it.

Every significant step closes with an **Under the hood** block naming the exact command that ran, the files it wrote, and the one decision the tool made that the learner could not see. Those blocks are where the technical reader gets a mental model instead of a muscle memory.

**The Helios app.** A custom app for a fictional solar installer: two objects with 13 fields, a record-triggered flow, a validation rule, an Apex scheduler with tests, an LWC timeline, a Lightning record page, two permission sets, two tabs and a custom application. It deploys cold on a Developer Edition org in one pass.

**The data.** 235 records generated deterministically, so two learners on two continents see the same numbers in the same screenshots. Upsert on external ids, so seeding repeats safely.

**The Training menu.** Six cards on the Welcome page, declared through `customCommands`, all running `node scripts/training.mjs <verb>`: where am I, set up an org, check my work, simulate my teammates, reset this level, clean up an org. **Everything under `scripts/` is dependency-free Node**: a learner clones and clicks, and there is no `npm install` anywhere in the course.

**The checks.** 27 rules, one per lab, shared by "Check my work" locally and by the badge claim audit. Two rules govern them, from the spec: assert outcomes rather than procedures, so a learner who rebased or resolved a conflict in the GitHub web editor passes; and every failure message names the lab, the artifact and where it was looked for, because that message is the only support channel a learner has.

**The badges.** An issue form, a workflow that clones the learner's public repository and audits it, an SVG template and a page renderer. Nobody reviews a claim. A level 2 claim re-runs the level 1 audit, and a level 3 claim re-runs all three, which is how the prerequisite is enforced given that a Trailmix cannot gate anything.

The claim workflow carries its five safety rules as a comment at the top: never execute anything from the clone, never give it a Salesforce secret, treat every field as hostile, bound the clone, serialise the commits.

### 2. Decisions I took, and why

**The package directory is `force-app`, not `seed/`.** The spec said `seed/`. But the learner edits and republishes these sources for the whole course, and `hardis:work:save` computes its package from the declared package directories. Calling the working source folder `seed/` would have taught a non-standard project layout for no benefit.

**The permission set is assigned between the deployment and the data load.** The spec had it after. A metadata deployment grants **no field-level security to anybody**, not even to a System Administrator, so loading the data first fails on fields the running user cannot see, with an error that says nothing about permissions. This cost about an hour to diagnose, and is now a comment in `seed.mjs` so nobody pays it twice.

**The shell wrappers call `training.mjs`, not the other way round.** The spec had `training.mjs` calling `bootstrap.sh`. Inverting it gives one implementation and two entry points, with no drift between Windows and everything else.

**Level 2 lab 1's seeded trap changed shape.** The spec had `.forceignore` excluding `Crew_Size__c`. That is self-contradictory: the same file is needed by the seed data, so excluding it breaks the baseline. The trap is now a stale `Crew_W*` wildcard that swallows a field the learner creates in that lab, which teaches the same lesson (`.forceignore` makes metadata invisible in both directions, silently) without breaking anything.

**`MY-PIPELINE.md` exists.** Several labs produce no source artifact: reading a DORA report, setting up monitoring in a second repository, deciding what to do with a backpromote. The audit cannot verify org state and does not try. So those labs ask the learner to record one factual line in a notebook file, which the audit reads. It is also the document a successor would actually want, which is why it is framed as project documentation rather than as homework.

### 3. The fixes

#### In sfdx-hardis ([#2206](https://github.com/hardisgroupcom/sfdx-hardis/pull/2206))

**`sf commands` crashed for every user.** `ReferenceError: DS_PROMETHEUS is not defined`.

A command description ends up verbatim in `oclif.manifest.json`, and oclif runs template interpolation over the descriptions it reads back from that manifest. A description whose **rendered** text contains `${something}` therefore makes oclif evaluate `something` as a variable name. Escaping it in the TypeScript source is not enough: the manifest stores the evaluated string.

Two commands had one. `test/command-descriptions.test.ts` now walks every compiled command and fails on any `${...}` in a description or a summary. **It found the second one immediately**, which is the argument for having it.

**CI authentication with `SFDX_AUTH_URL_<ALIAS>` left the job with no default org.** The JWT and web-login branches both pass `--set-default` unless the caller opted out. The auth-URL branch relied on a variable that is only computed when the hook also checks the existing connection, so in a CI job it was always false. The job authenticated, reported success, and the next command died with `NoDefaultEnvError: No default environment found`.

Found by running the real Level 1 Pull Request check on a real fork against a real org, which is the only way it could have been found. It is not a training-only problem: this is the documented shortcut path for scratch orgs and Dev Hubs too.

**Backpromote refused a Developer Edition org.** The rule was "a developer sandbox or a scratch org". The real invariant is "not production and not a major org", and a Developer Edition org used as somebody's development environment satisfies it. A Developer Edition org that **is** the org of a major branch stays refused by the check that already existed. Unit tests cover both directions.

This one made Level 2 lab 0 impossible, since the whole course runs on Developer Edition orgs.

**The skills.** `training-impact` decides whether a change breaks a lab and names which ones, reading `training-manifest.json` from the sibling clone and cloning it if missing. `training-update` performs the edits. Both live in sfdx-hardis only; the other two repositories carry a pointer, not a copy.

The case they exist for is not the obvious one. A renamed command breaks a lab loudly. What breaks it silently is a behaviour change under an unchanged name: the training seeds failures on purpose, and one that stops failing turns a lab into a page describing something that does not happen. No test anywhere notices.

`scripts/check-training-impact.mjs` does the mechanical part and correctly flagged Level 2 lab 0 as affected by the backpromote change.

#### In vscode-sfdx-hardis ([#514](https://github.com/hardisgroupcom/vscode-sfdx-hardis/pull/514))

**The Welcome page ignored `customCommandsPosition`.** A project declaring `customCommandsPosition: first` got its menu rendered **last**, below every built-in card, while the Commands tree honoured the setting. The position now travels with each menu. This is a plain bug for any project that declares custom commands, and it is what the Training menu needed.

**The screenshot harness hardcoded the base fixture in three places.** The window title in `capture`, `click` and `record`, plus the feature branch the contribution cards come from. `click()` failed on every call with "No window matching 'MyCompany-CRM'" and the suite carried on, producing screenshots of the wrong panel state rather than an error. That is worth noticing independently of the training.

**The backpromote org picker classified a Developer Edition org as production**, and relied on finding `dev-ed` in the instance URL, which a Developer Edition org with a custom My Domain does not have. It now uses the edition the CLI reports, matching the CLI-side fix.

**The backpromote copy said "developer sandbox"** where the feature now accepts more. Reworded to "development org" in all nine locales.

**The ticket provider mock could only build JIRA-shaped URLs.** A fixture can now declare `ticketUrlTemplate`; without one the JIRA path is kept, so existing fixtures are unaffected.

**`SF_MOCK_UNIVERSE`.** Unset means the current behaviour byte for byte. Set to a name, the run takes its fixture project, workspace name, branch topology, git remote and provider fixtures from `test/fixtures/screenshot/<name>/`. The diff contains **no modification to an existing fixture value**, which a reviewer can check in one glance at the file list, and the invariant is proven by running the base universe and finding `doc-screenshots/` untouched.

### 4. The screenshots

22 images, captured from the real extension with Helios fixtures. Each one was inspected, not just generated.

What the Helios captures show: the Helios orgs in Orgs Manager, the `Training` card first on the Welcome page, the Helios branches and the three teammate Pull Requests in the DevOps Pipeline, the nine deployment actions of US-024 with Helios labels, the backpromote plan listing the three teammate stories with the right authors.

One happy accident worth keeping: the DevOps Pipeline capture shows two warnings, "No merge target defined for branch integration" and "No encrypted certificate key file found". Those are **exactly** what Level 3 labs 0 and 1 fix. Both labs now point at them explicitly, which turns a thing a learner might read as a defect into the first page of their first week.

Two rounds of fixture work were needed to get there. The first run produced correct-looking screenshots with MyCompany data, because the mocked CLI reads its overlay from a folder that gets copied to a temp directory. That is the kind of thing only looking at the image catches.

### 5. The end-to-end test

A real fork at `nvuillam/sfdx-hardis-training`, with a real integration branch, a real repository secret, a real feature branch carrying US-014, and a real Pull Request.

What it proved:

- The workflows run on a fork and reach the check.
- The authentication step really connects to the Salesforce org from GitHub's runners.
- The `NoDefaultEnvError` bug above, which no amount of reading would have found.
- `check.mjs` produced **no output at all** on Windows: the "run directly" guard compared `import.meta.url` with a hand-built `file://` string, and a Windows file URL has three slashes and a drive letter. The Training menu path worked, so only running the documented direct invocation exposed it. Fixed with `pathToFileURL`.
- The Level 1 checks then behaved correctly: 2 of 7 passing on a half-done fork, with failures naming the right lab, artifact and path.

---

## Not done

Said plainly, with what each one needs.

**The `training/start-level-N` reset branches do not exist.** **Training > Reset this level** needs them. It fails with a clear message when they are missing rather than doing something odd, but the feature is inert until they are created. They should be created from the states a learner reaches at the end of each level, which means walking the course first.

**The upstream teammate Pull Requests are not opened** on the training repository. The in-fork replay through **Training > Simulate my teammates** works and is what learners actually use. The upstream ones exist only so the GitHub web UI screenshots are real artifacts.

**No GitHub web UI screenshots.** Six lab steps describe GitHub screens in words meanwhile. They depend on the upstream Pull Requests above, and `scripts/capture/github.mjs` is specified but not written.

**Levels 2 and 3 were not walked end to end.** Every piece they rest on is verified separately: the metadata deploys, the teammate branches deploy and fail as designed, the checks run. The whole was not walked. Level 1 was, as far as the Pull Request check.

**The Trailmixes are not created.** That is browser automation against the Trailhead UI and the step tables are ready for it, but it needs the site published first, which needs the training Pull Request merged and Pages configured.

**Pages is not configured.** The repository setting has to be **Deploy from a branch: `gh-pages`**. A repository set to the "GitHub Actions" source would publish nothing and give no error, which is why the workflow says so in a comment.

**`zensical build` was not run.** The site assembly (`site-src/`) is verified; the Zensical build needs Python packages that were not installed here. The workflow follows the pattern already working in sfdx-hardis.

---

## What I would look at first

1. **The three CLI fixes are worth releasing on their own**, independently of the training. `sf commands` being broken and the auth URL path leaving no default org both affect users today.
2. **The `force-app` versus `seed/` decision** in the training repository, since it departs from the spec.
3. **Level 1 lab 1's auth URL exception.** It is documented with a warning box and a forward link, and it contradicts the product documentation on purpose. Worth a second opinion.
4. **The seeded failure in Level 2 lab 1**, which I changed to keep it consistent with the baseline.

---

## The commands to check any of it

```bash
# the training repository
cd ../sfdx-hardis-training
node scripts/build/universe.mjs        # the fiction is consistent, 27 labs
node scripts/verify/check-links.mjs    # 52 URLs
node scripts/verify/check.mjs --level 1

# the screenshots, and the invariant
cd ../vscode-sfdx-hardis
SF_MOCK_UNIVERSE=helios SFDX_HARDIS_DOC_SCREENSHOTS_DIR=../sfdx-hardis-training/labs/_assets/vscode yarn screenshots
yarn screenshots && git status --porcelain doc-screenshots   # must be empty

# the CLI
cd ../sfdx-hardis
npx mocha --loader=ts-node/esm test/command-descriptions.test.ts
npx mocha --loader=ts-node/esm test/common/utils/backpromoteRules.test.ts
node scripts/check-training-impact.mjs
```

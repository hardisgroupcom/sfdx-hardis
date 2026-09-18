# Session continuation: the sfdx-hardis training

Everything another Claude Code instance needs to pick this work up, **on any computer**. Nothing
here depends on a path that only exists on one machine: where a local detail is needed, the fallback
that rebuilds it is given next to it.

**Last updated**: 2026-09-16, during the Level 2 walk and the screenshot pass.

---

## What this is

Three learning paths ("Salesforce DevOps with sfdx-hardis") built across three repositories, from
the spec at `specs/trailmix-salesforce-devops.md` in this repository.

| Repository                            | Branch                   | Pull Request                                                          |
|---------------------------------------|--------------------------|-----------------------------------------------------------------------|
| `hardisgroupcom/sfdx-hardis-training` | `feat/training-v1`       | [#1](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/1)   |
| `hardisgroupcom/vscode-sfdx-hardis`   | `feat/training-fixtures` | [#514](https://github.com/hardisgroupcom/vscode-sfdx-hardis/pull/514) |
| `hardisgroupcom/sfdx-hardis`          | `feat/training-skills`   | [#2206](https://github.com/hardisgroupcom/sfdx-hardis/pull/2206)      |

Published site: <https://hardisgroupcom.github.io/sfdx-hardis-training/>

`report.md` in this repository is the full account of what was built and what was found. It is
git-ignored on purpose, so **it only exists on the machine that wrote it**. If it is not there, this
file plus the Pull Request descriptions carry the same facts.

---

## Getting a working machine from nothing

The three clones must be **siblings**, because the skills and the screenshot harness resolve each
other with `../`:

```bash
mkdir -p ~/git && cd ~/git          # any parent folder works, they only have to share it
git clone https://github.com/hardisgroupcom/sfdx-hardis.git
git clone https://github.com/hardisgroupcom/sfdx-hardis-training.git
git clone https://github.com/hardisgroupcom/vscode-sfdx-hardis.git

cd sfdx-hardis          && git checkout feat/training-skills   && yarn install
cd ../sfdx-hardis-training                                      # no dependencies, plain Node
cd ../vscode-sfdx-hardis && git checkout feat/training-fixtures && yarn install
```

On the machine this started on they are `C:/git/sfdx-hardis`, `C:/git/sfdx-hardis-training` and
`C:/git/vscode-sfdx-hardis`. Nothing requires that exact path.

| Tool                                                                  | Needed for                                            | If it is missing                                                                                                            |
|-----------------------------------------------------------------------|-------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| Node 20+                                                              | everything                                            | install from nodejs.org                                                                                                     |
| `sf` CLI plus the `sfdx-hardis`, `sfdmu` and `sfdx-git-delta` plugins | the org work                                          | `npm i -g @salesforce/cli` then `sf plugins install sfdx-hardis sfdmu sfdx-git-delta`                                       |
| `gh`, authenticated                                                   | Pull Requests, CI logs, repository settings           | `gh auth login`, scopes `repo, workflow, read:org`                                                                          |
| Zensical                                                              | building the site                                     | `pip install zensical mdx_truly_sane_lists`, then **`python -m zensical build`** (the `zensical` binary is not put on PATH) |
| `playwright-core`                                                     | the live site checks and `scripts/build/annotate.mjs` | `npm i --no-save playwright-core` in the training repo                                                                      |
| Chrome with CDP                                                       | the web screenshots and the live checks               | start Chrome with `--remote-debugging-port=9222`, signed in to GitHub                                                       |

**Never automate the desktop.** A capture script that used `SendKeys` and matched a window by title
took over the user's own VS Code window and closed it. VS Code screenshots come from the extension's
own harness (`yarn screenshots`), which drives an instance it owns; web screenshots come from
Playwright over CDP in a new tab. Nothing else.

---

## The orgs

Four Developer Edition orgs, all disposable, all fair game (the user said so explicitly: reset,
deploy, delete as needed).

| Alias                                             | Username                                       | What it is                 |
|---------------------------------------------------|------------------------------------------------|----------------------------|
| `helios-dev`                                      | `veurtio.dd9da51447c4@agentforce.com`          | the learner's own dev org  |
| `helios-integration` (also aliased `integration`) | `veurtio+demo.73193ee31bf8@agentforce.com`     | the shared integration org |
| `helios-uat`                                      | `nicobackup@nico.com`                          | Level 3                    |
| `helios-prod`                                     | `nicolas.vuillamy.c8024b5deb9f@agentforce.com` | Level 3                    |

**On another computer none of these are authenticated.** Check with `sf org list`, then either:

- re-authenticate the same orgs with
  `sf org login web --alias helios-dev --instance-url https://login.salesforce.com`
  (the passwords are in the user's own store, so this needs the user), or
- **build fresh ones**, which is what the course asks a learner to do and is the better test: sign up
  at <https://developer.salesforce.com/signup>, authenticate with the alias, then seed with
  `node scripts/training.mjs seed --org <alias>` from the training repository. That deploys the
  Helios app, assigns the permission set and loads 235 records, and it is idempotent.

The aliases are what everything keys on. `SFDX_AUTH_URL_<ALIAS IN UPPER CASE>` is the CI secret name,
so an org used by the `integration` branch has to answer to the `integration` alias too.

---

## The learner fork

`nvuillam/sfdx-hardis-training`, which is where the modules are actually played.

- `main` carries the course, `integration` is the major branch, feature branches come off it.
- Level 1 is complete on it: US-014 and US-016 merged, audit 6/6, badge rendered.
- Secret `SFDX_AUTH_URL_INTEGRATION` points at `helios-integration`. **Delete it when the walk is
  finished**: it is a long-lived refresh token, and removing it is exactly what Level 3 lab 1 teaches.
- A second throwaway fork, `nvuillam/sfdx-hardis-training-fresh`, was made only to photograph a
  brand-new fork. **Delete it** (needs the `delete_repo` scope, or the GitHub web UI).

The local clone of the fork lives in this session's scratchpad, which does **not** survive to another
machine. Recreate it anywhere:

```bash
gh repo clone nvuillam/sfdx-hardis-training learner
cd learner && git checkout integration
```

The CI secret, when it has to be set again:

```bash
sf org auth show-sfdx-auth-url --target-org helios-integration --no-prompt --json
gh secret set SFDX_AUTH_URL_INTEGRATION --repo nvuillam/sfdx-hardis-training
```

---

## GitHub Pages

Pages is enabled on the training repository with **Source: GitHub Actions**, publishing from
`feat/training-v1`.

- `.github/workflows/pages.yml` therefore has a **TEMPORARY** `feat/training-v1` push trigger, with a
  comment saying so. **Remove it when the branch merges.**
- **Remind the user to point Pages back at `main` after the merge.** They asked to be reminded.

---

## Where the work stands

### Done and verified

- The course: 27 labs, 3 levels, the Helios app, the seed data, the Training menu, the checks, the
  badge machinery.
- Level 1 walked end to end on the fork against a real org: PR check green (31 components, 4/4 tests,
  100% coverage), both stories merged, audit 1/6 to 6/6, badge rendered from that audit.
- 51 screenshots captured from the real extension with the Helios fixtures, and the product
  screenshots proven unchanged (`SF_MOCK_UNIVERSE` unset keeps `doc-screenshots/` byte identical).
- The site builds and every asset resolves (38 pages, 141 references).
- All three Pull Requests green.
- Level 2 lab 1 (the `.forceignore` trap), lab 2 (rewritten against measured org behavior), lab 4
  (the PMD rule that actually fires) and lab 5 (what `minimizeProfiles` actually strips) verified
  against real runs.

### The Level 2 walk, in progress

**All nine labs walked.** Verified against real runs or against the command's own source: **0**
(backpromote), **1** (the `.forceignore` trap), **2** (rewritten against measured org behavior),
**3** (the three deployment actions firing in CI, Pull Request #3 on the fork), **4** (the PMD rule
that actually fires), **5** (what `minimizeProfiles` strips), **6** (both conflicts, against a real
merge), **7** (`resetselection`), **8** (the capstone sequencing).

What the walk has found so far, beyond the labs it corrected:

- **Lab 6 promised a conflict that could not happen.** It told the learner to grant edit on
  `Crew_Size__c`, which is already granted on that permission set, so the edit changed nothing. Now
  `Crew_Notes__c`, which conflicts because it sorts where Marco inserted his.
- **The teammate simulation raced GitHub.** `gh pr create` fired before the API could see the branch
  just pushed, and answered "No commits between integration and <branch>". Retried now.
- **A data deployment action with `context: all` runs during validation**, against an org where the
  object does not exist yet, and SFDMU exits 0 having done nothing. The lab tells the learner to use
  `all`. Watch Pull Request #3 to the end before deciding: if the real deployment loads the records,
  the lab should still be changed to `process-deployment-only`, because a validation job silently
  loading nothing teaches the wrong thing.
- **`resetselection` does far more than clear a selection**: it soft resets every commit since the
  branch left its target, clears the staging area, restores both manifests and sets `canForcePush`. Lab 7 said in
  bold that it does *not* undo the commit. A learner following it would have reset twice.
- **Backpromote leaves the checkout on `backpromote/<parent>/<sandbox>`.** Lab 0 never said so.
- **The capstone asked for a teammate story lab 6 had already merged**, so its third challenge could
  not happen. It uses US-019 now.
- **`productionBranch` has no field in the settings panel**, and the project already carries it. Lab
  3-00 told the learner to set it there.
- **Delta deployment is off in this project** and lab 3-03 taught it as active.

### Level 3, verified against the sources

**All eleven labs carried a wrong claim. Six could not be run as written.** Verified by reading the
commands and the panels, not by walking them: there was a worldwide Salesforce outage that day.

The six that were impossible: a teammate story an earlier lab consumes, a merge conflict where the
two edits land fifty lines apart (reproduced in a scratch repository, git merges them cleanly), a
validation rule that already contained the fix the lab asked for, a button that does not render in a
CI/CD repository, a branch selector that only lists branches which already have a config file, and a
capstone repeating the Level 2 capstone's defect.

Audit rule `3-04` could not be passed either: it required US-020 in the integration history
while the lab correctly sends that story back to its author.

**Five claims still need a real org**, and are the first thing to settle when one is free:

1. That the corrected `Installation_Date_Not_Past` rule really refuses a back-dated `Cancelled` save
2. Whether `Needs Reinspection` appears in the Metadata Retriever's default Recent Changes mode
3. What a first monitoring report actually contains on a fresh Developer Edition org
4. The shape of the DORA output on an org with two or three deployments
5. Whether the External Client App deploy on `helios-prod` triggers the production Apex test path

### The reset branches

`scripts/start-states/level-3/` is built: 40 files, everything the nine Level 2 labs deliver.
Proven three ways: `check.mjs --level 2` passes 9 of 9 against a clone sitting on
`training/start-level-3`, the metadata validates against a real org (51 components, 0 failures, 8
tests with `RunLocalTests`), and building it caught a `FlowCustomErrorMessage` missing its `name`
plus a scheduler test that broke once Crew Size became required.

`node scripts/build/start-branches.mjs` creates all three branches locally. **They are not pushed
yet, on purpose**: the script says to run it from `main` once the training Pull Request has merged.
Until they are on the remote, `Training > Reset this level` aborts for every level, and several labs
point at it. **After the merge, run `node scripts/build/start-branches.mjs --push` from `main`.**

Two deliberate choices in that start state, recorded in its `state.json`:

- **US-019 is absent.** Level 3 lab 4 simulates and merges it; shipping it pre-merged makes that
  exercise a no-op.
- **US-018 is present**, because rule `2-06` requires Marco's cap. Level 3 lab 2 therefore reviews
  the merged Pull Request rather than simulating one, which is how it now reads.

### In progress, picked up here

The screenshot pass. The user asked for a picture on every step that tells a learner to click, with
numbered pills on the control, the pills referenced from the step text, and every image checked by
eye before and after the pills are drawn. The rules are written into
`.claude/skills/training-update/SKILL.md`, section Screenshots.

An audit of all 27 labs produced the inventory: **155 steps need a picture, 24 had one**. It also
found about thirty places where a lab names a control the product does not have.

Done so far:

- `scripts/build/capture-web.mjs` + `labs/_assets/web-captures.json`: the web pages (git, Node and
  VS Code installers, the marketplace page, the Salesforce signup, the fork button, the fork form,
  the Actions tab, the secret form). `"fresh": true` captures a page as a signed-out visitor.
- `scripts/build/annotate.mjs` + `labs/_assets/annotations.json`: numbered pills into
  `labs/_assets/annotated/`. Percentages, `px`/`py` to keep a pill off a label, `#variant` keys so one
  screenshot can carry several pill sets. 20 annotated images so far, each one looked at.
- New extension captures: the New User Story and Save / Publish commands at every question, and the
  branch scoped Pipeline Settings. The mocked CLI scenarios are universe aware now, so they name the
  Helios story instead of MyCompany-CRM.
- Label corrections: Level 1 complete, Levels 2 and 3 partly done (see below).

Still to do:

- Finish the label corrections in Level 2 (lab-03 onwards) and Level 3 (lab-05 step 6 onwards). The
  full mismatch table is in the audit; re-run it with the Explore agent if it is lost.
- Place the annotated images into the lab text with their pill references. Only Level 1 labs 0 and 1
  are partly done.
- The Salesforce Setup captures (Level 1 lab 3 and beyond): a `scripts/build/capture-salesforce.mjs`
  was specified but not written. It opens `sf org open --url-only`, then drives Setup over CDP.
  **Never save anything in the org while capturing a wizard.**
- The GitHub Pull Request, checks and comment captures from the fork.
- The rest of the Level 2 walk (labs 0, 3, 6, 7, 8), then Level 3 end to end.

### Not done yet

- `training/start-level-2` and `training/start-level-3` branches, built from the real end states.
- Teammate Pull Requests in the fork, and the GitHub screenshots taken from them.
- The lab steps that still describe a GitHub screen in words.

---

## How to check anything

From the training repository:

```bash
node scripts/build/universe.mjs --check      # the fiction is consistent, nothing generated drifted
node scripts/verify/check-links.mjs          # every link resolves
node scripts/build/site.mjs && python -m zensical build && node scripts/verify/check-site.mjs
node scripts/build/annotate.mjs --check      # the annotated screenshots match their spec
node scripts/verify/check.mjs --level 1      # where a learner repository stands
node scripts/verify/audit.mjs --level 2 --dir <a clone> --handle <handle>
```

Screenshots of the extension, from the extension repository (Windows, unlocked desktop):

```bash
cd ../sfdx-hardis-training && node scripts/build/mocks.mjs
cd ../vscode-sfdx-hardis && yarn dev && yarn compile
SF_MOCK_UNIVERSE=helios \
SFDX_HARDIS_DOC_SCREENSHOTS_DIR=../sfdx-hardis-training/labs/_assets/vscode \
yarn screenshots [names]
yarn screenshots && git status --porcelain doc-screenshots   # must stay empty: the product images did not move
```

Web screenshots, from the training repository, with Chrome listening on 9222:

```bash
node scripts/build/capture-web.mjs [names]   # labs/_assets/web-captures.json says what and how
node scripts/build/annotate.mjs              # draws the pills into labs/_assets/annotated/
```

---

## Things that will bite you

- **An org answers to several aliases.** `sf org list` reports only one. `connectedOrgs()` in
  `scripts/lib/util.mjs` reads `sf alias list` and keeps them all. Do not regress that.
- **Formatters versus generators.** Prettier collapses JSON arrays that `JSON.stringify` expands, and
  MegaLinter's table formatter realigns the tables `universe.mjs` writes. Both are excluded
  (`.prettierignore` in the extension, `FILTER_REGEX_EXCLUDE` in the training repo). Without those the
  drift check fails forever.
- **Seeded failures have to be measured, not assumed.** Two did not fire: `ApexDoc` is excluded from
  the sfdx-hardis PMD ruleset, and `AvoidHardcodedId` does not fire at the Moderate threshold. Before
  writing a lab around a rule, run it:
  `sf code-analyzer run --workspace . --severity-threshold Moderate --config-file ./code-analyzer.yml --rule-selector pmd:SfdxHardis --view table`
- **Salesforce screens move.** The Developer Edition signup no longer asks for an email and a username
  when the visitor is already signed in to a Salesforce account: it asks for a country and the
  agreement, and provisions the org on the account's own address. Any lab that describes a vendor
  screen has to be re-checked against the live page, not remembered.
- **Never edit a generated file.** `BACKLOG.md`, `labs/link-map.en.md`, `training-manifest.json`,
  `MY-PIPELINE.template.md`, `mkdocs-nav.yml`, `site-src/`, `labs/_assets/annotated/`, and the Helios
  fixtures in the extension repo. Change the source and re-run the generator.
- **A browser DOM check lies about images.** Below-the-fold images are lazy-loaded, so they read as
  broken. `scripts/verify/check-site.mjs` resolves references on disk instead.
- **commitlint crashes** on the original machine (`yargs_1.default.options is not a function`).
  Pre-existing and unrelated, and it does not stop the commit.

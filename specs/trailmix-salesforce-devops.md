# Spec: "Salesforce DevOps with sfdx-hardis" learning paths (Trailhead Trailmixes)

Status: draft for review
Owner: Cloudity / sfdx-hardis
Last updated: 2026-09-15

## 1. Objective

Ship three public, free learning paths:

| Path                               | Audience                                                         | Target duration | Prerequisite       | Ends when the learner can                                                                                |
|------------------------------------|------------------------------------------------------------------|-----------------|--------------------|----------------------------------------------------------------------------------------------------------|
| **Level 1 - Contributor basics**   | Admins and developers joining a team that already has a pipeline | 4 h 30          | none               | Take a User Story, build it, publish it, get a green Pull Request, merge it to `integration`             |
| **Level 2 - Contributor advanced** | The same contributors, once the easy stories are behind them     | 7 h             | Level 1            | Solve deployment errors, declare deployment actions, handle overwrites, resolve conflicts with teammates |
| **Level 3 - Release Manager**      | The person who owns the pipeline, the orgs and the releases      | 9 h 30          | **Levels 1 and 2** | Take over an org with no pipeline, review and merge, release to UAT and production, hotfix, monitor      |

Levels 1 and 2 are both the contributor path. Two different rules apply to Level 2, and they are not in conflict:

- **To be a contributor, Level 2 is recommended.** A learner may stop after Level 1. They will be able to deliver, and the first failed deployment will surprise them.
- **To start Level 3, Level 2 is required.** A release manager reviews other people's deployment errors, conflicts and deployment actions. Somebody who has never resolved one cannot review one. The Level 3 audit checks Levels 1 and 2 before it checks Level 3.

Durations exclude the Trailhead warm-up modules linked as steps, which add roughly an hour to Level 1 and are marked optional elsewhere.

### Hard constraints

1. **Nothing new is published on `sfdx-hardis.cloudity.com`.** The product doc site is referenced, never extended. The training has its own GitHub Pages site (section 12), built with the same toolchain.
2. **Zero cost for the learner and zero paid service for us.** Developer Edition orgs, GitHub free tier, Trailhead free account. Verification, badges and hosting are GitHub-native.
3. **No manual baseline building.** The learner never spends an hour creating objects by hand before the first real lab. Orgs are seeded by a source deployment plus a data import.
4. **No packaging.** The Helios app is deployed from the repository sources with the `sf` CLI. No unlocked package, no Dev Hub dependency, no package version to maintain.
5. **Badges, not certifications.** This course issues a Cloudity badge. It is not a certification, it is never called one, and no copy implies an exam or an accreditation. Certifications for clients and partners may come later and are out of scope here.
6. **Clicks, not code.** Every learner action is performed in the VS Code extension UI, the way the product documentation presents it. A copy-paste command is the fallback, never the default. Each lab then explains what happened under the hood, for the technical reader who wants it. See section 11.1.
7. **Real screenshots, matching the training's own data.** Every UI image comes from the extension's screenshot harness driven with Helios fixtures, never from an unrelated demo project. See section 13.
8. **Three repositories move together.** A change in sfdx-hardis or in vscode-sfdx-hardis that touches a lab must update the training in the same breath. See section 14.
9. Every lab maps to a real sfdx-hardis command and a real sfdx-hardis doc page.
10. **Each level starts from a known state.** A learner who skipped ahead, or who broke their repo in the previous level, resets with one command.
11. **GitHub only in v1.** GitLab, Azure DevOps and Bitbucket variants are deliberately out of scope, see section 19.
12. **English only in v1, with a structure that makes translation additive.** See section 16.

## 2. What a Trailmix can and cannot do

Verified mechanics, to be re-checked once during build since the Trailhead UI changes:

| Capability                                                             | Available        | Consequence for this spec                                                         |
|------------------------------------------------------------------------|------------------|-----------------------------------------------------------------------------------|
| Add existing Trailhead trails, modules, projects, superbadges as steps | Yes              | Used for the conceptual warm-up steps                                             |
| Add a **Link** step (any external URL)                                 | Yes              | The main mechanism: links to lab pages and doc pages                              |
| Add a **Task** step (free text, no URL)                                | Yes              | Used for "sign up for your orgs" style actions                                    |
| Mark a Link or Task as required for completion                         | Yes              | Set on every lab step, off for optional reading                                   |
| Reorder steps                                                          | Yes              | Order below is authoritative                                                      |
| Public shareable URL                                                   | Yes              | `https://trailhead.salesforce.com/users/nvuillamy/trailmixes/<slug>`              |
| Custom description and cover                                           | Yes              | See section 4                                                                     |
| Quizzes or hands-on challenges                                         | **No**           | Verification is a Pull Request audit, see section 15                              |
| Award a badge                                                          | **No**           | Cloudity issues its own, see section 15                                           |
| Gate a step behind another                                             | **No**           | Order is a suggestion, so each lab states its own preconditions and reset command |
| Nest a Trailmix inside a Trailmix                                      | **No (assumed)** | Each level references the next with a plain Link step                             |
| Author-side reporting on who completed what                            | **No**           | Completion data comes from the closed claim issues and the `badges/` directory    |
| Localize one Trailmix                                                  | **No**           | A translated course means a new Trailmix per language, see section 16             |

Authoring a real Trailhead badge is not an option: there is no self-serve program, and myTrailhead / Enablement Sites (Trailmaker Content) is retiring. A Trailmix is the only Trailhead-native surface open to us.

## 3. Accounts, naming and URLs

The Trailmix URL embeds the owning Trailhead account handle and the Trailmix slug, and neither can be changed later without breaking every link that has been shared.

| Item                        | Value                                                                                                               |
|-----------------------------|---------------------------------------------------------------------------------------------------------------------|
| Owning Trailhead account    | `nvuillamy` (profile: `https://www.salesforce.com/trailblazer/nvuillamy`)                                           |
| Level 1 Trailmix            | `Salesforce DevOps with sfdx-hardis - Contributor Basics`                                                           |
| Level 2 Trailmix            | `Salesforce DevOps with sfdx-hardis - Contributor Advanced`                                                         |
| Level 3 Trailmix            | `Salesforce DevOps with sfdx-hardis - Release Manager`                                                              |
| Expected Trailmix URL shape | `https://trailhead.salesforce.com/users/nvuillamy/trailmixes/salesforce-devops-with-sfdx-hardis-contributor-basics` |
| Training repo               | `hardisgroupcom/sfdx-hardis-training` (public)                                                                      |
| Training site               | `https://hardisgroupcom.github.io/sfdx-hardis-training/` (GitHub Pages, section 12)                                 |
| Lab URL shape               | `<site>/en/level-2-contributor-advanced/2-7-resolve-a-git-merge-conflict/`                                          |
| Badge URL shape             | `<site>/badges/<github-handle>/`                                                                                    |

Two cautions on the account:

- The Trailmixes will be personally owned. If the intent is that they outlive one person's account, create them from an account whose credentials are held by the team, or accept the risk explicitly.
- Confirm the exact slug Trailhead generates from each name at creation time and record it in `labs/link-map.en.md`. Trailhead derives the slug from the name; do not assume the transformation.

## 4. Trailmix descriptions (copy)

**Level 1 - Contributor basics**

> Deliver your first Salesforce change the way a real team does: a User Story per branch, an org to build in, a Pull Request that checks your work before anyone reviews it. You will work on a real repository for a fictional solar installer, with free Developer Edition orgs that come pre-loaded with the app and its data. No Git expertise required. At the end, your change is merged into the integration branch and deployed to the integration org.

**Level 2 - Contributor advanced**

> Your first stories went through. Now the ones that do not. A deployment that fails on a dependency you did not know about. A field that cannot be made required because the org already holds data. Reference records and a scheduled batch that must follow your change into every org. A teammate who edited the same Flow and the same Permission Set as you. This is the half of the contributor path that decides whether you enjoy working on a CI/CD project. Do Level 1 first.

**Level 3 - Release Manager**

> Own the pipeline. The project you have been contributing to stops at integration: no UAT, no production, no proper CI authentication, no monitoring. Finish it. Then review and merge what contributors send you, release to UAT and to production, ship a hotfix, retrofit a change an admin made by hand, produce release notes and DORA metrics, and put production under monitoring. Levels 1 and 2 are both required: the problems you will be reviewing are the ones Level 2 puts you through, and you cannot review a deployment error you have never solved.

All three descriptions end with the same sentence: *This course awards a Cloudity badge. It is not a certification.*

## 5. The scenario

A single fictional company runs through all three levels, so each level feels like a promotion rather than a restart.

**Helios Energy** installs residential solar panels. Sales is on Salesforce; the delivery teams track installations in a custom app.

| Element           | Detail                                                                                                                                        |
|-------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| Custom app        | `Helios Delivery`                                                                                                                             |
| Objects           | `Installation__c` (master), `Panel_Batch__c` (child), plus standard Account / Contact / Opportunity                                           |
| Automation        | Record-triggered Flow `Installation_Assign_Crew`, Validation Rule `Installation_Date_Not_Past`, Apex class `InstallationScheduler` with tests |
| UI                | LWC `installationTimeline`, Lightning page, 2 Permission Sets (`Helios_Delivery_Crew`, `Helios_Delivery_Manager`)                             |
| Data              | ~40 Accounts, ~60 Contacts, ~25 Opportunities, ~30 Installations, ~80 Panel Batches                                                           |
| Team in the story | 3 contributors, 1 release manager                                                                                                             |

The learner's seat changes with the level:

| Level | Who the learner is          | Story framing                                                     |
|-------|-----------------------------|-------------------------------------------------------------------|
| 1     | New joiner, week 1          | "Here is your repo, here is your org, here is your first ticket." |
| 2     | Same person, month 3        | "You are trusted with the messy ones now."                        |
| 3     | Promoted to release manager | "Sofia left. The pipeline is yours."                              |

Everything fictional lives in one file, `training-universe.json`: the repo owner and name, the branches, the User Stories with their ids, titles and authors, the teammate Pull Requests with their CI job states, the org aliases and the characters. The labs quote it, the audit asserts against it, and the screenshot fixtures are generated from it (section 13). `BACKLOG.md` is rendered from it rather than written by hand.

## 6. Assets to build

```
hardisgroupcom/sfdx-hardis-training
├── README.md                     entry point, org signup, bootstrap, level menu
├── BACKLOG.md                    generated from training-universe.json
├── training-universe.json        single source of truth for the fiction (section 5)
├── training-manifest.json        what each lab depends on, consumed by the other 2 repos (section 14)
├── TRANSLATION.md                how to add a language (section 16)
├── mkdocs.yml                    Zensical config for the training site (section 12)
├── labs/
│   ├── en/
│   │   ├── level-1-contributor-basics/     1-1 .. 1-7    Contributor basics
│   │   ├── level-2-contributor-advanced/   2-1 .. 2-9    Contributor advanced
│   │   └── level-3-release-manager/        3-1 .. 3-11   Release Manager
│   ├── _assets/
│   │   ├── vscode/               PNGs produced by the extension harness (section 13)
│   │   └── github/               PNGs of the GitHub web UI (section 13.5)
│   ├── _snippets/                command blocks included by labs, never translated
│   └── link-map.en.md            every URL used by the 3 Trailmixes, link-checked in CI
├── seed/                         the Helios app, source format, deployed with sf CLI
├── scripts/
│   ├── bootstrap.sh / .ps1       seed an org end to end (deploy sources + data)
│   ├── teardown.sh / .ps1        remove the Helios app and data from an org (destructiveChanges)
│   ├── reset-level.sh / .ps1     put repo + orgs back to the start state of a level
│   ├── data/HeliosBaseline/      SFDMU workspace for sf hardis:org:data:import
│   ├── data/HeliosCrewRefData/   SFDMU workspace used by a Level 2 deployment action
│   ├── drift/<alias>.*           per-org drift applied by bootstrap (section 17)
│   ├── simulate/                 patch sets that replay teammate work in the learner's fork
│   ├── build/universe.mjs        generates BACKLOG.md, the site nav, link-map, manifest
│   ├── build/mocks.mjs           generates the Helios screenshot fixtures (section 13)
│   ├── capture/github.mjs        Playwright capture of the GitHub web UI (section 13.5)
│   ├── training.mjs              single entry point behind the Training menu (section 11.1)
│   ├── verify/check.mjs          per-lab local check, prints the receipt line
│   ├── verify/audit.mjs          automated re-verification of a learner's public repo
│   ├── badges/render.mjs         generates the badge SVG and the badge page
│   └── i18n/check-translations.mjs
├── badges/
│   ├── <handle>.md                    the learner's badge page (generated)
│   ├── <handle>.json                  machine readable record (generated)
│   ├── img/<handle>-level-N.svg       badge image (generated)
│   └── _template.svg                  badge template
├── config/
│   ├── .sfdx-hardis.yml          majors: integration, uat, main, plus the Training customCommands
│   └── branches/                 per-branch config
├── .github/
│   ├── ISSUE_TEMPLATE/claim-level.yml   the badge claim form (section 15)
│   └── workflows/                CI/CD + claim.yml + pages.yml + link-check.yml + sync-check.yml
└── sfdx-project.json
```

The directory is `badges/`, not `certified/`. Following the naming correction: nothing here is a certification, so no path says it is.

Branches shipped in the repo. A solo learner needs teammates to exist, so the teammates are branches.

| Branch                               | Used by | Purpose                                                                                                                                          |
|--------------------------------------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| `main`                               | all     | production baseline, seeded app at v1.0                                                                                                          |
| `uat`, `integration`                 | all     | major branches                                                                                                                                   |
| `training/start-level-1`             | L1      | the state a Level 1 learner starts from                                                                                                          |
| `training/start-level-2`             | L2      | `integration` as it stands after Level 1, whether or not the learner did Level 1                                                                 |
| `training/start-level-3`             | L3      | the fork as it stands after Level 2: the app, the `integration` pipeline, no `uat`, no `main` pipeline, no JWT. A reset point, not a fresh start |
| `training/mate-us-018-crew-capacity` | L2, L3  | teammate work that conflicts with the learner's Level 2 branch on a Flow and a Permission Set                                                    |
| `training/mate-us-019-quote-pdf`     | L3      | a second teammate Pull Request, colliding with US-018 on the same Permission Set                                                                 |
| `training/mate-us-020-apex-refactor` | L3      | a third teammate Pull Request that fails the deployment check                                                                                    |

The teammate branches serve two distinct purposes, and both are needed:

1. **Upstream, they are real.** The teammate Pull Requests genuinely exist on the public training repo, with genuine sfdx-hardis CI comments, which is what makes the GitHub screenshots in 13.5 real artifacts rather than mockups.
2. **In the learner's fork, they are replayed.** A learner cannot review a Pull Request that lives in someone else's repository, and Level 3 rebuilds part of the branch topology, so a pre-existing branch would not even share a sensible ancestor. The **Training > Simulate my teammates** command recreates the branch and opens the Pull Request **inside the learner's own fork**, from their current `integration`, at the moment the lab needs it.

Both come from the same patch set in `scripts/simulate/`, so the teammate work a learner reviews is byte for byte the work shown in the screenshots.

`scripts/reset-level.sh <level>` checks out the matching `training/start-level-N` branch into the learner's fork, force-pushes their `integration`, and re-runs `bootstrap` on the orgs that level needs. Without it, one botched lab ends the course.

## 7. Orgs and pre-initialization

### 7.1 Which orgs, per level

| Needed from | Org                  | Role                                                   | How obtained             | Seeded with                                                                                                                                     |
|-------------|----------------------|--------------------------------------------------------|--------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| Level 1     | `helios-dev`         | the learner's own dev environment                      | Developer Edition signup | sources + full data                                                                                                                             |
| Level 1     | `helios-integration` | CI target for the Pull Request check and for the merge | Developer Edition signup | sources + full data                                                                                                                             |
| Level 2     | (reuses both above)  |                                                        |                          |                                                                                                                                                 |
| Level 3     | `helios-uat`         | second major org                                       | Developer Edition signup | sources + full data                                                                                                                             |
| Level 3     | `helios-prod`        | production stand-in                                    | Developer Edition signup | sources + full data, one version behind, one manual drift (section 17), and a short deployment history so the DORA report has something to plot |

Two orgs to start is deliberate. Asking a beginner to create four orgs before lab 1 is where a free course loses half its learners. Levels 1 and 2 need two; Level 3 asks for the other two at its own step 5.

Notes for the README:

- Developer Edition signup is free and unlimited in number, but each org needs a **distinct, reachable email address**, because signup is confirmed by email. Plus-addressing (`you+helios-uat@example.com`) is the recommended trick where the mail provider supports it. The org **username** is separate: it must be globally unique and email-shaped, but does not have to be a real address, so `you.helios.uat@heliostraining.invalid` is fine. Lab 0 states both, because confusing the two is the most common way a signup fails.
- DE orgs never expire but are deactivated after prolonged inactivity. Tell the learner to finish a level within a few weeks.
- A **Trailhead Playground** is an acceptable substitute for `helios-dev` and already carries sample data. It is not suitable for the major orgs because the learner does not control its lifecycle.
- DE orgs cannot create sandboxes, and this course never asks a learner to create a scratch org.

> Building the course uses the same kind of org the learner uses: **four Developer Edition orgs, provided up front** (19.1). Scratch orgs are deliberately not used, and not available: the Dev Hub allows three per day and CI jobs already consume them.

### 7.2 Seeding mechanism

Sources from the repository, deployed with the `sf` CLI. No package, no Dev Hub, nothing to publish or version.

What the learner does, with no command typed:

1. Sign up for the org in a browser, then connect it in the **Orgs Manager** panel.
2. **Welcome page > Training > Set up one of my training orgs**, and pick that org from the list.

What that runs, and what every lab shows in its under-the-hood block:

```bash
node scripts/training.mjs seed          # what the Training menu card runs
  -> ./scripts/bootstrap.sh helios-dev  # per org, once the alias is chosen
```

`bootstrap` does, in order:

1. `sf project deploy start --source-dir seed --target-org <alias> --wait 30`
2. `sf hardis:org:data:import --path scripts/data/HeliosBaseline --target-org <alias>` (SFDMU workspace, idempotent upsert on external ids)
3. Assign `Helios_Delivery_Manager` to the running user
4. Apply the per-org drift that some labs need (section 17), from `scripts/drift/<alias>.*`
5. Print a summary and the next lab to open

Design rules that make this survivable:

- **Idempotent.** Running `bootstrap` twice on the same org is a no-op, not a pile of duplicate records. External ids on every SFDMU object, `upsert` operations only.
- **Ordered for a cold org.** `seed/` deploys in one pass, so no metadata in it may depend on something deployed later. Verify on a brand new DE org, not on a developer's warm org.
- **Loud about failures.** If step 1 fails, print the deployment error and stop. Never leave a half-seeded org and a learner who thinks they are ready.
- **Never authenticates.** The org is already connected through Orgs Manager (11.1). `bootstrap` only ever targets an alias that exists, and says so plainly when it does not.
- **Sources stay modifiable.** Because this is a plain source deployment rather than a package install, the learner can edit and redeploy everything, which is what Levels 2 and 3 require anyway.

Expect step 1 to take 10 to 20 minutes on a Developer Edition org. Say so in Lab 0 rather than letting the learner think it hung.

## 8. Trailmix A - Level 1, Contributor basics

Goal: install, take a User Story, build it, publish it, merge it into `integration`. One gentle failure only, so the level stays a success story.

Legend: **TH** = existing Trailhead content, **L** = Link step, **T** = Task step. "Req" = marked required. Lab links point at the training site, `<site>` = `https://hardisgroupcom.github.io/sfdx-hardis-training`.

| #   | Type | Req | Title shown in Trailmix                                                   | Target                                                                                    |
|-----|------|-----|---------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| 1   | L    | no  | Why this path exists (3 min read)                                         | `<site>/en/level-1-contributor-basics/`                                                   |
| 2   | TH   | yes | Git and GitHub Basics for Effective Collaboration                         | `trailhead.salesforce.com/content/learn/modules/git-and-git-hub-basics`                   |
| 3   | TH   | no  | Org Development Model                                                     | `.../modules/org-development-model`                                                       |
| 4   | L    | no  | How Salesforce CI/CD works with sfdx-hardis                               | `sfdx-hardis.cloudity.com/salesforce-devops-home/`                                        |
| 5   | L    | yes | Contributor Guide overview                                                | `.../salesforce-devops-use-home/`                                                         |
| 6   | T    | yes | Create your two Developer Edition orgs, then connect them in Orgs Manager | text only                                                                                 |
| 7   | L    | yes | **Lab 1.1** - Install VS Code, Git and sfdx-hardis                        | `<site>/en/level-1-contributor-basics/1-1-install-vs-code-and-sfdx-hardis/`               |
| 8   | L    | no  | Reference: install the tools                                              | `.../salesforce-devops-use-install/`                                                      |
| 9   | L    | no  | Reference: the VS Code extension                                          | `.../vscode-extension/`                                                                   |
| 10  | L    | yes | **Lab 1.2** - Create your Dev Hub, scratch orgs and CI/CD pipeline        | `<site>/en/level-1-contributor-basics/1-2-create-your-dev-hub-scratch-orgs-and-pipeline/` |
| 11  | L    | no  | Reference: create a Git access token                                      | `.../salesforce-devops-git-tokens/`                                                       |
| 12  | L    | no  | Reference: clone the repository                                           | `.../salesforce-devops-clone-repository/`                                                 |
| 13  | L    | yes | **Lab 1.3** - Start a User Story on its own Git branch                    | `<site>/en/level-1-contributor-basics/1-3-start-a-user-story-on-a-git-branch/`            |
| 14  | L    | no  | Reference: start a User Story                                             | `.../salesforce-devops-create-new-user-story/`                                            |
| 15  | L    | yes | **Lab 1.4** - Build a custom field in your Salesforce org                 | `<site>/en/level-1-contributor-basics/1-4-build-a-custom-field-in-your-org/`              |
| 16  | L    | no  | Reference: work in your org                                               | `.../salesforce-devops-work-on-user-story/`                                               |
| 17  | L    | no  | Reference: configuration guidelines                                       | `.../salesforce-devops-work-on-user-story-configuration/`                                 |
| 18  | L    | yes | **Lab 1.5** - Retrieve, commit and publish your Salesforce changes        | `<site>/en/level-1-contributor-basics/1-5-retrieve-commit-and-publish-your-changes/`      |
| 19  | L    | no  | Reference: publish your User Story                                        | `.../salesforce-devops-publish-user-story/`                                               |
| 20  | L    | yes | **Lab 1.6** - Open a Pull Request, pass the deployment check, merge       | `<site>/en/level-1-contributor-basics/1-6-pull-request-deployment-check-and-merge/`       |
| 21  | L    | no  | Reference: create the Pull Request on GitHub                              | `.../salesforce-devops-pull-request-github/`                                              |
| 22  | L    | no  | Reference: check the Pull Request results                                 | `.../salesforce-devops-handle-merge-request-results/`                                     |
| 23  | L    | yes | **Lab 1.7** - Capstone: deliver a User Story on your own                  | `<site>/en/level-1-contributor-basics/1-7-capstone-deliver-a-user-story-on-your-own/`     |
| 24  | T    | yes | Claim your Contributor Basics badge                                       | text with the claim instructions                                                          |
| 25  | L    | no  | Recommended next: Level 2 - Contributor advanced                          | Level 2 Trailmix URL                                                                      |

### Level 1 labs

| Lab | Title                                         | Time   | What the learner actually does                                                                                                                                                                                                                                                                                                               |
|-----|-----------------------------------------------|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 0   | Install the tools and seed your orgs          | 30 min | Install VS Code and the extension by clicking, then let the **Setup** panel check and install the Salesforce CLI, sfdx-hardis and the rest. Authenticate both orgs from **Orgs Manager**, seed each with **Training > Set up one of my training orgs**, then open Helios Delivery and see real data. No command is typed                     |
| 1   | Fork the repository and connect your pipeline | 45 min | Fork, enable Actions on the fork, Git token, clone, then store one org credential as a repository secret so CI can deploy to `helios-integration`. The org itself was connected in Orgs Manager at Lab 0; only reading its auth URL is a typed command (8.2). Ends in the DevOps Pipeline panel, naming the branches and the org behind each |
| 2   | Take US-014 from the backlog                  | 20 min | Read the story ("crews need to see how many panels a job needs"), `sf hardis:work:new`, land on a fresh branch with `helios-dev` connected                                                                                                                                                                                                   |
| 3   | Build it in your org                          | 45 min | Add `Panels_Required__c` on `Installation__c`, put it on the layout and the LWC-backed page, grant it on `Helios_Delivery_Crew`, test it against the seeded records                                                                                                                                                                          |
| 4   | Publish it and read the package.xml diff      | 40 min | `sf hardis:work:save`, understand the selection screen, read the generated package.xml, see what automated cleaning removed and why                                                                                                                                                                                                          |
| 5   | Open the Pull Request, get it green, merge    | 45 min | Create the PR, read the sfdx-hardis comment, fix the one seeded quality warning, watch the deployment to `helios-integration`, verify the field is there                                                                                                                                                                                     |
| 6   | Capstone: deliver US-016 alone                | 40 min | Same loop, no step-by-step. Add a `Crew_Notes__c` field and a list view, merge it                                                                                                                                                                                                                                                            |

### 8.1 Everything happens inside the learner's own fork

This is load bearing and easy to get wrong, so every level README states it:

- The learner **forks** the training repo and works only there. Feature branch to `integration`, Pull Request and merge all happen inside their fork. Nothing is ever pushed or proposed to `hardisgroupcom/sfdx-hardis-training`, whose only inbound traffic is badge claim issues.
- Two reasons, both hard: a Pull Request from a fork cannot read the upstream repository's secrets, so CI could never reach an org; and a few hundred learners opening Pull Requests upstream would bury the repo.
- **GitHub disables Actions on a new fork** until the owner opens the Actions tab and confirms. Lab 1 makes that an explicit step with a screenshot, because a learner whose workflows silently never run will conclude the course is broken.

### 8.2 How Level 1 gets a working pipeline without teaching JWT

Lab 5 only means something if the Pull Request check really deploys to the learner's own `helios-integration` org. That needs a credential in their fork, and the proper way to produce one, an External Client App with a JWT certificate, is a 60 minute job that belongs to Level 3 lab 1.

Level 1 therefore uses the shortcut sfdx-hardis already supports: `SFDX_AUTH_URL_INTEGRATION`, set as a repository secret in the learner's fork, produced by one command they run locally.

```bash
sf org auth show-sfdx-auth-url --target-org helios-integration --no-prompt --json
# copy the sfdxAuthUrl value into the fork secret SFDX_AUTH_URL_INTEGRATION
```

sfdx-hardis recognizes `SFDX_AUTH_URL_<ALIAS>`, skips JWT and uses `sf org login sfdx-url`. One command, one secret, about ten minutes.

**This contradicts the product documentation on purpose, and the lab says so in a warning box.** `salesforce-devops-setup-auth` states plainly that an SFDX auth URL embeds a long lived OAuth refresh token, cannot be rotated without re-authenticating, and must not be used for major orgs. That guidance is right, and it is about real major orgs. Here the org is a throwaway Developer Edition the learner created ten minutes earlier, holding fictional solar installations, in a repository they own.

The lab must therefore do three things, not one:

1. Use the shortcut, so a beginner reaches a working pipeline in their first hour.
2. Say why it is acceptable here, in one sentence a learner can repeat.
3. Say, with a link, that a real project uses JWT, and that Level 3 lab 1 sets it up properly for all three orgs.

A learner who does all three levels ends up having done it both ways and knowing which is which, which is a better outcome than either shortcut alone. If the team prefers no shortcut at all, the alternative is a 60 minute JWT lab in position 1 of Level 1, and the drop-off that comes with it.

## 9. Trailmix B - Level 2, Contributor advanced

Goal: everything that goes wrong between "it works in my org" and "it is live in integration", plus the deployment actions that carry non-metadata work from org to org.

| #   | Type | Req | Title shown in Trailmix                                               | Target                                                                                                |
|-----|------|-----|-----------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| 1   | L    | yes | What changes at Level 2, and how to reset if you are joining here     | `<site>/en/level-2-contributor-advanced/`                                                             |
| 2   | L    | no  | Refresher: the contributor loop in one page                           | `.../salesforce-devops-use-home/`                                                                     |
| 3   | L    | yes | **Lab 2.1** - Backpromote: catch your org up with the team            | `<site>/en/level-2-contributor-advanced/2-1-backpromote-your-teammates-work/`                         |
| 4   | L    | no  | Reference: Backpromote                                                | `.../salesforce-devops-backpromote/`                                                                  |
| 5   | L    | yes | **Lab 2.2** - Fix a deployment error caused by a missing dependency   | `<site>/en/level-2-contributor-advanced/2-2-fix-a-missing-dependency-deployment-error/`               |
| 6   | L    | no  | Reference: solve deployment errors                                    | `.../salesforce-devops-solve-deployment-errors/`                                                      |
| 7   | L    | no  | Reference: source retrieve issues                                     | `.../salesforce-devops-retrieve/`                                                                     |
| 8   | L    | yes | **Lab 2.3** - Fix broken records with an Apex deployment action       | `<site>/en/level-2-contributor-advanced/2-3-fix-broken-records-with-an-apex-deployment-action/`       |
| 9   | L    | yes | Reference: deployment actions                                         | `.../salesforce-devops-work-on-user-story-deployment-actions/`                                        |
| 10  | L    | yes | **Lab 2.4** - Ship reference data and a batch with deployment actions | `<site>/en/level-2-contributor-advanced/2-4-ship-reference-data-and-a-batch-with-deployment-actions/` |
| 11  | L    | no  | Reference: data workspaces (SFDMU)                                    | `.../salesforce-devops-agent-data-workspaces/`                                                        |
| 12  | L    | yes | **Lab 2.5** - Pass the code quality gate and Apex test coverage       | `<site>/en/level-2-contributor-advanced/2-5-pass-code-quality-and-apex-test-coverage/`                |
| 13  | L    | no  | Reference: solve MegaLinter errors                                    | `.../salesforce-devops-solve-megalinter-errors/`                                                      |
| 14  | L    | no  | Reference: development guidelines                                     | `.../salesforce-devops-work-on-user-story-development/`                                               |
| 15  | L    | yes | **Lab 2.6** - Permission sets, profiles and why a grant disappears    | `<site>/en/level-2-contributor-advanced/2-6-permission-sets-profiles-and-overwrites/`                 |
| 16  | L    | no  | Reference: Profiles and Permission Sets                               | `.../salesforce-devops-work-on-user-story-profiles/`                                                  |
| 17  | L    | no  | Reference: overwrite management                                       | `.../salesforce-devops-config-overwrite/`                                                             |
| 18  | L    | yes | **Lab 2.7** - Resolve a Git merge conflict with a teammate            | `<site>/en/level-2-contributor-advanced/2-7-resolve-a-git-merge-conflict/`                            |
| 19  | L    | yes | **Lab 2.8** - Recover from committing the wrong metadata              | `<site>/en/level-2-contributor-advanced/2-8-recover-from-committing-the-wrong-metadata/`              |
| 20  | L    | no  | Reference: install packages in your org                               | `.../salesforce-devops-work-on-user-story-install-packages/`                                          |
| 21  | L    | yes | **Lab 2.9** - Capstone: deliver a User Story that has it all          | `<site>/en/level-2-contributor-advanced/2-9-capstone-deliver-a-user-story-that-has-it-all/`           |
| 22  | L    | no  | Going further: work with AI coding agents                             | `.../salesforce-devops-agent-skills/`                                                                 |
| 23  | T    | yes | Claim your Contributor badge                                          | text with the claim instructions                                                                      |
| 24  | L    | no  | Continue to Level 3 - Release Manager                                 | Level 3 Trailmix URL                                                                                  |

### Level 2 labs

| Lab | Title                                       | Time   | What the learner actually does                                                                                                                                                                                                                                       |
|-----|---------------------------------------------|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 0   | Your org is behind, catch it up             | 25 min | Three teammate stories merged into `integration` while you were away. Backpromote them into `helios-dev`, decide on the items that differ, understand what a backpromote never touches                                                                               |
| 1   | US-021 will not deploy                      | 50 min | The PR check fails with `Field does not exist` on a Flow element. Read the CI log, read the package.xml diff, find that the field is excluded, fix it, re-publish, green                                                                                             |
| 2   | US-024: the field cannot be required yet    | 60 min | Making `Crew_Size__c` required fails because 30 seeded Installations have it empty. Deliver in two moves: deploy nullable, declare a **post-deploy Apex script** action that backfills, then enforce. Watch the action replay itself on integration                  |
| 3   | US-026: data and a batch must follow        | 55 min | The new crew-capacity feature needs reference records and a nightly batch. Declare an **SFDMU data import** action and a **schedule Apex batch** action on the PR, plus a **manual step** for the setting nobody can automate. See the three of them tracked per org |
| 4   | US-027 fails the quality gate and the tests | 45 min | A hardcoded record type id trips PMD; the Apex change drops coverage below the threshold. Fix both, run the checks locally before pushing this time                                                                                                                  |
| 5   | US-033: your Profile change disappeared     | 40 min | The deployment is green but the permission is missing in integration. Discover overwrite management, move the permission to `Helios_Delivery_Crew`, understand why the Profile edit was dropped on purpose                                                           |
| 6   | Marco merged first: resolve the conflict    | 60 min | `training/mate-us-018-crew-capacity` landed in `integration` and touched the same Flow and the same Permission Set as your branch. Merge, resolve both conflicts (one XML, one Flow), re-save, re-validate                                                           |
| 7   | You committed the wrong things: recover     | 30 min | You selected half the org in the commit screen. Reset the selection, re-publish a clean diff, and learn the recovery path for uncommitted changes                                                                                                                    |
| 8   | Capstone: US-041                            | 60 min | One story with a dependency error, one deployment action and a conflict with a teammate branch, no step-by-step                                                                                                                                                      |

## 10. Trailmix C - Level 3, Release Manager

| #   | Type | Req | Title shown in Trailmix                                                       | Target                                                                               |
|-----|------|-----|-------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| 1   | L    | yes | Read this first: what changes at Level 3, and why Levels 1 and 2 are required | `<site>/en/level-3-release-manager/`                                                 |
| 2   | TH   | no  | Package Development Model                                                     | `.../modules/sfdx_dev_model`                                                         |
| 3   | TH   | no  | DevOps Center: Quick Look (for comparison)                                    | `.../modules/devops-center-quick-look`                                               |
| 4   | L    | yes | Release Manager Guide overview                                                | `.../salesforce-devops-release-home/`                                                |
| 5   | T    | yes | Create `helios-uat` and `helios-prod`, then connect them in Orgs Manager      | text only                                                                            |
| 6   | L    | yes | **Lab 3.1** - Configure the CI/CD pipeline up to production                   | `<site>/en/level-3-release-manager/3-1-configure-the-pipeline-up-to-production/`     |
| 7   | L    | no  | Reference: Setup Guide                                                        | `.../salesforce-devops-setup-home/`                                                  |
| 8   | L    | no  | Reference: initialize the SFDX project                                        | `.../salesforce-devops-setup-init-project/`                                          |
| 9   | L    | no  | Reference: retrieve an existing org                                           | `.../salesforce-devops-setup-existing-org/`                                          |
| 10  | L    | yes | **Lab 3.2** - Set up CI authentication with JWT for four orgs                 | `<site>/en/level-3-release-manager/3-2-ci-authentication-with-jwt/`                  |
| 11  | L    | no  | Reference: configure CI authentication                                        | `.../salesforce-devops-setup-auth/`                                                  |
| 12  | L    | no  | Reference: GitHub Actions authentication                                      | `.../salesforce-devops-setup-auth-github/`                                           |
| 13  | L    | yes | **Lab 3.3** - Review and merge a contributor Pull Request                     | `<site>/en/level-3-release-manager/3-3-review-a-contributor-pull-request/`           |
| 14  | L    | no  | Reference: review and merge Pull Requests                                     | `.../salesforce-devops-validate-merge-request/`                                      |
| 15  | L    | yes | **Lab 3.4** - Deploy to integration and read the deployment log               | `<site>/en/level-3-release-manager/3-4-deploy-to-integration-and-read-the-log/`      |
| 16  | L    | no  | Reference: deploy to major orgs                                               | `.../salesforce-devops-deploy-major-branches/`                                       |
| 17  | L    | no  | Reference: Smart Deploy internals                                             | `.../salesforce-devops-smart-deployment/`                                            |
| 18  | L    | yes | **Lab 3.5** - Three Pull Requests collide: choose the merge order             | `<site>/en/level-3-release-manager/3-5-merge-colliding-pull-requests/`               |
| 19  | L    | no  | Reference: automated cleaning                                                 | `.../salesforce-devops-config-cleaning/`                                             |
| 20  | L    | no  | Reference: delta deployments                                                  | `.../salesforce-devops-config-delta-deployment/`                                     |
| 21  | L    | yes | **Lab 3.6** - Promote to UAT and write the release notes                      | `<site>/en/level-3-release-manager/3-6-promote-to-uat-and-write-release-notes/`      |
| 22  | L    | no  | Reference: Release Notes                                                      | `.../hardis/doc/salesforce-devops-release-notes/`                                    |
| 23  | L    | yes | **Lab 3.7** - Release to production and read your DORA metrics                | `<site>/en/level-3-release-manager/3-7-release-to-production-and-read-dora-metrics/` |
| 24  | L    | no  | Reference: DORA Metrics                                                       | `.../hardis/doc/salesforce-devops-dora-report/`                                      |
| 25  | L    | yes | **Lab 3.8** - Production is broken: hotfix and retrofit                       | `<site>/en/level-3-release-manager/3-8-hotfix-and-retrofit/`                         |
| 26  | L    | no  | Reference: Hotfixes                                                           | `.../salesforce-devops-hotfixes/`                                                    |
| 27  | L    | no  | Reference: Retrofit                                                           | `.../salesforce-devops-retrofit/`                                                    |
| 28  | L    | yes | **Lab 3.9** - Monitor your production org                                     | `<site>/en/level-3-release-manager/3-9-monitor-your-production-org/`                 |
| 29  | L    | no  | Reference: Org Monitoring                                                     | `.../salesforce-monitoring-home/`                                                    |
| 30  | L    | no  | Reference: monitoring on GitHub                                               | `.../salesforce-monitoring-config-github/`                                           |
| 31  | L    | no  | Reference: Grafana dashboards                                                 | `.../salesforce-monitoring-grafana-v2/`                                              |
| 32  | L    | yes | **Lab 3.10** - Generate the Salesforce project documentation                  | `<site>/en/level-3-release-manager/3-10-generate-the-project-documentation/`         |
| 33  | L    | no  | Reference: generate documentation                                             | `.../salesforce-project-doc-generate/`                                               |
| 34  | L    | yes | **Lab 3.11** - Capstone: run a weekly release cycle                           | `<site>/en/level-3-release-manager/3-11-capstone-run-a-weekly-release-cycle/`        |
| 35  | L    | no  | Going further: promotion branches (Experimental)                              | `.../salesforce-devops-promotion-branches/`                                          |
| 36  | L    | no  | Going further: setup checklist for a real project                             | `.../salesforce-devops-setup-checklist/`                                             |
| 37  | T    | yes | Claim your Release Manager badge                                              | text with the claim instructions                                                     |

### Level 3 labs

| Lab | Title                                               | Time   | What the learner actually does                                                                                                                                                                                                                                                                                                                                                                                               |
|-----|-----------------------------------------------------|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 0   | Your pipeline stops at integration: finish it       | 60 min | Declare `uat` and `main` as major branches with their orgs in the config layers, create the branches, understand what `sf hardis:project:create` would have generated had the project started today                                                                                                                                                                                                                          |
| 1   | Wire CI authentication properly, for three orgs     | 60 min | The orgs are already connected in Orgs Manager; this lab is about the CI, not the workstation. `sf hardis:project:configure:auth` per org, run from the extension, External Client App, JWT key, `SFDX_CLIENT_ID_<ALIAS>` and `SFDX_CLIENT_KEY_<ALIAS>` as secrets, first green CI run on all three. Ends by **deleting the `SFDX_AUTH_URL_INTEGRATION` shortcut secret from Level 1** and explaining what was wrong with it |
| 2   | Review and merge a contributor Pull Request         | 45 min | Open the teammate PR, read the sfdx-hardis comment, catch the removed field the robot did not flag, ask for a change, merge                                                                                                                                                                                                                                                                                                  |
| 3   | Deploy to integration and read what happened        | 40 min | Watch the deployment job, read what Smart Deploy chose to send and what it skipped                                                                                                                                                                                                                                                                                                                                           |
| 4   | Three Pull Requests collide                         | 60 min | Two PRs on the same Permission Set, one that fails the check. Order them, resolve, re-validate, understand cleaning and delta                                                                                                                                                                                                                                                                                                |
| 5   | Promote integration to UAT, write the release notes | 50 min | The integration-to-UAT Pull Request, its read-only deployment actions list, the generated release notes                                                                                                                                                                                                                                                                                                                      |
| 6   | Ship to production and read your DORA metrics       | 50 min | The UAT-to-main Pull Request, the production deployment, then `sf hardis:doc:dora-report`. The report covers the releases the learner just made plus the deployment history seeded into `helios-prod` by `bootstrap`, so there is a curve to read rather than a single point                                                                                                                                                 |
| 7   | Production is broken: hotfix and retrofit           | 60 min | Fix `main` directly through a hotfix branch, then retrofit the picklist value an admin added by hand in production                                                                                                                                                                                                                                                                                                           |
| 8   | Put production under monitoring                     | 50 min | `sf hardis:org:configure:monitoring`, which creates a **second, separate repository** for monitoring, as a real project does. Its scheduled workflow, one notification channel, the first report, and deciding what is noise                                                                                                                                                                                                 |
| 9   | Generate the project documentation                  | 30 min | `sf hardis:doc:project2markdown`, the object and Flow pages, the history diagrams                                                                                                                                                                                                                                                                                                                                            |
| 10  | Capstone: one full weekly cycle                     | 75 min | Two incoming PRs, one integration deployment, one UAT promotion, one production release, release notes published                                                                                                                                                                                                                                                                                                             |

## 11. Lab authoring

### 11.1 Clicks, not code

The product documentation promises contributors that they do not need Git or CLI expertise, because the VS Code extension does the technical work. A training that contradicts that promise on page one teaches the wrong product. So every lab is written as **clicks in the extension**, and the command line appears only as an explanation.

Three tiers, in order of preference. The first two are both the extension UI:

| Tier                        | What it is                                                                                         | When                                                                             |
|-----------------------------|----------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------|
| **1. An LWC panel**         | The extension's own screens                                                                        | **Whenever one exists for the action. This is not a preference, it is the rule** |
| **2. The Training menu**    | Commands the training repo declares itself, rendered on the Welcome page and in the Commands panel | Only for what the training needs and the product does not own                    |
| **3. Copy-paste a command** | One clearly marked block, never a command the learner composes or edits                            | Last resort                                                                      |

**Tier 1 is checked first, every time.** Before a lab step is written as anything else, the author looks through the extension's LWC panels for one that already does it. The inventory, from `src/webviews/lwc-ui/modules/s`:

| Panel                                           | Covers                                                                                                                               |
|-------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `welcome`                                       | Entry point, and where the Training menu cards appear                                                                                |
| `setup`                                         | **Checking and installing the dependencies**: Salesforce CLI, sfdx-hardis, sfdmu, sfdx-git-delta, with an install button and a queue |
| `orgManager`                                    | Authenticating, selecting and opening orgs                                                                                           |
| `pipeline`, `pipelineConfig`                    | The DevOps Pipeline, branch and org topology, project configuration                                                                  |
| `deploymentAction`                              | Declaring and editing deployment actions on a Pull Request                                                                           |
| `backpromote`                                   | Bringing merged work back into a dev org                                                                                             |
| `packageXml`                                    | Reading and editing the manifest                                                                                                     |
| `metadataRetriever`                             | Retrieving metadata from an org                                                                                                      |
| `dataWorkbench`, `filesWorkbench`               | SFDMU data workspaces, file import and export                                                                                        |
| `monitoringConfig`, `orgMonitoring`             | Setting up monitoring and reading its results                                                                                        |
| `documentationConfig`, `documentationWorkbench` | Generating and publishing project documentation                                                                                      |
| `installedPackages`                             | Installed package list and installation                                                                                              |
| `apexTestsSelect`                               | Choosing which Apex tests run                                                                                                        |
| `anonymizationConfig`                           | Data anonymization rules                                                                                                             |
| `extensionConfig`                               | Extension settings                                                                                                                   |
| `commandExecution`, `promptInput`               | Running any sfdx-hardis command and answering its prompts                                                                            |

A lab that reaches for a terminal when one of these panels would do is a defect in the lab, not a shortcut. A lab that needs something none of them covers is a finding for the extension branch (23.2), and the panel gets built.

Two named rules, because they come up in almost every lab:

- **Authenticating to an org is always done in `orgManager`.** Never `sf org login web` in a lab, at any level, for any org. The learner signs up for the org in a browser, then connects it from the Orgs Manager panel, and selects or opens it from there afterwards. The same panel is how a lab tells a learner which org they are pointed at, which prevents the most common confusion in the whole course.
- **Installing anything is always done in `setup`.** The panel already checks versions, flags what is missing and installs on a click.

Tier 2 is the part worth getting right, and sfdx-hardis already supports it: `customCommands` in `config/.sfdx-hardis.yml` declares menus and commands that the extension renders as clickable cards and tree items. The training repo ships its own **Training** menu, so a learner clicks "Set up one of my training orgs" on the Welcome page rather than running a shell script.

```yaml
# config/.sfdx-hardis.yml in the training repo
customCommandsPosition: first
customCommands:
  - id: training
    label: Training
    description: Salesforce DevOps with sfdx-hardis - the commands for your labs
    vscodeIcon: mortar-board
    sldsIcon: utility:education
    commands:
      - id: training-status
        label: Where am I?
        vscodeIcon: compass
        sldsIcon: utility:location
        tooltip: Shows the level and lab you reached, and what to do next
        command: node scripts/training.mjs status
        helpUrl: https://hardisgroupcom.github.io/sfdx-hardis-training/
      - id: training-seed
        label: Set up one of my training orgs
        vscodeIcon: cloud-upload
        sldsIcon: utility:upload
        tooltip: Deploys the Helios Energy app and its sample data into the org you choose
        command: node scripts/training.mjs seed
        helpUrl: https://hardisgroupcom.github.io/sfdx-hardis-training/en/level-1-contributor-basics/1-1-install-vs-code-and-sfdx-hardis/
      - id: training-check
        label: Check my work
        vscodeIcon: pass
        sldsIcon: utility:check
        tooltip: Verifies the lab you just finished and prints your receipt
        command: node scripts/training.mjs check
      - id: training-simulate
        label: Simulate my teammates
        vscodeIcon: organization
        sldsIcon: utility:groups
        tooltip: Creates the teammate branches and Pull Requests your lab needs
        command: node scripts/training.mjs simulate
      - id: training-reset
        label: Reset this level
        vscodeIcon: debug-restart
        sldsIcon: utility:refresh
        tooltip: Puts your repository back to the start of a level
        command: node scripts/training.mjs reset
      - id: training-teardown
        label: Clean up a training org
        vscodeIcon: trash
        sldsIcon: utility:delete
        tooltip: Removes the Helios app and its data from an org
        command: node scripts/training.mjs teardown
```

Design rules for that menu:

- **One entry point, one verb each.** Every command is `node scripts/training.mjs <verb>`, so the menu stays short and the logic stays in one reviewable place.
- **The script prompts, the learner picks.** Org alias, level and lab are chosen from lists using the same prompt library as sfdx-hardis, never typed. The extension runs these in a terminal, so interactive prompts work.
- **`helpUrl` points at the lab.** Every command carries a link back to the page that explains it, which is free navigation the learner did not have to look for.
- **"Where am I?" earns its place.** A learner returning after a week clicks one thing and is told which lab they reached and what comes next. That is the single cheapest way to stop people abandoning a multi-session course.

That leaves tier 3 almost empty. Lab 0 no longer contains a single typed command: the learner installs VS Code and the extension by clicking, opens the **Setup** panel, and lets it check and install the Salesforce CLI, sfdx-hardis and the other dependencies, which is exactly what that panel is for. The only tier 3 block left in the whole course is reading one auth URL in Level 1 lab 1 (8.2), and even that is a candidate for the extension branch rather than a permanent exception.

Writing this training is the first time anyone walks the whole product as a beginner. Expect the list of missing panels to be non-empty, and treat each one as work, not as a reason to open a terminal.

### 11.2 Under the hood, every time

Clicks alone leave a technical learner unsatisfied and unable to debug. Every lab therefore closes each significant step with a collapsible block, using the same `<details>` convention as the product documentation:

```markdown
<details markdown="1"><summary>Under the hood: what those clicks just did</summary>

The panel ran:

    sf hardis:work:save

which staged your changes, generated `manifest/package.xml` from the diff with
`integration`, applied the cleaning rules from `config/.sfdx-hardis.yml`, and
committed the result on your User Story branch.

</details>
```

Rules for those blocks: name the exact command and flags, name the files written or read, and explain the one decision the tool made that the learner could not see. They are the reason a developer finishes this training with a mental model instead of a muscle memory, and they are also where the `depends_on` front matter comes from.

### 11.3 The lab file template

Every lab file carries front matter, so translation status, screenshot inventories and the dependency manifest can be computed rather than tracked by hand.

```markdown
---
id: l2-lab-06-conflicts
level: 2
lab: 6
lang: en
source_rev: ""              # for translations: git SHA of the English file translated from
screenshots:                # section 13, resolved from labs/_assets
  - vscode/pipeline-my-pull-request
  - github/pr-conflict-banner
depends_on:                 # section 14, feeds training-manifest.json
  commands: [hardis:work:save, hardis:work:refresh]
  flags: []
  config: [overwriteMode]
  docs: [salesforce-devops-work-on-user-story-profiles]
---

# Lab 6 - Marco merged first: resolve the conflict

**Level**: 2 Contributor advanced
**Time**: ~60 min
**You will**: one sentence, in the learner's words

## The situation
2 to 4 sentences of story. Who asked for what, and why it matters at Helios.

## Before you start
- [ ] checklist of preconditions, each one a panel the learner can open and read
- [ ] how to reset, for a learner arriving here directly: Training > Reset this level

## Steps
Numbered clicks, each with its annotated screenshot. The pill numbers on the
image are the step numbers. Any command block is tier 3 (11.1) and marked as
such. Every few steps, an "Under the hood" details block (11.2).

## What you should see
Expected panel state or Pull Request comment, as a screenshot. This is what
makes a lab self-correcting.

## If it goes wrong
The two or three failures we know happen, and the fix.

## Check your work
Welcome page > **Training** > **Check my work**, then pick level 2 and lab 6.
It prints the receipt line to keep for your badge claim.

## Go deeper
Links to the sfdx-hardis doc pages for this topic.
```

The lab tables in sections 8, 9 and 10 name commands because they are written for the people building this course. The labs themselves name buttons.

## 12. The training site (GitHub Pages + Zensical)

Same toolchain as the product doc site, so nobody learns a new tool: `mkdocs.yml`, `zensical build`, `ghp-import` to `gh-pages`. Copy `.github/workflows/build-deploy-docs.yml` from sfdx-hardis and strip the parts that generate command documentation.

```yaml
# .github/workflows/pages.yml (shape, not final)
on:
  push:
    branches: [main]
permissions:
  contents: write
  pages: write
steps:
  - uses: actions/checkout@...
  - uses: actions/setup-python@...
  - run: pip install zensical mdx_truly_sane_lists ghp-import
  - run: zensical build
  - run: ghp-import --no-jekyll --push --force --message "Deployed ${GITHUB_SHA} with Zensical" site
```

| Decision                        | Detail                                                                                                                                                                                      |
|---------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| What the site publishes         | The labs, the backlog, and the badge pages. It is the thing Trailmix Link steps point at                                                                                                    |
| Why the labs move here too      | GitHub blob rendering has no navigation, no search, and an ugly URL. The Trailmix is a table of contents pointing at 30-some URLs, and those URLs are the product                           |
| Source of truth                 | Still plain markdown in `labs/<locale>/`. If Pages is ever dropped, the content is intact and only the link map changes                                                                     |
| URL shape                       | `<site>/en/level-2-contributor-advanced/2-7-resolve-a-git-merge-conflict/`, `<site>/badges/<handle>/`                                                                                       |
| Locale in the path from day one | `/en/...` so `/fr/...` is purely additive, see section 16                                                                                                                                   |
| Theme                           | Material via Zensical, Cloudity colors, matching the product doc site so the two feel related                                                                                               |
| Custom domain                   | Optional and later. A CNAME such as `training.sfdx-hardis.cloudity.com` is a separate site from the product doc, so it respects constraint 1. Not needed for v1                             |
| Repository setting              | Pages source must be **Deploy from a branch: `gh-pages`**. `ghp-import` pushes that branch; a repo configured for the "GitHub Actions" Pages source would publish nothing and give no error |
| Hard rule                       | The Pages build is never a gate for badge issuance. A badge exists as committed markdown, JSON and SVG the moment the claim workflow commits it; the site only renders it                   |

Nav in `mkdocs.yml`, `labs/link-map.en.md` and `BACKLOG.md` are all generated by `scripts/build/universe.mjs` from the step tables in this spec plus `training-universe.json`, so the artifacts cannot drift.

## 13. Screenshots

The requirement is not "add screenshots". It is that a learner reading Lab 6 sees a VS Code window showing **Helios Energy, US-018, the branches in their own repo**, not an unrelated demo project. A mismatched screenshot is worse than none: it teaches the learner that the picture is decoration.

### 13.1 Reuse the extension's existing harness

vscode-sfdx-hardis already has exactly the machine needed. Verified shape:

| Piece             | Where                                                                                                                                                                                                                       |
|-------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Entry point       | `yarn screenshots [names]` -> `scripts/take-doc-screenshots.js`                                                                                                                                                             |
| What it drives    | A real Extension Development Host with a mocked `sf` CLI, opening each LWC panel with fixture data and saving a PNG                                                                                                         |
| The UI test       | `src/test/ui/docScreenshots.test.ts`, named captures (`devops-pipeline`, `pipeline-pr-actions-list`, `pipeline-edit-action-apex`, `pipeline-edit-action-data`, `pipeline-edit-action-schedule-batch`, `backpromote-*`, ...) |
| Workspace fixture | `test/fixtures/doc-screenshots-project/` (the MyCompany-CRM universe)                                                                                                                                                       |
| Provider data     | `test/fixtures/screenshot/git-provider-mock.json`, `git-provider-mock-promotion.json`, `ticket-provider-mock.json`                                                                                                          |
| Mocked CLI        | `test/fixtures/sf-shim/`                                                                                                                                                                                                    |
| Window capture    | PowerShell helpers `capture-window.ps1`, `click-window.ps1`, `record-window.ps1`, `window-common.ps1`                                                                                                                       |
| Output            | `doc-screenshots/`, overridable with `SFDX_HARDIS_DOC_SCREENSHOTS_DIR`; variants such as `dark/` and `SF_MOCK_DEPS_STATE=missing`                                                                                           |
| Prerequisites     | `yarn dev` then `yarn compile`, on Windows                                                                                                                                                                                  |

Two pieces of luck worth noting: the deployment action editors that Level 2 labs 2 and 3 are built around already have named captures, and `record-window.ps1` means short videos are possible later without new tooling.

### 13.2 Add a Helios universe next to the existing one

**Hard rule: the existing mock data is never replaced, edited or repointed.** The MyCompany-CRM fixtures, `git-provider-mock.json`, `git-provider-mock-promotion.json`, `ticket-provider-mock.json` and `doc-screenshots-project/` keep producing the product documentation screenshots exactly as they do today. The training gets its own fixture set, added alongside. Everything below is additive; a change that touches an existing fixture file is out of scope by definition.

| Addition (in vscode-sfdx-hardis)                                                                                          | Purpose                                                                                                                                                        |
|---------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `test/fixtures/training-project/`                                                                                         | The Helios SFDX workspace, a new fixture project. The existing `doc-screenshots-project/` is untouched                                                         |
| `test/fixtures/screenshot/helios/git-provider-mock.json`, `git-provider-mock-promotion.json`, `ticket-provider-mock.json` | New files in a new subfolder, generated from `training-universe.json`, never written by hand. The existing files at the parent level stay where they are       |
| `SF_MOCK_UNIVERSE`                                                                                                        | New environment variable selecting the fixture set. **Unset means the current behavior**, byte for byte: no existing command, script or CI job changes meaning |
| Capture list                                                                                                              | The training's screenshot names. Where a capture is useful to both, it is run twice with different universes into different output folders, never shared       |

Enforcement, so this does not erode over time:

- The Helios work lands in one Pull Request whose diff contains **no modification to an existing fixture file**. A reviewer can check that in one glance at the file list.
- A regression check re-runs the product documentation capture with `SF_MOCK_UNIVERSE` unset and compares against the committed `doc-screenshots/`. If the product images move, the training work broke something.
- The two output folders are disjoint: product screenshots keep going to `doc-screenshots/`, training screenshots go to the training repo through `SFDX_HARDIS_DOC_SCREENSHOTS_DIR`. Neither run can overwrite the other's images.

Run, from the extension repo:

```bash
yarn dev && yarn compile
SF_MOCK_UNIVERSE=helios \
SFDX_HARDIS_DOC_SCREENSHOTS_DIR=../sfdx-hardis-training/labs/_assets/vscode \
yarn screenshots
```

The output lands directly in the training repo working copy, and is committed there by a training Pull Request.

Two operational facts to plan around: this capture **runs locally on Windows**, not in CI, because it drives a real VS Code window through PowerShell helpers, and it needs the sibling training clone present. During development the capture can point at the training branch rather than `main`, since `main` will not carry `seed/` until the first training Pull Request lands.

### 13.3 One source of truth for the fiction

`training-universe.json` in the training repo feeds, through `scripts/build/mocks.mjs` and `scripts/build/universe.mjs`:

- the Helios provider mocks consumed by the screenshot harness,
- `BACKLOG.md` and the lab text variables,
- the branch and Pull Request set created on the real public training repo,
- the assertions in `audit.mjs`.

CI fails if a lab mentions a User Story id, branch or character the universe does not define. Without this single file, the screenshots and the lab text drift apart within two sprints, which is precisely the failure this requirement exists to prevent.

### 13.4 Screenshot inventory

Each lab declares the images it needs in front matter (`screenshots:`). `scripts/build/universe.mjs` produces the union, which is the argument list for `yarn screenshots`. CI fails on a lab referencing an image that does not exist, and reports images no lab uses.

### 13.5 GitHub web UI screenshots are not covered by the harness

The harness captures VS Code windows. The repository view, the Pull Request page, the sfdx-hardis PR comment and the Actions log are GitHub web UI, and the labs need all four.

Recommendation: `scripts/capture/github.mjs`, a Playwright script run by a maintainer against the **real public training repo**, where the teammate Pull Requests and their sfdx-hardis comments genuinely exist after the dry runs. Those screenshots are then real artifacts rather than mockups, and the whole set can be re-shot in one command when GitHub changes its UI. Output to `labs/_assets/github/`.

Constraints: Playwright needs a logged-in session, so use a dedicated bot account with read access and run it locally or in a manually triggered workflow, never with a personal token on every push. Crop to the region that matters, and keep the viewport size fixed so images stay consistent across re-shoots.

### 13.6 Numbered pills, the Trailhead way

A raw window capture does not tell a learner where to look. Every screenshot that illustrates more than one thing carries **numbered discs** matching a numbered list in the lab text, the way Trailhead annotates its own images.

The tooling already exists in vscode-sfdx-hardis: `scripts/build-doc-images.py` turns raw captures into documentation images, and it already has `badge(draw, center, text)`, described in its own source as "draws a numbered red disc, used to order the steps of a screenshot", plus `arrow()`, `crop_row()` and `crop_to_webview()`. It writes into the sibling `../sfdx-hardis/docs/assets/images` today.

The training reuses it exactly as the screenshots are reused, and under the same additive rule as 13.2:

| Item                       | Detail                                                                                                                                                          |
|----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| What is added              | A training recipe set and a `--training` target writing to `../sfdx-hardis-training/labs/_assets/vscode`, alongside the existing default target                 |
| What is not touched        | Every existing recipe, and the default output path. Running the script with no new flag produces the product doc images exactly as today                        |
| Where the annotations live | A declarative recipe per image (source capture, crops, pill positions, pill labels), so a re-shoot re-applies the annotations instead of someone redrawing them |
| Consistency with the text  | The lab's numbered list and the pill numbers are the same list. CI fails when an image declares 4 pills and the lab step list has 3 items                       |
| Colors                     | The red disc the script already draws, unchanged, so the training and the product doc look like one family                                                      |

No screen recordings in v1. Numbered pills on stills carry the same information, survive a re-shoot, and cost a fraction of the effort.

### 13.7 Rules for every image

Light theme, English, fixed window size, same VS Code version across a batch. No personal data, no real org id, no real username outside the Helios cast. Dark variants only if the training site offers a dark theme. Re-shoot a whole batch rather than patching one image, so a lab never mixes two UI versions.

## 14. Keeping the training in sync (repo skills)

Three repositories now move together: sfdx-hardis, vscode-sfdx-hardis, sfdx-hardis-training. The existing rule that every change states its VS Code extension impact gets a sibling: **every change states its training impact, even when it is "none"**.

### 14.1 All the skills live in sfdx-hardis

The training skills are **in this repository only**, under `.claude/skills/`. The training repository carries content, fixtures and workflows, no skills. The extension repository carries the screenshot harness, no skills either. One place to write them, one place to fix them.

| Skill             | When it loads                                                                                                                                                                                 | What it does                                                                                                                                                |
|-------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `training-impact` | Any change here or in the extension that touches a command name or flag, a prompt, `--json` output, a config key, a report file, a doc page URL, a panel, or any behavior a lab walks through | Reads `training-manifest.json` from the sibling training repo, names the affected labs, and decides whether the change needs a training Pull Request        |
| `training-update` | Once `training-impact` says there is an impact, or when a lab has to change for its own reasons                                                                                               | Performs the edits in the sibling training repo: lab text, `training-universe.json`, audit rules, link map, and the screenshot regeneration described below |

Both skills follow the same rule as the existing `vscode-sfdx-hardis` skill: they document the other repository's conventions rather than importing them.

### 14.2 The sibling repository convention

`sfdx-hardis-training` is always a sibling of this repository, exactly like `vscode-sfdx-hardis` already is:

```
C:/git/
├── sfdx-hardis/              <- the skills live here
├── sfdx-hardis-training/     <- sibling, cloned if absent
└── vscode-sfdx-hardis/       <- sibling, the screenshot harness
```

The skills resolve `../sfdx-hardis-training` from the repository root, and **clone it there if it is missing** (`git clone https://github.com/hardisgroupcom/sfdx-hardis-training.git`) rather than failing or working from a temporary directory. Same for `../vscode-sfdx-hardis` when screenshots have to be regenerated. Neither path is ever configurable: a fixed layout is what makes the skills able to act without asking.

### 14.3 The manifest makes it checkable

`training-manifest.json` is generated from the labs' `depends_on` front matter and committed in the training repo. Per lab: the commands, flags, config keys, doc page URLs and screenshot names it relies on. `training-impact` reads it from the sibling clone, so it works offline and against the exact checked-out state. This turns "remember the training" from a habit into a check.

Wiring in this repository:

| Item      | Detail                                                                                                                                                         |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| CLAUDE.md | A Training section next to the VS Code Extension one, with the same rule: the analysis and the design always state the training impact, even when it is "none" |
| Agents    | `analyze` and `design` gain a "Training impact" output item, the way they already have a "VS Code extension impact" item                                       |
| Check     | `scripts/check-training-impact.mjs` diffs the change against the sibling manifest and names the affected labs, run where the JSON schema check already runs    |

### 14.4 Screenshots are driven from here too

A panel redesign in the extension invalidates training screenshots. `training-update` owns that as well: it runs the Helios capture in the sibling extension repo (`SF_MOCK_UNIVERSE=helios`, output into the sibling training repo) and opens the training Pull Request with the new PNGs. The extension repository gains no skill of its own for this.

The gap to accept: someone working inside `vscode-sfdx-hardis`, with that repo's own agents, will not have `training-impact` loaded. Mitigation is a single pointer line in the extension's CLAUDE.md, saying that a panel or WebSocket change has a training impact and naming the skill to load from the sibling sfdx-hardis clone. A pointer, not a copy, so there is still exactly one definition.

### 14.5 Process

One Pull Request per repository, cross-linked, exactly like the current CLI and extension rule. Order: CLI first, then the extension, then the training. A change that invalidates a lab is not finished until the training Pull Request is open, and the training Pull Request states which labs it re-verified.

Labs are versioned against a pinned sfdx-hardis version (`bootstrap` pins it), so a breaking change does not silently break learners mid-course. The training Pull Request bumps the pin and updates the labs together.

### 14.6 Backstop for what the skills miss

A monthly scheduled workflow in the training repo (`sync-check.yml`): run the link checker, seed a throwaway DE org from scratch, and diff `training-manifest.json` against the current sfdx-hardis command list. Skills catch what people remember to route through them; this catches the rest.

## 15. Verification and badges (in v1)

Free, GitHub-native, no third party service, no account beyond the GitHub one the learner already needs.

### 15.1 Three moving parts

**1. Local check, per lab.** Each lab ends with `node scripts/verify/check.mjs --level N --lab M`. The script asserts the real state (branch exists, field present in the source, action YAML declared, conflict merge commit present, tests green) and prints a receipt:

```
LAB 2-06 OK  handle=jdupont  commit=7f3a91c  2026-09-15T14:22Z
```

The learner keeps the receipts. They are a progress record and a copy-paste payload, not a secret.

**2. Claim, as a GitHub issue.** The learner opens an issue in the training repo from `.github/ISSUE_TEMPLATE/claim-level.yml`. Four fields:

| Field                 | Purpose                                                                                                                                                                                                                      |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Level                 | 1, 2 or 3                                                                                                                                                                                                                    |
| Trailblazer username  | Their Trailhead handle, shown on the badge page and used for the optional profile check in 15.3                                                                                                                              |
| Public repository URL | Where they did the training. Must be public and readable without authentication. The audit checks its content, not whether GitHub records it as a fork, so a repository created from a template or a manual copy is accepted |
| Receipts              | Pasted from the lab checks. Human-readable progress, not the proof                                                                                                                                                           |

Nothing to fork-and-commit, nothing to rebase, no merge conflict between two learners claiming the same day.

**3. Fully automated audit.** `claim.yml` runs in the training repo on issue creation and on any edit of the issue body:

1. Parse the issue form, validate it against a schema, reject early with a comment if the repository URL is unreachable, private, or does not look like a training repository.
2. `git clone --filter=blob:none` the learner's public repository into a temporary directory, read only.
3. Run `scripts/verify/audit.mjs --level N` **from the training repo**, re-asserting every lab against the clone's actual history and content, ignoring the pasted receipts entirely. A level claim also re-runs the audits of the levels it requires, so a Level 3 claim asserts Levels 1, 2 and 3. That is how the Level 2 prerequisite is enforced, since a Trailmix cannot gate anything.
4. On pass: write `badges/<handle>.md`, `badges/<handle>.json` and `badges/img/<handle>-level-N.svg` on `main`, comment on the issue with the badge URL, close it.
5. On fail: comment with the exact labs that did not verify and what was missing, label `needs-work`, leave the issue open. A learner who fixes their repo edits the issue, or closes and reopens it, and the audit runs again.

**No human is in the loop.** The job is the reviewer. That is the answer to what used to be an open question in this spec: nobody owns a claim queue, because there is no queue. What people do need to own is `audit.mjs` failure messages being good enough that a learner can act on them without asking anyone.

The receipts are the learner's UX. The audit of their public repository is the actual gate. That ordering matters: a code a learner can read out of a script in their own clone can never be the proof.

### 15.2 Security rules for the claim workflow

The issue flow avoids the `pull_request_target` hazard entirely: the workflow runs on `issues`, in the base repository, with base permissions, and the learner's code is never checked out into the workspace. It clones a stranger's repository into a temporary directory and reads it.

Non-negotiable rules for `claim.yml`:

- **Never execute anything from the clone.** No `npm install`, no `npm run`, no running their scripts, no building their code. The audit only reads files and git history, using code from the training repo.
- **Never expose a Salesforce secret to this workflow.** It has no business touching an org. Its permissions are `contents: write` and `issues: write`, nothing more.
- Treat every issue field as untrusted input: validate against a schema, never interpolate into a shell command, and bound the clone (depth, blob filter, size and timeout) so a hostile repository cannot exhaust the runner.
- Pin every action by SHA, as the sfdx-hardis workflows already do.
- Rate limit per issue author, so a loop of edits cannot re-trigger the audit indefinitely.
- Set a `concurrency` group on the workflow. Two claims landing at the same time both commit to `main`, and without serialization the second push is rejected. Serialize, and retry the commit on top of the new head rather than failing the learner's claim.

### 15.3 Can the Trailmix completion be checked automatically?

Short answer: no, and for a structural reason worth writing down.

- **A Trailmix awards nothing.** It tracks clicks for the learner and shows no completion on the public profile. There is no badge, no credential, nothing queryable that says "this person finished this Trailmix". Trail Tracker reports Trailmix progress, but only inside an org for users linked to it, which does not apply to anonymous public learners.
- **There is no official public profile API.** An unofficial GraphQL endpoint (`profile.api.trailhead.com/graphql`) is used by community tools to read a public profile's earned awards by slug. It is unsupported, blocked from browsers by CORS, and can change without notice.

What is therefore worth doing, and what is not:

| Idea                                                                               | Verdict                                                                                                                                                                                                            |
|------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Gate the badge on Trailmix completion                                              | Impossible. Nothing to query                                                                                                                                                                                       |
| Gate the badge on the prerequisite Trailhead module badges (Git and GitHub Basics) | Possible through the unofficial endpoint, but **never blocking**: if the profile is private or the endpoint changes, the audit must pass anyway. Implement it as a nice-to-have line on the badge page, or skip it |
| Show the learner's Trailblazer profile link on their badge page                    | Yes, from the claim form field. Zero infrastructure, and it is what a reader actually wants to click                                                                                                               |

The repository audit stays the only gate. It is the one signal that is both automatable and meaningful, because it inspects the work rather than the clicking.

### 15.4 What is verified, and what is not

Verified: the source the learner produced, in their public repository. Field and layout XML, the deployment action YAML under `scripts/actions/`, the Apex fix, the branch and Pull Request history.

Assertions are written against **outcomes, not procedures**. The conflict lab is proved by both sides of the conflict being present and correct in `integration`, not by finding a merge commit with two parents: a learner who rebased, squashed or resolved through the GitHub UI did the work and must pass. Every rule in `audit.mjs` gets that treatment, because a false negative here is a learner told they failed something they actually did.

Not verified: the state of the learner's orgs. We are not asking anyone for org credentials, and we are not running an exam. Say so plainly in the level README. Someone determined to fake a free training badge will manage it, and nothing of value is lost.

### 15.5 The badges

| Badge   | Awarded for                       | Name                                 |
|---------|-----------------------------------|--------------------------------------|
| Level 1 | Level 1 audit passes              | **sfdx-hardis Contributor Basics**   |
| Level 2 | Levels 1 and 2 audits pass        | **sfdx-hardis Contributor Advanced** |
| Level 3 | Levels 1, 2 and 3 audits all pass | **sfdx-hardis Release Manager**      |

Three separate badges, each shown on the learner's badge page with its date. Each name says what the holder can do, which is what makes it worth putting on a profile.

Implementation, all free:

- **The badge image**: an SVG rendered by `scripts/badges/render.mjs` from `badges/_template.svg`, Cloudity colors, badge name, handle, date. Committed to the repo, no image service.
- **The badge page**: `badges/<handle>.md`, published at `<site>/badges/<handle>/`, showing the badges earned with dates, the Trailblazer profile link the learner declared, the link to the claim issue, and the audit result. This is the URL the learner shares.
- **The machine readable record**: `badges/<handle>.json`, in an Open Badges shaped structure (issuer, recipient, achievement, issuedOn, evidence), unsigned in v1. If Cloudity later issues real certifications to clients and partners, that is a different scheme with different rules; this shape does not block it and these URLs do not have to move.
- **Sharing**: the level README tells learners to share the badge page URL, and to add it on LinkedIn under *Featured* or as a course, **not** under *Licenses & certifications*. It is a badge. The copy says so everywhere, including on the badge page itself.

Revocation, if ever needed, is a commit. Two consequences to accept up front: `badges/` grows in the repo forever, and learner GitHub handles become public in it. State that in the claim instructions.

### 15.6 Operating cost

GitHub Actions minutes on a public repo are free and ample for this. There is no human queue: the audit job decides, comments and closes on its own.

What that shifts, rather than removes, is where the care goes. `audit.mjs` failure messages are the only support channel a learner has, so each one names the lab, the artifact it looked for, and where it looked. A message like "lab 2-03 did not verify: no deployment action of type `dataImport` found in `scripts/actions/.sfdx-hardis.*.yml` on branch `integration`" is the difference between a learner fixing it in two minutes and a learner giving up. Write those messages with the same attention as the labs.

The one human duty left is periodic: read the `needs-work` issues that stay open for weeks. They are the course's bug reports, and each one usually means a lab is unclear rather than a learner is careless.

## 16. Translation architecture (English only in v1)

No translated content ships in v1. The structure below costs almost nothing now and makes a later translation additive rather than a rewrite.

| Decision                                      | Detail                                                                                                                                                                                                            |
|-----------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Locale in the path                            | `labs/en/level-N/...` and `/en/...` on the site from day one. A translation is `labs/fr/level-N/...`, same file names, nothing renamed                                                                            |
| Nothing translatable outside `labs/<locale>/` | Screenshots in `labs/_assets/`, command blocks in `labs/_snippets/`, both included by reference so a translator never edits a command and never re-shoots a screenshot                                            |
| Staleness is computable                       | Front matter `source_rev` holds the SHA of the English file a translation was made from. `scripts/i18n/check-translations.mjs` lists translations behind their source, and runs in CI                             |
| One link map per locale                       | `labs/link-map.<locale>.md`, generated from the step tables in this spec, same generator as the site nav                                                                                                          |
| Never translated                              | Org aliases, branch names, API names, User Story ids, command lines, `Helios Energy` and the character names, and the technical and brand terms already listed in the sfdx-hardis translation rules               |
| Trailmixes                                    | A Trailmix cannot be localized. Each language is a new Trailmix built from the same step table with `/<locale>/` targets. Budget one per language per level                                                       |
| Badge pages                                   | Locale independent. One page per learner, whatever language they learned in                                                                                                                                       |
| Screenshots                                   | Shared across locales in v1, English UI. If a locale ever wants its own, the harness already supports it: run the Helios capture with the extension in that language and write to `labs/_assets/vscode/<locale>/` |
| CLI language                                  | Labs mention `SFDX_HARDIS_LANG`, so a French learner sees French CLI output against English lab text                                                                                                              |

`TRANSLATION.md` states the process and points at the existing sfdx-hardis translation rules rather than restating them.

## 17. Seeded failure catalogue

The failures are the pedagogy. Each one is committed into the training repo, or applied by `bootstrap` from `scripts/drift/`, so it fires identically for everyone.

| Lab   | Seeded defect                                                                                                                                  | Error the learner sees                                             | Expected fix                                                                                  |
|-------|------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| L1-05 | `InstallationScheduler` carries a missing ApexDoc header on the method US-014 touches                                                          | One MegaLinter warning on the Pull Request, nothing blocking       | Add the header, push, green. The only friction in Level 1                                     |
| L2-01 | US-021 adds a Flow referencing `Installation__c.Crew_Size__c`, but the field is excluded by an over-eager `.forceignore` entry                 | Deployment check fails: `Field does not exist` on the Flow element | Spot the missing component in the package.xml diff, un-ignore the field, re-publish           |
| L2-02 | 30 seeded `Installation__c` records have `Crew_Size__c` empty                                                                                  | `Cannot alter field to required` on integration                    | Two-step delivery with a post-deploy Apex script action that backfills                        |
| L2-03 | The crew-capacity feature needs 12 reference records and a scheduled batch that exist in no org                                                | Nothing fails: the feature is silently inert after deployment      | Declare an SFDMU import action, a batch schedule action and a manual step on the Pull Request |
| L2-04 | `InstallationScheduler` contains a hardcoded record type id; the US-027 change drops coverage under the threshold                              | PMD `AvoidHardcodedId`, then a test coverage failure               | Replace with a describe call, add the missing test, run the checks locally                    |
| L2-05 | US-033 grants the permission on a Profile that overwrite management protects                                                                   | Deployment succeeds but the permission is absent in the target org | Move the permission to `Helios_Delivery_Crew`                                                 |
| L2-06 | `training/mate-us-018-crew-capacity` edits the same Flow and the same Permission Set as the learner's branch, and lands in `integration` first | Git conflict on merge, on an XML file and on a Flow                | Resolve both, re-save, re-validate                                                            |
| L2-08 | Capstone combines L2-01, L2-03 and L2-06 in one story                                                                                          | All three, in sequence                                             | No step-by-step                                                                               |
| L3-02 | `mate-us-018` passes the check but removes a field still referenced by a report                                                                | Nothing fails automatically                                        | The review, not the robot, is what catches it                                                 |
| L3-04 | `mate-us-018` and `mate-us-019` both edit `Helios_Delivery_Manager`                                                                            | Merge conflict, then a deployment order problem                    | Resolve, re-validate, understand cleaning                                                     |
| L3-07 | `helios-prod` is seeded with a picklist value added by hand, present in no branch                                                              | Retrofit reports a drift                                           | Retrofit into the repo, then release                                                          |
| L3-08 | The seeded orgs contain 2 inactive users, an unsecured Connected App and an Apex class on an old API version                                   | Monitoring reports 3 findings on the first run                     | Read the report, route the notification, decide what is noise                                 |

## 18. Trailhead steps: verified and to verify

Verified during this spec:

| Title                                                                    | URL                                                                                     |
|--------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| Git and GitHub Basics for Effective Collaboration                        | `content/learn/modules/git-and-git-hub-basics`                                          |
| Org Development Model                                                    | `content/learn/modules/org-development-model`                                           |
| Package Development Model                                                | `content/learn/modules/sfdx_dev_model`                                                  |
| App Development with Salesforce DX                                       | `content/learn/modules/sfdx_app_dev`                                                    |
| DevOps Center: Quick Look                                                | `content/learn/modules/devops-center-quick-look`                                        |
| Explore the Software Development Lifecycle for Salesforce Admins (trail) | `content/learn/trails/explore-the-software-development-lifecycle-for-salesforce-admins` |

Candidates worth adding as warm-up steps once the slug is checked in the Trailhead UI: an Apex testing module for Level 2, and a deployment or ALM module for Level 3. Do not add a step whose URL has not been opened by hand.

Never link a Trailhead module published by a competing DevOps vendor, even when it is the closest match on the topic.

## 19. Build order and effort

The authoring is done by a coding agent across the three repositories, so the schedule is hours, not weeks. The design goal for the plan itself is **maximum autonomy**: every human action is front-loaded into one short setup block, after which the agent works alone.

### 19.1 What makes autonomy possible

| Capability                                                                | State on the build machine                               | What it unlocks                                                                                                                     |
|---------------------------------------------------------------------------|----------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| `gh` CLI, authenticated as `nvuillam`, `admin: true` on the training repo | Ready                                                    | Repo content, branches, Pull Requests, labels, secrets, workflows, the upstream teammate Pull Requests, and the Pages configuration |
| **Four Developer Edition orgs**, authenticated and verified by live query | Ready                                                    | Every deployment, data import and pipeline run the build needs                                                                      |
| Chrome, plus Playwright over CDP                                          | Ready, logged into GitHub and Trailhead                  | Capture the GitHub web UI as a logged-in user, and drive the Trailhead UI to create the Trailmixes                                  |
| The extension screenshot harness                                          | In the sibling repo, dependencies installed and compiled | Run the Helios captures directly, since it mocks the `sf` CLI and needs no org                                                      |

**No scratch orgs.** The Dev Hub allows three per day and CI jobs already consume that allowance, so the build uses the four Developer Edition orgs and nothing else. That is also closer to the truth: the learner will be on Developer Edition, so the build is validated on what they will actually use, not on an approximation of it.

Fixed role assignment for the build:

| Alias                | Username                                       | Role in the build                                                        |
|----------------------|------------------------------------------------|--------------------------------------------------------------------------|
| `helios-dev`         | `veurtio.dd9da51447c4@agentforce.com`          | the contributor's dev org                                                |
| `helios-integration` | `veurtio+demo.73193ee31bf8@agentforce.com`     | CI target for Pull Request checks and merges                             |
| `helios-uat`         | `nicobackup@nico.com`                          | second major org, and the **cold start canary**, see 19.2                |
| `helios-prod`        | `nicolas.vuillamy.c8024b5deb9f@agentforce.com` | production stand-in. Also the Dev Hub, so it gets the lightest treatment |

### 19.2 The one real constraint: cold starts are not repeatable

A learner meets `seed/` on a **completely empty org**. That first deployment is the single most fragile thing in the course, because metadata that deploys fine onto a warm org can fail on a cold one over ordering, missing dependencies or license-gated features.

With persistent orgs and no scratch orgs, there are only four genuinely cold orgs in existence, and each can be spent only once.

The policy that follows:

| Rule                                                                                                                    | Reason                                                                                                  |
|-------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `seed/` is reviewed to completion **before** the first deployment                                                       | The first attempt is worth more than the next ten                                                       |
| Burn the orgs in a deliberate order: `helios-dev` first, then `helios-integration`, then `helios-prod`                  | Each failure teaches the next attempt                                                                   |
| **`helios-uat` is the canary.** Nothing is deployed to it until `seed/` has succeeded cold somewhere else               | It preserves one untouched org for a final, honest cold-start rehearsal                                 |
| `scripts/teardown.sh` ships alongside `bootstrap`, using `destructiveChanges.xml` to remove the Helios app and its data | Approximates a fresh org well enough for repeat runs, and the learner gets it too when a lab goes wrong |
| `bootstrap` is idempotent from the start, not as a later refinement                                                     | It will be run repeatedly on the same orgs during the build                                             |

Teardown is an approximation, not a reset: it removes what `seed/` created, and cannot undo a feature toggle or a license assignment. Where a lab depends on org state that teardown cannot restore, the lab says so and the canary is what proves it.

### 19.3 Human actions, all complete

| #   | Action                                                         | Status                                    |
|-----|----------------------------------------------------------------|-------------------------------------------|
| H1  | Chrome with remote debugging, logged into GitHub and Trailhead | Done, verified                            |
| H2  | Four Developer Edition orgs authenticated                      | Done, verified by live query against each |
| H3  | Desktop session available for screenshot batches               | Standing, verified                        |
| H4  | Repository administration rights                               | Confirmed, `admin: true`                  |

Nothing further is required from a human until the Trailmix creation attempt (19.5) and the optional stranger dry run.

### 19.4 Agent work

| #   | Repo                 | Deliverable                                                                                                                                         | Depends on |
|-----|----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|------------|
| A1  | training             | Repo skeleton, `training-universe.json`, `BACKLOG.md` and generators, locale layout, the Training `customCommands` menu and `scripts/training.mjs`  | -          |
| A2  | training             | `seed/` metadata for the Helios app, SFDMU workspaces, `scripts/drift/`                                                                             | A1         |
| A3  | training             | `bootstrap`, `teardown`, `reset-level`, `simulate` scripts, both shells, validated on `helios-dev`                                                  | A2         |
| A4  | training             | CI workflows, branch topology, upstream teammate Pull Requests, `mkdocs.yml`, Pages workflow and Pages configuration                                | A1         |
| A5  | training             | Level 1 labs, click-first, with under-the-hood blocks and named screenshot placeholders                                                             | A3, A4     |
| A6  | extension            | Helios fixtures, `SF_MOCK_UNIVERSE`, `mocks.mjs`, training recipe set and `--training` target, regression check, then run the Level 1 capture batch | A2         |
| A7  | training             | Playwright capture of the GitHub web UI against the real upstream Pull Requests                                                                     | A4, H1     |
| A8  | training             | `check.mjs`, `audit.mjs`, claim issue form, `claim.yml`, badge template and render script                                                           | A5         |
| A9  | CLI                  | `training-impact` and `training-update` skills, sibling resolution and clone, CLAUDE.md section, agent output items, `check-training-impact.mjs`    | A5         |
| A10 | -                    | Agent dry run: walk Level 1 end to end, then a cold-start rehearsal on the `helios-uat` canary (19.2), and claim a badge for real                   | A6, A7, A8 |
| A11 | -                    | Create the Level 1 Trailmix by driving the Trailhead UI, record the generated slug                                                                  | A10, H1    |
| A12 | training + extension | Level 2, then Level 3: labs, seeded failures, audit rules, capture batches, Trailmixes                                                              | A11        |
| A13 | CLI + extension      | The gaps A5, A12 uncover: missing UI paths, unclear errors, small fixes (23.2)                                                                      | as found   |

### 19.5 Two places where autonomy can still fail

- **Trailmix creation (A11).** Trailhead has no API, so this is browser automation against a UI nobody promised to keep stable. The fallback is not a blocker: the agent generates the ordered step list, and a human pastes it in, 30 minutes per level. The step tables in sections 8, 9 and 10 are that list.
- **The stranger dry run.** A10 is the agent walking its own labs, which catches broken commands, wrong paths and missing screenshots, but cannot catch "this instruction is confusing to someone who does not already know the answer". That check is worth doing before announcing, and it is the one thing on this whole plan that a person has to give real attention to. It is not needed to build.

## 20. Maintenance

| Risk                                                                                         | Mitigation                                                                                                                                                                     |
|----------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| sfdx-hardis command or flag changes break a lab                                              | The `training-impact` skills and `check-training-impact.mjs` (section 14), plus a pinned plugin version in `bootstrap`                                                         |
| Extension panel redesign makes every screenshot wrong                                        | The `training-update` skill in this repo re-runs the Helios capture in the sibling extension clone and opens the training Pull Request                                         |
| Someone edits an existing mock fixture while adding the Helios one                           | The product screenshot regression check in 13.2, plus a Pull Request whose diff touches no existing fixture file                                                               |
| A contributor works only in the extension repo and never loads the training skills           | The pointer line in the extension's CLAUDE.md (14.4). Known gap, mitigated not eliminated                                                                                      |
| Screenshots drift from the lab text                                                          | Both come from `training-universe.json`; CI fails on an undeclared User Story id or a missing image                                                                            |
| Doc page renamed (the `salesforce-ci-cd-*` to `salesforce-devops-*` rename already happened) | Every Trailmix Link target is in `labs/link-map.en.md`, checked by `link-check.yml`                                                                                            |
| Trailhead module retired or re-slugged                                                       | Same link checker, run monthly                                                                                                                                                 |
| GitHub changes its web UI                                                                    | Re-run `capture/github.mjs` in one command against the real repo                                                                                                               |
| `seed/` stops deploying on a fresh DE org after a Salesforce release                         | `sync-check.yml` seeds a throwaway DE org monthly and fails loudly                                                                                                             |
| DE org deactivated mid-course                                                                | README states the expected pace and how to re-seed a replacement org                                                                                                           |
| A learner breaks their repo in Level 2 and abandons                                          | `scripts/reset-level.sh <level>`, advertised at the top of every level README                                                                                                  |
| Claims go unanswered                                                                         | They cannot: `claim.yml` audits, comments and closes without a human. The residual duty is reading `needs-work` issues that stay open for weeks, which are course bug reports  |
| The unofficial Trailhead profile endpoint disappears                                         | Nothing breaks: it is never a gate (15.3), only a decoration on the badge page                                                                                                 |
| The claim workflow grows unsafe as features are added                                        | The five rules in 15.2 are repeated as comments at the top of `claim.yml`. The issue flow never checks out a stranger's code into the workspace, which is what keeps it simple |
| Audit rules drift from the labs                                                              | `audit.mjs` rules live next to the lab they verify and ship in the same Pull Request                                                                                           |
| Pages build breaks and blocks nothing important                                              | By design: badges are committed files, the site only renders them                                                                                                              |
| Three Trailmixes drift apart as labs are renumbered                                          | The step tables in this spec are the source of truth; site nav and link maps are generated from them                                                                           |

## 21. Decisions taken

| #   | Question                           | Decision                                                                                                                                                                                                                                          |
|-----|------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1   | Owning Trailhead account           | `nvuillamy`. Personal account, accepted                                                                                                                                                                                                           |
| 2   | How orgs are seeded                | Sources from the GitHub repo, deployed with `sf project deploy start`. No unlocked package, no Dev Hub                                                                                                                                            |
| 3   | Completion checks and claims       | In v1. Receipts from a local check, claim as a Pull Request, central audit of the learner's public fork                                                                                                                                           |
| 4   | Badge                              | Yes, and free: SVG rendered by a workflow, badge page on the training site, Open Badges shaped JSON, no paid issuer                                                                                                                               |
| 5   | Git platforms                      | GitHub only in v1                                                                                                                                                                                                                                 |
| 6   | Languages                          | English only in v1, with the locale layout and staleness tooling in place from the start                                                                                                                                                          |
| 7   | Level 2 positioning                | Recommended for a contributor who wants to stop after Level 1, **required before Level 3**. The Level 3 audit checks Levels 1 and 2 first                                                                                                         |
| 8   | Where badges live                  | `hardisgroupcom/sfdx-hardis-training`, in `badges/`. No separate repo                                                                                                                                                                             |
| 9   | Actions minutes                    | Not a constraint on a public repo                                                                                                                                                                                                                 |
| 10  | Training site                      | GitHub Pages built with Zensical, same toolchain as the product doc site. It hosts the labs and the badge pages                                                                                                                                   |
| 11  | Wording                            | Badge, never certification. Certifications for clients and partners are a separate future thing, out of scope here                                                                                                                                |
| 12  | Screenshots                        | Real, from the extension's existing screenshot harness driven with a Helios fixture universe generated from `training-universe.json`. GitHub web UI captured with Playwright against the real public repo                                         |
| 13  | Cross-repo sync                    | A committed `training-manifest.json`, a diff check, and a monthly backstop workflow                                                                                                                                                               |
| 14  | Existing mock data                 | Never replaced, edited or repointed. The training fixtures are new files in new folders, `SF_MOCK_UNIVERSE` unset keeps today's behavior byte for byte, and a regression check proves the product screenshots did not move                        |
| 15  | Where the skills live              | `sfdx-hardis/.claude/skills/` only: `training-impact` and `training-update`. The training and extension repos carry no skills. `sfdx-hardis-training` is always a sibling directory, cloned there if absent, like `vscode-sfdx-hardis` already is |
| 16  | Claim mechanism                    | A GitHub issue form carrying the level, the Trailblazer username and the public repository URL. No Pull Request, no fork-and-commit                                                                                                               |
| 17  | Who reviews claims                 | Nobody. `claim.yml` clones the public repo, audits it, comments and closes. The residual human duty is reading `needs-work` issues, which are course bug reports                                                                                  |
| 18  | Trailhead-side verification        | Not a gate. A Trailmix awards nothing queryable, and the only profile endpoint is unofficial. The Trailblazer username is shown on the badge page, and the optional badge check never blocks (15.3)                                               |
| 19  | Helios fixture source for captures | Read from the sibling training clone at its latest `main`, not vendored into the extension repo                                                                                                                                                   |
| 20  | Custom domain                      | `github.io` for now                                                                                                                                                                                                                               |
| 21  | Screen recordings                  | No. Annotated stills with numbered pills, reusing the disc the extension's image script already draws (13.6)                                                                                                                                      |
| 22  | How labs are written               | Clicks only: the product panels first, then a **Training menu the training repo declares through `customCommands`**, and a copy-paste command only as a last resort. An "under the hood" block follows every significant step (11.1, 11.2)        |
| 23  | Level 3 starting point             | Not an empty repository. The learner's own fork, whose pipeline stops at `integration`, so Level 3 finishes it. This keeps continuity with Levels 1 and 2 and matches what most real projects look like                                           |
| 24  | Level 1 CI credential              | `SFDX_AUTH_URL_INTEGRATION` in the learner's fork, with an explicit warning and a forward link to the JWT setup in Level 3 lab 1, which deletes it (8.2)                                                                                          |
| 25  | Gaps and bugs found while building | Fixed in the same three branches when small and related, in their own Pull Request when large, and listed either way in a "Found while training" section of the training Pull Request (23.2)                                                      |

## 22. Still open

Every question raised so far is answered and recorded in section 21. Three second-order choices remain, each small enough to settle during the phase that needs it:

1. **Does a learner who deletes or makes private their repository keep the badge?** The badge page is committed and would survive, but its evidence link would 404. (Recommendation: keep the badge, and have `sync-check.yml` mark the evidence link as no longer reachable rather than revoke anything.)
2. **One badge page per learner, or one page per badge?** One page per learner keeps a single shareable URL as they progress through the three levels, which argues for it. Settle before A6, since the URL is the thing people share.
3. **Which Trailhead handle field is authoritative if a learner's GitHub handle and Trailblazer username differ?** The badge page is keyed by GitHub handle (it is what the audit can prove) and shows the Trailblazer username as declared. Confirm that is the right way round before the issue form is written.

## 23. Working agreement for implementation

### 23.1 Three branches

Work happens on a branch in each of the three repositories, never on `main`:

| Repo                                  | Branch                   | Carries                                                                                                                                                                                                                |
|---------------------------------------|--------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `hardisgroupcom/sfdx-hardis-training` | `feat/training-v1`       | Everything in section 6                                                                                                                                                                                                |
| `hardisgroupcom/sfdx-hardis`          | `feat/training-skills`   | `training-impact` and `training-update` skills, the CLAUDE.md Training section, agent output items, `check-training-impact.mjs`, plus the CLI fixes found while writing the labs                                       |
| `hardisgroupcom/vscode-sfdx-hardis`   | `feat/training-fixtures` | The Helios universe fixtures, `SF_MOCK_UNIVERSE`, the training recipe set and `--training` target, the product screenshot regression check, plus the extension fixes and missing UI paths found while writing the labs |

Three Pull Requests, cross-linked in their descriptions. Merge order follows the dependency order: fixtures and skills can land before the training repo is complete, since both are additive and inert until the training uses them.

### 23.2 Gaps and bugs found along the way get fixed in these branches

Writing this training walks the entire product, as a beginner, on freshly created orgs, on two operating systems. That is a better bug finder than any test suite, and the findings must not be lost in a notes file.

The rule: **a gap or bug found while building a lab is fixed in the branch of the repository it belongs to, in the same effort.** A missing button that forces a lab into tier 3 is an extension change. A confusing error message that makes a seeded failure unteachable is a CLI change. Both land in their branch and are listed in that Pull Request's description, next to the lab that motivated them.

One judgment rule keeps the Pull Requests reviewable:

| Finding                                                                                                                                    | Where it goes                                                                                            |
|--------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| Small, local, clearly related to a lab (a missing UI entry, a wrong label, an unclear error message, a missing `--agent` flag, a doc line) | The training branch of that repo, listed in the Pull Request description                                 |
| Large, risky, or a redesign (a new panel, a behavior change affecting real projects, anything touching deployment logic)                   | Its own branch and Pull Request, cross-linked. The lab waits for it, or is written around it with a note |

Report both kinds in the same place: a running "Found while training" list in the training Pull Request description, so the three repositories keep one shared account of what the exercise turned up. A finding that is neither fixed nor written down is the only unacceptable outcome.

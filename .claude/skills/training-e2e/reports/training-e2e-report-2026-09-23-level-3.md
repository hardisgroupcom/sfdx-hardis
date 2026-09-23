# Training end to end run, 2026-09-23 (second run of the day): Level 3, Lab 3.10

Third run of the `training-e2e` skill, and the first one aimed at a single lab: **Lab 3.10 - Promote
a subset with promotion branches (Beta)**, which had never been walked. It was written from the
command and panel sources rather than from a run, and this run was asked to find out whether it
works and whether it is accurate.

**It does not work as written, and now it does.** Two defects in `sfdx-hardis` stop the lab, one of
them dead: on this repository no promotion Pull Request could deploy at all. Both are fixed, with
unit tests, in hardisgroupcom/sfdx-hardis#2236. Four inaccuracies in the lab text are fixed in
hardisgroupcom/sfdx-hardis-training#26.

Everything the lab teaches, once the two defects are out of the way, is **true**: the selectivity
works, the configuration travels the way Lab 3.1 promises, and the capstone ends the exception the
way Lab 3.10 says it will.

## Versions under test

| Thing              | Version                                                                         |
|--------------------|---------------------------------------------------------------------------------|
| sfdx-hardis        | 8.10.0, linked working copy (`sf plugins` shows `link`), fix at `0e27c3d0d`     |
| vscode-sfdx-hardis | `main` at `52855031` (not exercised: this run was headless, see what it missed) |
| Course             | `feat/promotion-branches-lab` at `06f286f`                                      |
| Salesforce CLI     | @salesforce/cli 2.151.6, node 24.11.1                                           |
| Published site     | **behind**: Lab 3.10 is not on `main`, so pass A read a locally built page      |

## Environment

| Item             | State                                                                        |
|------------------|------------------------------------------------------------------------------|
| `helios-prod`    | Developer Edition, Dev Hub, `orgfarm-c77e7e1127`. Re-seeded                  |
| `helios-preprod` | Developer Edition, `orgfarm-bedd5b7a5a`. Re-seeded                           |
| Scratch orgs     | `helios-dev`, `helios-integration` reused; `helios-uat` rebuilt (see F3)     |
| Fork             | `nvuillam/sfdx-hardis-training`, reset from the branch under test            |
| Learner clone    | `C:/git/training-run2` (the usual clone was held open by an editor)          |

Three deviations from a learner's path, all forced, all recorded:

- **The start branches under test are not published.** `training/start-level-*` on the shared
  repository are built from `main` and do not carry the new simulate scenarios or the new verify
  rule. They were built locally from the branch under test, pushed to the **fork** only, and `$RUN`'s
  `upstream` remote was pointed at the fork so `Reset this level` could reach them. Nothing
  unreleased was pushed to the shared repository.
- **The webview was never clicked.** No lab driver entry covers 3.10 (it carries a documented
  `skip`), so every panel action was done through `panel.mjs` or directly with `git`/`gh`. The
  checkbox column and the **Create promotion from uat (Beta)** button were read from the screenshots
  and from the command the lab documents, never clicked.
- **One Pull Request was merged with its required check lifted**, #10, because F1 makes a promotion
  Pull Request unmergeable on this repository. The protection was restored immediately after.

## What was walked

| Lab  | Fidelity        | A (read) | B (do)  | C (images) | Findings       |
|------|-----------------|----------|---------|------------|----------------|
| 3.1  | 2 and 3         | OK       | OK      | not done   | F4, F3         |
| 3.2  | not covered     | -        | -       | -          | -              |
| 3.3  | not covered     | -        | -       | -          | -              |
| 3.4  | not covered     | -        | -       | -          | -              |
| 3.5  | 3, partial      | OK       | partial | not done   | -              |
| 3.6  | 3, partial      | OK       | partial | not done   | -              |
| 3.7  | not covered     | -        | -       | -          | -              |
| 3.8  | not covered     | -        | -       | -          | -              |
| 3.9  | not covered     | -        | -       | -          | -              |
| 3.10 | 2 and 3         | OK       | OK      | **OK**     | F1, F2, F5, F6 |
| 3.11 | 3, the one claim| OK       | partial | not done   | -              |

Labs 3.2, 3.3, 3.4, 3.7, 3.8 and 3.9 are **not covered** by this run. They are not on the promotion
branches path and were walked green on 2026-09-23. Labs 3.5 and 3.6 were done only as far as the
chain needed: the promotions that carry the configuration up. Their own steps (the overwrite
manager, the release notes, the DORA report) were not re-walked.

## The cheap checks, all green

`universe.mjs --check`, `check-commands.mjs` (14 commands), `check-links.mjs` (85 URLs),
`check-pills.mjs`, `check-i18n.mjs`, `site.mjs` + zensical, `check-site.mjs` (115 pages, 1807
assets, 5379 links), `check-nav.mjs`, `check-language-switch.mjs`, `check-structure.mjs`,
`align-tables.mjs`, `lab-command-links.mjs`, `lab-crossrefs.mjs`.

`start-branches.mjs --check` reports all three reset branches stale. **Pre-existing**: `main` itself
reports the same. They need a republish before the release.

## Findings

| Id  | Severity     | Where            | What                                                                         |
|-----|--------------|------------------|------------------------------------------------------------------------------|
| F1  | **blocking** | sfdx-hardis      | A promotion fails on conflict markers in files it does not carry (**fixed**) |
| F2  | **blocking** | sfdx-hardis      | A GitHub squash merge never yields its Pull Request number (**fixed**)       |
| F3  | **high**     | training         | Clean up a training org, then Set up, cannot succeed (**documented**)        |
| F4  | medium       | training         | Lab 3.1 sends you back into a command that then stops (**documented**)       |
| F5  | medium       | training         | Lab 3.10 names the wrong Author in its sample (**fixed**)                    |
| F6  | low          | training         | Lab 3.10's sample log is in the wrong order (**fixed**)                      |
| F7  | low          | this skill       | `auth.mjs` hides the CLI's real error (**not fixed**)                        |

### F1 - A promotion fails on conflict markers in files it does not carry (blocking)

**What a learner sees.** They reach step 6, read the sfdx-hardis comment as the lab tells them to,
and find the deployment refused:

> Nothing was deployed: the promotion branch `promotion/uat/preprod/2026-09-23-1807` still contains
> git conflict markers in 2 file(s).
> - `labs/en/level-2-contributor-advanced/2-7-resolve-a-git-merge-conflict.md`
> - `labs/fr/level-2-contributor-advanced/2-7-resolve-a-git-merge-conflict.md`

Those files are the lab that **teaches** merge conflicts. They contain `<<<<<<<` as teaching
material, they are identical on `preprod`, and the promotion never touched them: the branch carries
one file, `Installation__c/fields/Status__c.field-meta.xml`, and the cherry-pick was clean. The
post-merge deployment fails the same way, so the lab is dead, not merely noisy.

`listFilesWithConflictMarkers` ran `git grep` over every tracked file of the branch. Any repository
whose own content holds conflict markers is affected, not just this one: documentation about
resolving conflicts, merge driver fixtures, scaffolding templates.

**Fixed** in sfdx-hardis#2236: the guard looks only at the files the promotion carries against the
branch it was cut from, and falls back to the whole branch when that target cannot be resolved, so a
genuine `--on-conflict commit-with-markers` promotion is still caught. Three unit tests.

### F2 - A GitHub squash merge never yields its Pull Request number (blocking without a token)

**What a learner sees.** Step 4, the button they just clicked, refuses:

> Pull Request(s) #7 are not among the Pull Requests waiting for promotion (-)

while the table above it lists the story whose title ends in `(#7)`.

`extractPrNumbersFromMessage` wanted whitespace before the `#`, and GitHub writes a squash merge
subject as `US-057 Park an installation that is waiting for parts (#7)`. With no git provider token
in the environment, nothing else supplies the number, so the Pull Requests column is empty and every
`--pull-requests` is refused. With a token the lab works, and the lab never mentions a token.

It also made a claim of Lab 3.5 false: the notes find a story from "a merge commit or the single
commit of a squash alike".

**Fixed** in sfdx-hardis#2236: an opening bracket counts as a boundary. Re-proved on the no-token
path, which now assembles the branch and opens the Pull Request.

### F3 - Clean up a training org, then Set up my training environment, cannot succeed (high)

**What a learner sees.** They clean an org up, which reports success, then click **Set up my
training environment**, which both the teardown's closing text and the setup's own error message
invite them to do. It fails:

> CustomField `Installation__c.Account__c`: There is already a Child Relationship named
> Installations on Account.

`EntityDefinition` shows no `Installation__c` in the org; the tooling API shows **two** soft-deleted
`Installation` objects. Deleting a custom object does not erase it: it sits in Deleted Objects and
keeps its relationship names reserved, so the app cannot be created next to it. The error names a
child relationship the learner cannot find anywhere in Setup.

**Documented** in training#26: Lab 3.1's "If it goes wrong" now names the cause, the Setup page that
erases it, and the quicker way out on a scratch org. The teardown itself is unchanged: there is no
supported API to purge a deleted object, which is the honest reason it cannot just fix itself.

*(This is the successor to the 2026-09-23 run's F3. The teardown now completes, which that finding
asked for. The round trip is what is still broken.)*

### F4 - Lab 3.1 sends you back into a command that then stops (medium)

Two "If it goes wrong" entries of Lab 3.1 say to run **Add/Configure Org** again for a branch. A
second run stops on a question the lab's list of a dozen questions does not have:

> External Client App named `sfdxhardisintegration` already exists in ... Delete it in Setup >
> External Client App Manager before continuing. Have you deleted it?

**Documented** in training#26, with the second "stops straight after Selected Org" case pointing at
the stale-cache entry that already existed.

### F5 - Lab 3.10 names the wrong Author in its sample (medium)

Step 5's carried table gives the Author as `Mariia Pyvovarchuk`. The command writes the GitHub
account that **opened** the Pull Request, and `Simulate my teammates` opens it with the learner's
own account, so every learner sees their own handle. The branch window of the panel shows the commit
author, which is Mariia, and is almost certainly where the sample came from.

**Fixed** in training#26, in both locales, with a paragraph saying which column comes from where and
that the Title needs the same token Lab 3.5 documents.

### F6 - Lab 3.10's sample log is in the wrong order (low)

The sample prints `assembled with 1 User Story(ies)` before `Creating the Pull Request`. The real
order is Creating, created, then assembled, and the real `Cherry-picking` line carries the author and
the short SHA. **Fixed** in training#26, both locales.

### F7 - `auth.mjs` hides the CLI's real error (low, this skill)

`auth.mjs` writes only `result.stdout` to its log. When `hardis:project:configure:auth` exited 1
with its reason on **stderr** (`Invalid config value: org ... is not authenticated`), the log showed
a command that simply stopped, and the run spent time reading CLI source to find what a one-line
message would have said. **Not fixed.** `auth.mjs` should write both streams.

## What the run proved, positively

Worth recording, because these are the lab's own claims and they hold:

- **The Lab 3.1 step 10 design claim.** `enablePromotionBranches` and `allowedPromotionSteps` were
  published in Lab 3.1, sat inert through Labs 3.5 and 3.6, and arrived in `preprod` with the
  ordinary promotions, untouched. Verified on `origin/preprod` before the promotion was created.
  This is the non-obvious thing the lab exists to explain, and it is true.
- **The branch shape.** `promotion/uat/preprod/2026-09-23-1807`, and the `-2` suffix when the minute
  is already taken, both observed.
- **Cut from the target.** One commit against `origin/preprod`, carrying one file, with the
  `(cherry picked from commit ...)` trailer of `git cherry-pick -x`.
- **The declaration.** `promotionPullRequests: [7]`, the carried table, `Tickets: US-057`, and the
  "Do not squash this Pull Request" line.
- **The selectivity, in the org.** After the deployment, `helios-preprod` offers **Awaiting Parts**
  in the Status picklist and has **no Warranty Years** field on Panel Batch, while `helios-uat` has
  both. This is step 7, and it is the whole point of the lab.
- **The exception ends.** The next ordinary `uat` to `preprod` promotion carried US-058 up, US-057
  merged cleanly although it was in both branches by different routes, the job was green, and the
  Lab 3.10 check still passes afterwards, which is what the badge audit needs.
- **The new check rule.** `check --level 3 --lab 10` passes on correct work and its message is
  accurate. `status` reads `1/11`, so the renumbering reached it.
- **Lab 3.1's stale org cache entry** is accurate and its cure works: the run hit exactly the
  described symptom and the documented answer fixed it.
- **Lab 3.5's admonition** pointing at its own step 7 for the checkbox column is correct.
- **Pass C on Lab 3.10's four images**: all four match their text, including the "(1 selected)"
  button label and the `uat` counter still reading 2 while the promotion is open.

## What this run did not cover

- **The webview was never clicked.** The checkbox column, the **Create promotion from uat (Beta)**
  button and the Danger Zone tab were read from screenshots and driven through the underlying
  command. A defect that lives only in those panels would not have been found. `lab-drivers.json`
  carries a documented `skip` for 3.10 saying so.
- **F1 and F2 are not proven in CI.** The course's jobs run a released sfdx-hardis from a Docker
  image, so the fix cannot be exercised by the real deployment job until it ships. The
  reproductions are local, on the real branch, plus unit tests.
- **Labs 3.2, 3.3, 3.4, 3.7, 3.8 and 3.9 were not walked.** Lab 3.8, the monitoring one in a second
  repository, remains the least often run lab of the course.
- **Labs 3.5 and 3.6 were walked only as far as the chain needed.** The overwrite manager, the
  release notes and the DORA report were not exercised.
- **Pass C was done for Lab 3.10 only.** The Level 3 screenshots of the other labs remain
  unreviewed, which the previous run already said is where the hit rate is.
- **The Level 3 badge was not claimed**, and the capstone was not walked as a lab: only its one
  claim about US-058 was verified.
- **French was not walked.** `labs/fr/` was checked by the structure and i18n scripts, and the
  French edits of this run were written against the English.
- **An agent is not a beginner.** Nothing here tests whether the prose works for a first-timer.

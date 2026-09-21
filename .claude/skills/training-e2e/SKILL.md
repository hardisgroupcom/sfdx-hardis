---
name: training-e2e
description: Walk the sfdx-hardis training course end to end as a learner would, against a real Developer Edition org and a real fork, checking that every step works and that every screenshot still matches the text, and fixing what it finds. Use when the user asks to test the training, walk the labs, run the course end to end, verify a level, check that the course is still up to date, or when a change to sfdx-hardis or vscode-sfdx-hardis is big enough that reading the labs is not enough.
argument-hint: "[level or lab, e.g. 1, 2.3, all] [org alias] [what to focus on]"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, WebFetch, AskUserQuestion
user-invocable: true
model: opus
---

# Testing the training course end to end

Do the course. Not read it: do it, in a real fork, against real orgs, one lab at a time, and fix
what breaks. The goal is that when a learner arrives, every step works, every screenshot shows what
the text describes, and nothing assumes something an earlier lab did not deliver.

Three skills already cover the course and none of them does this:
[[training-impact]] decides whether a change breaks a lab, [[training-update]] performs the edits,
[[training-publish]] handles Trailhead and the badges. This one is the only one that finds the
defects nobody predicted.

## What this skill contains

| File                       | Use                                                                                                          |
|----------------------------|--------------------------------------------------------------------------------------------------------------|
| `reference/runbook.md`     | The full procedure: fidelity levels, the three passes per lab, per level notes, the traps. **Read it first.** |
| `scripts/preflight.sh`     | Every prerequisite in one screen, and what to ask the user for.                                              |
| `scripts/env.sh`, `env.mjs`| The paths, all derived from this skill's own location, all overridable.                                       |
| `scripts/reset-fork.sh`    | Puts the fork and the clone back to what a brand new fork gives a learner.                                    |
| `scripts/panel.mjs`        | The headless stand-in for the VS Code panel: real command, real org, prompts answered from rules.             |
| `scripts/review-lab.mjs`   | Per lab, every image with its pills, the text around it, and the file to open.                                |
| `scripts/prflow.sh`        | Waits for a Pull Request's checks, merges when green, watches the deployment job.                             |
| `scripts/auth.mjs`         | Lab 3.1: Add/Configure Org for one branch, then its two secrets on the fork.                                  |
| `scripts/mon.mjs`          | Lab 3.8: Install Org Monitoring in the monitoring repository, then its secrets.                               |
| `scripts/setsecrets.mjs`, `setsecrets-mon.mjs` | Read the secret values out of a command's log and store them.                             |
| `scripts/sync.sh`          | Mid-walk only: brings a course fix into the fork's major branches.                                            |
| `reports/`                 | One report per run.                                                                                          |

## Before starting

```bash
bash .claude/skills/training-e2e/scripts/preflight.sh
```

It prints OK, WARN or MISSING per item. A MISSING is something to **ask the user for**, because the
run cannot do it itself:

- a **Developer Edition org**, signed up at <https://developer.salesforce.com/signup> and connected.
  Level 3 needs two: `helios-prod` (production in the fiction, and the Dev Hub) and `helios-preprod`.
  Prefer the `orgfarm-*` Developer Edition orgs already authenticated; a full walk needs a fresh
  daily scratch org allowance and a fresh API budget on the Dev Hub, both of which preflight prints;
- **`gh` signed in**, with the `repo` and `workflow` scopes;
- a **Chrome signed in to GitHub**, started with `--remote-debugging-port=9222`, for the labs that
  end on a GitHub or Salesforce page. Never automate a sign-in, and never send keystrokes to a window
  found by its title.

Decide with the user, if they have not said: which **levels** to walk (Level 1 alone is the quick
pass; Level 3 is the long one), and whether to **reset the fork** first, which the answer should
almost always be yes to.

## Process

1. **Read `reference/runbook.md` in full.** It holds the fidelity levels, the traps of the five
   previous runs, and the role split of Level 3 that is easy to break by being helpful.
2. **Run the cheap checks first**, in `$COURSE`. There is no point walking 26 labs to find a dead
   link:

   ```bash
   node scripts/verify/check-commands.mjs     # every command a lab needs still exists
   node scripts/verify/check-links.mjs        # every URL
   node scripts/verify/check-pills.mjs        # drawn pills versus referenced pills
   node scripts/build/site.mjs && node scripts/verify/check-site.mjs
   ```

3. **Reset the fork**: `bash scripts/reset-fork.sh`, and put the orgs back with
   `node scripts/training.mjs teardown`. Never delete and recreate the scratch orgs: the daily
   allowance does not come back.
4. **Walk each lab with the three passes** (runbook section 4), one lab at a time, in order:
   **read** the published page as a learner, **do** every step at the highest fidelity that can do
   it, **look** at every image with `review-lab.mjs` and the Read tool. Then the lab's own
   `Check my work`.

   For the "do" pass, prefer the **lab driver**, which is the real UI over the real CLI:

   ```bash
   cd ../vscode-sfdx-hardis && yarn dev && yarn compile
   SFDX_HARDIS_LAB_WORKSPACE="$RUN" SFDX_HARDIS_LAB_ONLY=1.3 yarn test:ui:labs
   ```

   Fall back to `scripts/panel.mjs` for a lab `labs/_assets/lab-drivers.json` does not cover, and
   record which fidelity each lab got.
5. **Fix what you find, inside the run**, in the repository that owns the defect (runbook section 8),
   then re-do the step. `labs/en/` first, the other locales after.
6. **Write the report** into `reports/training-e2e-report-<yyyy-mm-dd>.md` (runbook section 10),
   including the "what this run did not cover" section.
7. **Open one Pull Request per repository**, cross-linked, in the order CLI, extension, training.
   Then run the `code-review` skill at `high` on each and fix what it raises.

## Rules for the run

- **Do the lab, do not improve on it.** The moment you do something the lab did not tell the learner
  to do, stop: that is the finding. Fixing the environment quietly is how a course stays broken.
- **A question with no answer is a finding.** `panel.mjs` stops when a prompt matches no rule,
  because a learner would be stuck on the same question. Decide which is wrong, the product or the
  lab, and say so.
- **Look at the screenshots.** Every previous run let a stale one through by checking pill numbers
  instead of opening the image. The number check passes on a screenshot of a panel that no longer
  exists.
- **Be autonomous.** Do not stop to ask whether to continue.
- **Report honestly.** A lab not walked is "not covered", never "OK". Say which fidelity each lab was
  walked at.
- **Update the runbook** whenever a trap costs you time, so the next run does not pay it again.

## Known gaps of every run so far

State them again in the report unless you close them:

- **The webview DOM is still not clicked.** The lab driver (`yarn test:ui:labs` in
  `../vscode-sfdx-hardis`) runs the real panel and the real command together, which is what catches a
  webview-only defect. It still answers the question the panel received rather than clicking a pixel,
  and it only drives the labs `labs/_assets/lab-drivers.json` covers. Runbook section 9.
- **An agent is not a beginner.** It reads past ambiguities a first-timer stops at, because it knows
  the product. Treat every sentence you had to re-read as a finding, and say in the report that
  prose clarity was not really tested.
- The French labs are walked only when asked. `labs/en/` is the reference and gets the walk;
  `labs/fr/` is checked for structure by `scripts/i18n/check-structure.mjs`, not by doing it.
- Lab 1.1 installs tools that are already installed, so it is read and its screenshots are checked,
  never performed.
- Levels 1 and 2 have been walked green several times; Level 3 is the one that keeps finding
  defects, and its Lab 3.8 (monitoring, second repository) is the least often run.

$ARGUMENTS

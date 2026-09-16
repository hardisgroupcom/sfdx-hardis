# Session continuation: the sfdx-hardis training

Everything another Claude Code instance needs to pick this up, on this machine or another.
Kept current: updated on every commit of this effort.

**Last updated**: 2026-09-16, during the Level 2 and Level 3 walk.

---

## What this is

Three learning paths ("Salesforce DevOps with sfdx-hardis") built across three repositories, from
the spec at `specs/trailmix-salesforce-devops.md` in this repository.

| Repository | Branch | Pull Request |
|---|---|---|
| `hardisgroupcom/sfdx-hardis-training` | `feat/training-v1` | [#1](https://github.com/hardisgroupcom/sfdx-hardis-training/pull/1) |
| `hardisgroupcom/vscode-sfdx-hardis` | `feat/training-fixtures` | [#514](https://github.com/hardisgroupcom/vscode-sfdx-hardis/pull/514) |
| `hardisgroupcom/sfdx-hardis` | `feat/training-skills` | [#2206](https://github.com/hardisgroupcom/sfdx-hardis/pull/2206) |

The three clones are **siblings**, and the skills depend on that layout:

```
C:/git/
├── sfdx-hardis/            the skills, the spec, report.md, this file
├── sfdx-hardis-training/   the course
└── vscode-sfdx-hardis/     the screenshot harness and the Helios fixtures
```

`report.md` in this repository is the full account of what was built and what was found. Read it
first; this file is the operational state.

---

## The standing instruction

From the user, verbatim in intent:

- Be autonomous, do not stop.
- Do not stop until **all screenshots are good, verified, and fixed if necessary**.
- Do not stop until **all modules have been performed in a forked repo**, fixing issues found on the way.
- **Play Level 2 and Level 3** too, not just Level 1.
- Commit everything on every change, including this file.
- Installing safe tools (zensical and similar) is allowed.

---

## Environment, verified working

| Thing | State |
|---|---|
| Chrome with CDP | Running on `127.0.0.1:9222`, signed into GitHub as `nvuillam` and into Trailhead |
| Playwright | `playwright-core` installed in the training repo (`--no-save`), connects over CDP, verified |
| Zensical | Installed. Run it as `python -m zensical build` (the `zensical` binary is not on PATH) |
| `gh` | Authenticated as `nvuillam`, scopes `gist, read:org, repo, workflow` |
| Power settings | **Changed**: `monitor-timeout-ac 0` and `standby-timeout-ac 0`. Restore before finishing: `powercfg /change monitor-timeout-ac 15` and `powercfg /change standby-timeout-ac 180`. Also noted in `scratchpad/RESTORE-POWER.txt` |

### The four orgs

All authenticated, all fair game (the user said so explicitly: reset, deploy, delete as needed).

| Alias | Username | Seeded |
|---|---|---|
| `helios-dev` | `veurtio.dd9da51447c4@agentforce.com` | yes |
| `helios-integration` | `veurtio+demo.73193ee31bf8@agentforce.com` | yes (also aliased `integration`) |
| `helios-uat` | `nicobackup@nico.com` | yes |
| `helios-prod` | `nicolas.vuillamy.c8024b5deb9f@agentforce.com` | yes |

### The learner fork

`nvuillam/sfdx-hardis-training`, cloned at
`C:/Users/33614/AppData/Local/Temp/claude/C--git-sfdx-hardis/<session>/scratchpad/learner`.

- `main` carries the full course content, `integration` is the learner's working branch.
- Secret `SFDX_AUTH_URL_INTEGRATION` is set, pointing at `helios-integration`. **Delete it at the
  end**: it is a long-lived refresh token, which is what Level 3 lab 1 teaches learners to remove.
- Level 1 is complete on it: US-014 and US-016 merged, audit 6/6, badge rendered.

### GitHub Pages

The user enabled Pages on the training repo **from `feat/training-v1`**, not from `gh-pages`.

- **Remind the user to repoint it at `main` (or `gh-pages`) before merging.** `pages.yml` pushes the
  built site to `gh-pages` with `ghp-import`, and it only triggers on `main`.
- The site builds clean locally: `node scripts/build/site.mjs && python -m zensical build`.
  38 pages, 141 asset references, all resolving (`node scripts/verify/check-site.mjs`).

---

## Where the work stands

### Done and verified

- The whole course: 27 labs, 3 levels, the Helios app, the seed data, the Training menu, the checks,
  the badge machinery.
- Level 1 walked end to end on the real fork, against a real org: PR check green (31 components,
  4/4 tests, 100% coverage), both stories merged, audit 1/6 → 6/6, badge rendered from that audit.
- 51 screenshots captured from the real extension with the Helios fixtures.
- The product screenshots proven unchanged (`SF_MOCK_UNIVERSE` unset keeps `doc-screenshots/` byte
  identical).
- The site builds and every asset resolves.
- All three Pull Requests green.

### In progress

- Walking Level 2 on the fork, lab by lab, verifying each seeded failure actually fires.
- Then Level 3, including JWT for three orgs, the promotion chain, hotfix, retrofit, monitoring.

### Not done yet

- `training/start-level-3` (needs the Level 2 end state, which the walk produces).
- Teammate Pull Requests in the fork, and the GitHub web UI screenshots taken from them over CDP.
- The six lab steps that still describe GitHub screens in words.

---

## How to resume

```bash
cd C:/git/sfdx-hardis-training
git pull

# the fiction is consistent and nothing generated has drifted
node scripts/build/universe.mjs --check

# every link resolves
node scripts/verify/check-links.mjs

# the site builds and resolves its assets
node scripts/build/site.mjs && python -m zensical build && node scripts/verify/check-site.mjs

# where a learner repository stands
node scripts/verify/check.mjs --level 1
node scripts/verify/audit.mjs --level 2 --dir <a clone> --handle nvuillam
```

Screenshots, from the extension repository (Windows, needs an unlocked desktop):

```bash
cd C:/git/sfdx-hardis-training && node scripts/build/mocks.mjs
cd ../vscode-sfdx-hardis && yarn dev && yarn compile
SF_MOCK_UNIVERSE=helios \
SFDX_HARDIS_DOC_SCREENSHOTS_DIR=../sfdx-hardis-training/labs/_assets/vscode \
yarn screenshots [names]
```

And prove the product images did not move:

```bash
yarn screenshots && git status --porcelain doc-screenshots   # must be empty
```

---

## Things that will bite you

- **An org answers to several aliases.** `sf org list` reports only one. `helios-integration` is also
  aliased `integration` because the CI login names orgs after their branch. `connectedOrgs()` in
  `scripts/lib/util.mjs` now reads `sf alias list` and keeps them all; do not regress that.
- **Formatters versus generators.** Prettier collapses JSON arrays that `JSON.stringify` expands, and
  MegaLinter's table formatter realigns the tables `universe.mjs` writes. Both are excluded now
  (`.prettierignore` in the extension, `FILTER_REGEX_EXCLUDE` in the training repo). Without those,
  the drift check fails forever.
- **Seeded failures have to be measured, not assumed.** Two of them did not fire, because `ApexDoc` is
  excluded from the sfdx-hardis PMD ruleset and `AvoidHardcodedId` does not fire at the Moderate
  threshold. Before writing a lab around a rule, run it:
  `sf code-analyzer run --workspace . --severity-threshold Moderate --config-file ./code-analyzer.yml --rule-selector pmd:SfdxHardis --view table`
- **Never edit a generated file.** `BACKLOG.md`, `labs/link-map.en.md`, `training-manifest.json`,
  `MY-PIPELINE.template.md`, `mkdocs-nav.yml`, `site-src/`, and the Helios fixtures in the extension
  repo. Change the source and re-run the generator.
- **A browser DOM check lies about images.** Below-the-fold images are lazy-loaded, so they read as
  broken. `scripts/verify/check-site.mjs` resolves references on disk instead.
- **commitlint crashes** on this machine (`yargs_1.default.options is not a function`). Pre-existing,
  unrelated, and it does not stop the commit.

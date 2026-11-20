# Backpromote (Beta) e2e - GitHub - 2026-11-08 (runbook section 6bis only)

Branch under test: sfdx-hardis `feat/browser-deployment-action` (#2461, which carries main with the
backpromote v3 work), repository `nvuillam/sfdx-hardis-promo-e2e-61` (new, built by `build-repo.sh`),
developer scratch orgs `promo-e2e-dev` / `promo-e2e-dev2` from the Dev Hub `DevHub`, the job simulators
of `e2e-lib.sh` for the merges.

**Result: 63 OK, 0 FAIL.** Setup and steps B0 to B16, comment checks C1 to C4, on the first try.

This run covers section 6bis alone: the full promotion branches run (sections 3 to 7ter) was not
replayed, so `promotion-branches-e2e-report-github.md` stays the report of the last full run.

Not covered, as in every run: B17 (terminal prompts, by hand only), `refused-production.json` (needs a
real production org), the VS Code Backpromote panel (not clicked; it reads the same `--json` documents).

## Steps


### B0 no git provider token

- `B0-plan` OK: ALL CHECKS PASSED
- `B0-run` OK: exit=1

### B1 org of a major branch

- `B1-plan` OK: ALL CHECKS PASSED

### B1c parent branch not allowed

- `B1c-plan` OK: ALL CHECKS PASSED

### B2 Developer Edition org: accepted as a dev environment

- `B2-plan` OK: ALL CHECKS PASSED

### B3 first plan: no history, then the window from S1

- `B3-plan-first` OK: ALL CHECKS PASSED
- `B3-plan-s1` OK: ALL CHECKS PASSED
- `B3-progress` OK: 13 progress lines
- `B3-read-only` OK: still on feature/E2E-401-dev, clean tree

### B4 run from S1: S1 to S3 deployed with their actions

- `B4-result` OK: ALL CHECKS PASSED
- `B4-org` OK: resources: E2E_S1,E2E_S2,E2E_S3
- `B4-actions` OK: pre and post actions ran (C:/Users/33614/AppData/Local/Temp/promo-e2e-bp-github/hardis-report/commands/2026-11-08T04-16-35-hardis-work-backpromote.log)
- `B4-checkout` OK: checkout on backpromote/integration/devorg1
- `B4-not-pushed` OK: no manual merge: the branch is not on origin
- `C1-comments` OK: ALL CHECKS PASSED

### B5 up to date, then the manual action confirmed

- `B5-plan` OK: ALL CHECKS PASSED
- `B5-confirm` OK: ALL CHECKS PASSED
- `C2-comments` OK: ALL CHECKS PASSED

### B6 a new story: the default start

- `B6-plan` OK: ALL CHECKS PASSED
- `B6-result` OK: ALL CHECKS PASSED
- `B6-org` OK: resources: E2E_S1,E2E_S2,E2E_S3,E2E_S4

### B7 a file that differs: overwrite with the parent branch version

- `B7-plan` OK: ALL CHECKS PASSED
- `B7-result` OK: ALL CHECKS PASSED
- `B7-org` OK: org body: git version of S2

### B8 keep the org version, then the item comes back

- `B8-result` OK: ALL CHECKS PASSED
- `B8-org-kept` OK: org body: org version of S3
- `C3-comments` OK: ALL CHECKS PASSED
- `B8-plan-left-out` OK: ALL CHECKS PASSED
- `B8-result-2` OK: ALL CHECKS PASSED
- `B8-org-overwritten` OK: org body: git version of S3

### B9 agent mode: a merge by hand stops the run, then continues

- `B9-waiting` OK: ALL CHECKS PASSED
- `B9-markers` OK: three-way markers in force-app/main/default/staticresources/E2E_S1.resource
- `B9-prompt` OK: coding agent prompt saved
- `B9-done` OK: ALL CHECKS PASSED
- `B9-org` OK: org body: org line of S1|git line of S1
- `B9-pushed` OK: chore(sfdx-hardis): backpromote merges for devorg1 from integration

### B10 panel protocol: prepare, refuse while markers remain, then run

- `B10-prepare` OK: ALL CHECKS PASSED
- `B10-refused` OK: ALL CHECKS PASSED
- `B10-nothing-deployed` OK: org body untouched: org line of S2
- `B10-result` OK: ALL CHECKS PASSED
- `B10-org` OK: org body: org line of S2|git line of S2

### B11 a deletion: skipped, then applied on a redeploy

- `B11-plan` OK: ALL CHECKS PASSED
- `B11-skipped` OK: ALL CHECKS PASSED
- `B11-org-kept` OK: S4 kept: E2E_S1,E2E_S2,E2E_S3,E2E_S4
- `B11-deleted` OK: ALL CHECKS PASSED
- `B11-org-deleted` OK: S4 deleted: E2E_S1,E2E_S2,E2E_S3

### B12 an item left out comes back in the next plan

- `B12-result` OK: ALL CHECKS PASSED
- `B12-org` OK: S6 not deployed: E2E_S1,E2E_S2,E2E_S3,E2E_S5
- `B12-plan` OK: ALL CHECKS PASSED
- `B12-result-2` OK: ALL CHECKS PASSED
- `B12-org-2` OK: S6 deployed: E2E_S1,E2E_S2,E2E_S3,E2E_S5,E2E_S6

### B13 dirty working tree on the developer branch: stashed

- `B13-plan` OK: ALL CHECKS PASSED
- `B13-result` OK: ALL CHECKS PASSED
- `B13-stash` OK: stash@{0}: On feature/E2E-401-dev: sfdx-hardis backpromote mw7ck4bqyppc from feature/E2E-401-dev
- `B13-checkout` OK: on backpromote/integration/devorg1, clean
- `B13-back` OK: back on feature/E2E-401-dev with the stash popped

### B14 a refreshed sandbox: same name, another org id

- `B14-plan` OK: ALL CHECKS PASSED
- `B14-result` OK: ALL CHECKS PASSED
- `B14-org` OK: resources: E2E_S1,E2E_S2,E2E_S3,E2E_S5,E2E_S6,E2E_S7
- `C4-comments` OK: ALL CHECKS PASSED

### B15 scan limit

- `B15-plan` OK: ALL CHECKS PASSED

### B16 reset the backpromote branch

- `B16-reset` OK: ALL CHECKS PASSED
- `B16-deleted` OK: backpromote/integration/devorg1 deleted on origin

### summary


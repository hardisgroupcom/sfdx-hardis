#!/usr/bin/env bash
# Runbook section 6quinquies: the deployment action features through REAL CI jobs (GitHub Actions,
# GitLab CI, Azure Pipelines or Bitbucket Pipelines), in a repository of its own. The jobs run sfdx-hardis built from the branch under test
# (a step links it with `sf plugins link`), and log in with SFDX_AUTH_URL_<BRANCH> secrets or CI/CD
# variables.
#
#   export PROVIDER=github|gitlab|azure|bitbucket   # default github
#   # Everything else is optional: read from the environment, else from the .env of the sfdx-hardis
#   # working copy (reference/env.example), else derived (env-lib.sh): ORG from E2E_ORG, DEV and
#   # EXT from the working copy, WORK and LOGS under the OS temp dir (promo-e2e-ci-<provider>[-logs],
#   # WORK must not exist yet), the repository name picked one past the highest of its owner:
#   # GitHub REPO (GH_E2E_OWNER/sfdx-hardis-promo-e2e-ci-<n>), GitLab GITLAB_E2E_HOST and
#   # GITLAB_E2E_GROUP, Azure AZ_ORG AZ_PROJECT AZURE_PERSONAL_ACCESS_TOKEN, Bitbucket BB_WORKSPACE
#   # BB_PROJECT_KEY ATLASSIAN_TOKEN ATLASSIAN_EMAIL (see ci-provider-<provider>.sh)
#   export SFDX_HARDIS_BRANCH=<branch>         # pushed to hardisgroupcom/sfdx-hardis; default: current
#   export SFDX_HARDIS_IMAGE=ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:beta   # optional, see below
#   export SFDX_HARDIS_VERSION=<version>       # with SFDX_HARDIS_BRANCH=-: the version W0 expects
#
# SFDX_HARDIS_BRANCH=- with SFDX_HARDIS_IMAGE: no link step, the jobs run the release of that image
# (a published beta for instance), and W0 asserts the version it prints.
#   bash ci-workflows-run.sh
#
#   W0  the jobs run the linked branch, not the image release
#   W1  the validation of a story stops on its pending pre-deployment manual action
#   W2  ticking its checkbox in the Pull Request comment, then re-running the job, makes it pass
#   W3  a real draft Pull Request (the provider's draft) is only warned
#   W4  the deployment job after the merge: the flaky post-deployment command fails, stops the next
#   W5  a promotion to uat: its validation stops until the manual action is marked as done in uat,
#       the forecast says after the merge for the post-deployment manual step
#   W6  marked as done with set-status (the Mark as done button), the validation re-run passes
#   W7  the deployment of the promotion runs the commands (the fix travelled with it)
#   W8  a workflow without the safe.directory line: the job stops and names the line to add (GitHub)
#   W9  two stories with the same action: each merge into integration runs its own, the deployment
#       of the promotion carrying both runs it once and records the second as done by the first
#   X1  the single Pull Request modal of the extension shows what the provider holds (check-pr-modal)
#   X2  the DevOps Pipeline of the extension shows the stories in uat, no open promotion
#
# The provider side (create the repository, wait for a job, re-run it, tick a checkbox...) is in
# ci-provider-<provider>.sh: a new provider adds that file and a writer in ci-workflows-prepare.cjs.
# A job the provider could not run for real (Bitbucket once its build minutes are used up) runs
# through the job simulator instead: $LOGS/<label>.mode says "real CI" or why it was simulated, and
# every result line carries it. $LOGS/ci-jobs.tsv lists each job: label, provider, mode, run id,
# result, seconds queued, seconds run (and build minutes on Bitbucket).
#
# Prints one line per assertion and writes $LOGS/results-section6quinquies.txt.
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PROVIDER="${PROVIDER:-github}"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/env-lib.sh"
e2e_defaults "promo-e2e-ci-$PROVIDER"
SFDX_HARDIS_ROOT="$E2E_ROOT"
: "${ORG:?set ORG or E2E_ORG (environment or .env) to the Salesforce org}" "${WORK:?}" "${LOGS:?}" "${DEV:?}"
SFDX_HARDIS_BRANCH="${SFDX_HARDIS_BRANCH:-$(git -C "$SFDX_HARDIS_ROOT" branch --show-current)}"
if [ ! -f "$SCRIPTS_DIR/ci-provider-$PROVIDER.sh" ]; then
  echo "real CI is not built for PROVIDER=$PROVIDER (github, gitlab, azure, bitbucket)"
  exit 2
fi
if [ -e "$WORK" ]; then
  echo "$WORK already exists: a run starts from a new folder (remove it, or set WORK and LOGS)"
  exit 2
fi
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/ci-provider-$PROVIDER.sh"
mkdir -p "$LOGS"
ci_provider_init || exit 1
RESULTS="$LOGS/results-section6quinquies.txt"
: >"$RESULTS"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/section-lib.sh"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/stories.sh"
BODIES="$(cygpath -m "$LOGS" 2>/dev/null || echo "$LOGS")/bodies"
mkdir -p "$BODIES"
: >"$LOGS/ci-vars.sh"
printf 'label\tprovider\tmode\trun\tresult\tqueued_s\tran_s\tbuild_minutes\n' >"$LOGS/ci-jobs.tsv"

step() { echo "[$(date +%T)] $*"; }
head_sha() { git -C "$WORK" rev-parse "$1"; }
# Tick the checkbox of a manual action in a comment body saved to a file; writes <file>.json with
# {<key>: body}. Used by every ci_tick_manual_checkbox.
# Usage: ci_tick_in_file <file> <action id> <org branch> <json key>
ci_tick_in_file() {
  node -e '
const fs = require("fs");
const [file, action, org, key] = process.argv.slice(1);
const marker = "<!-- sfdx-hardis-manual-action id:" + action + " org:" + org + " ";
const body = fs.readFileSync(file, "utf8").split("- [ ] " + marker).join("- [x] " + marker);
fs.writeFileSync(file + ".json", JSON.stringify({ [key]: body }));' "$(cygpath -m "$1" 2>/dev/null || echo "$1")" "$2" "$3" "$4"
}
job_promote() {
  p_promote "$@"
  echo $? >"$LOGS/$3.code"
}

# ------------------------------------------------------------------ the repository
step "build the repository ($PROVIDER), CI linking sfdx-hardis $SFDX_HARDIS_BRANCH"
WORK="$WORK" API="${API:-67.0}" bash "$SCRIPTS_DIR/build-repo.sh" >"$LOGS/build.log" 2>&1 || {
  echo "build failed"
  exit 1
}
cd "$WORK" || exit 1
# The login of a CI job needs the org of each branch in its config: the simulators pass --target-org
env -u NODE_OPTIONS sf org display --target-org "$ORG" --verbose --json >"$LOGS/org-display.json" 2>/dev/null
org_field() { node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).result[process.argv[2]]||'')" "$(cygpath -m "$LOGS/org-display.json" 2>/dev/null || echo "$LOGS/org-display.json")" "$1"; }
# Not the sfdxAuthUrl of `sf org display --verbose`: recent CLIs redact it there
AUTH_URL=$(env -u NODE_OPTIONS sf org auth show-sfdx-auth-url --target-org "$ORG" --json 2>/dev/null | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).result?.sfdxAuthUrl||'')")
case "$AUTH_URL" in force://*) ;; *)
  echo "no sfdx auth URL for $ORG"
  exit 1
  ;;
esac
for f in config/branches/.sfdx-hardis.*.yml; do
  printf 'targetUsername: %s\ninstanceUrl: %s\n' "$(org_field username)" "$(org_field instanceUrl)" >>"$f"
done
# W1, W5 and W6 test the manual action gate, off by default
grep -q "^failValidationOnPendingManualActions:" config/.sfdx-hardis.yml || printf 'failValidationOnPendingManualActions: true\n' >>config/.sfdx-hardis.yml
node "$SCRIPTS_DIR/ci-workflows-prepare.cjs" --provider "$PROVIDER" "$SFDX_HARDIS_ROOT" "$(cygpath -m "$WORK" 2>/dev/null || echo "$WORK")" "$SFDX_HARDIS_BRANCH" >>"$LOGS/build.log" || exit 1
git add -A && git commit -qm "chore: base project" >/dev/null
ci_create_remote "$AUTH_URL" || exit 1
# The job simulator library of the provider (p_open, p_merge, p_promote, p_cli...), now that the
# repository exists: the GitLab one needs PROJECT_ID
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/promotion-provider.sh"
step "repository ready"

# ------------------------------------------------------------------ W1 W2: the gate
cat >"$BODIES/c1.md" <<'MD'
CI story C1: a pre-deployment manual step, a post-deployment command failing until e2e-recovery-ok.txt exists, the command after it, a post-deployment manual step.
MD
story_branch feature/E2E-501-ci-gate integration E2E_C1 >/dev/null 2>&1
C1=$(p_open feature/E2E-501-ci-gate integration "E2E-501 C1 gate in CI" "$BODIES/c1.md") || exit 1
story_actions feature/E2E-501-ci-gate "$C1" recovery >/dev/null 2>&1
printf 'export C1="%s"\n' "$C1" >>"$LOGS/ci-vars.sh"
step "C1=#$C1"
ci_wait_check "$C1" "$(head_sha feature/E2E-501-ci-gate)" ci-check-c1
if grep -q "^simulated" "$LOGS/ci-check-c1.mode" 2>/dev/null; then
  record W0 SKIP "ci-check-c1 did not run in CI ($(cat "$LOGS/ci-check-c1.mode")): the linked branch is not proven"
elif [ "$SFDX_HARDIS_BRANCH" = "-" ]; then
  assert_log W0 ci-check-c1 - "the job runs sfdx-hardis ${SFDX_HARDIS_VERSION:-?} of ${SFDX_HARDIS_IMAGE:-the default image}" "sfdx-hardis .{0,12}${SFDX_HARDIS_VERSION:-NO_VERSION_GIVEN}" "!\(link\)"
else
  assert_log W0 ci-check-c1 - "the job runs sfdx-hardis linked from $SFDX_HARDIS_BRANCH" "sf plugins link /tmp/sfdx-hardis" "sfdx-hardis .*\(link\)"
fi
assert_log W1 ci-check-c1 1 "the validation stops on the pending pre-deployment manual action" \
  "1 pre-deployment manual action\(s\) not marked as performed in integration" "E2E pre-deploy manual of PR $C1" "!Deployment mode:"
ci_pr_comments "$C1" ci-comments-c1-gate
assert_log W1b ci-comments-c1-gate - "the Pull Request comment says why and lists the checkbox" \
  "Manual actions to perform before the merge" "sfdx-hardis-manual-action id:e2e-gate-$C1 org:integration"
ci_tick_manual_checkbox "$C1" "e2e-gate-$C1" integration >"$LOGS/ci-tick-c1.log" 2>&1
ci_rerun ci-check-c1-rerun ci-check-c1
assert_log W2 ci-check-c1-rerun 0 "ticked in the comment, the re-run records it as done and goes on" \
  "E2E pre-deploy manual of PR $C1" "!not marked as performed in integration"

# ------------------------------------------------------------------ W3: a real draft
# A provider with few CI minutes (CI_DRAFT_LATE=yes) runs it after W4, so the gate, the checkbox and
# the deployment after a merge, which only real CI proves, get the minutes first
w3_draft() {
  cat >"$BODIES/c2.md" <<'MD'
CI story C2, opened as a draft of the git provider. The validation must read the draft state from the provider.
MD
  story_branch feature/E2E-502-ci-wip integration E2E_C2 >/dev/null 2>&1
  C2=$(ci_open_draft feature/E2E-502-ci-wip integration "E2E-502 C2 work in progress" "$BODIES/c2.md")
  story_actions feature/E2E-502-ci-wip "$C2" pre-manual >/dev/null 2>&1
  printf 'export C2="%s"\n' "$C2" >>"$LOGS/ci-vars.sh"
  if ci_is_draft "$C2"; then record W3a OK "#$C2 is a draft for the provider"; else record W3a FAIL "#$C2 is not a draft for the provider"; fi
  ci_wait_check "$C2" "$(head_sha feature/E2E-502-ci-wip)" ci-check-c2-draft
  assert_log W3 ci-check-c2-draft 0 "$CI_DRAFT_DESC" "the Pull Request is a draft, so the validation goes on"
  p_close "$C2" >/dev/null 2>&1
}
[ "${CI_DRAFT_LATE:-}" = "yes" ] || w3_draft

# ------------------------------------------------------------------ W4: the deployment job
p_merge "$C1" >/dev/null || record "merge-$C1" FAIL "merge of #$C1"
ci_wait_deploy integration "$(ci_merge_sha "$C1")" ci-deploy-integration-c1
assert_log W4 ci-deploy-integration-c1 1 "the flaky command fails and stops the ones after it, the manual action done is skipped" \
  "Skipping E2E pre-deploy manual of PR $C1 .*already run in integration" "Action E2E flaky post-deploy of PR $C1 failed, stopping execution of further actions"
status_check W4b ci-status-c1-integration "statuses recorded by the deployment job" "--pr-ids $C1" \
  "S:$C1:e2e-gate-$C1:integration=success" "S:$C1:e2e-flaky-$C1:integration=failed" \
  "S:$C1:e2e-after-flaky-$C1:integration=not-run" "S:$C1:e2e-manual-$C1:integration=not-run"

# ------------------------------------------------------------------ the fix travels with a story
cat >"$BODIES/c3.md" <<'MD'
CI story C3: the fix of the flaky command of C1 (the file it looks for).
MD
story_branch feature/E2E-503-ci-fix integration E2E_C3 >/dev/null 2>&1
echo ok >e2e-recovery-ok.txt
git add e2e-recovery-ok.txt && git commit -qm "fix: what the flaky command of C1 needs" && git push -q origin feature/E2E-503-ci-fix
C3=$(p_open feature/E2E-503-ci-fix integration "E2E-503 C3 fix" "$BODIES/c3.md") || exit 1
printf 'export C3="%s"\n' "$C3" >>"$LOGS/ci-vars.sh"
ci_wait_check "$C3" "$(head_sha feature/E2E-503-ci-fix)" ci-check-c3
p_merge "$C3" >/dev/null || record "merge-$C3" FAIL "merge of #$C3"
ci_wait_deploy integration "$(ci_merge_sha "$C3")" ci-deploy-integration-c3
assert_log W4c ci-deploy-integration-c3 0 "the fix story deploys" "!failed, stopping execution"
if [ "${CI_DRAFT_LATE:-}" = "yes" ]; then w3_draft; fi

# ------------------------------------------------------------------ W5 W6 W7: the promotion
job_promote integration "$C1,$C3" ci-promotion-integration-uat
P1=$(promo_number ci-promotion-integration-uat)
printf 'export CP1="%s"\n' "$P1" >>"$LOGS/ci-vars.sh"
step "promotion #$P1"
ci_wait_check "$P1" "$(ci_pr_head_sha "$P1")" ci-check-promotion-uat
assert_log W5 ci-check-promotion-uat 1 "the validation of the promotion stops until the manual action is done in uat" \
  "not marked as performed in uat" "E2E pre-deploy manual of PR $C1"
status_check W5b ci-forecast-uat "forecast of the promotion: waiting before the merge, after the merge, at deployment" \
  "--pr-ids $C1 --forecast uat --from-branch integration" \
  "P=$P1" "C:$C1=yes" "F:$C1:e2e-gate-$C1=waiting/manual-before-merge" \
  "F:$C1:e2e-flaky-$C1=runs-at-deployment/deploy-only" "F:$C1:e2e-manual-$C1=after-merge/manual-after-merge"
cli ci-set-status-uat integration hardis:project:action:set-status --agent --pr "$C1" --action-id "e2e-gate-$C1" --org-branch uat --target-org "$ORG"
assert_log W6 ci-set-status-uat 0 "set-status marks it as done in uat (what the Mark as done in uat button runs)" "E2E pre-deploy manual of PR $C1"
ci_rerun ci-check-promotion-uat-rerun ci-check-promotion-uat
assert_log W6b ci-check-promotion-uat-rerun 0 "the validation re-run skips it and passes" \
  "Skipping E2E pre-deploy manual of PR $C1 .*already run in uat" "!not marked as performed in uat"
status_check W6c ci-forecast-uat-done "forecast once marked: done" "--pr-ids $C1 --forecast uat --from-branch integration" \
  "F:$C1:e2e-gate-$C1=done" "F:$C1:e2e-manual-$C1=after-merge/manual-after-merge"
p_merge "$P1" >/dev/null || record "merge-$P1" FAIL "merge of #$P1"
ci_wait_deploy uat "$(ci_merge_sha "$P1")" ci-deploy-uat-promotion
assert_log W7 ci-deploy-uat-promotion 0 "the deployment of the promotion runs the commands, the fix travelled with it" \
  "Skipping E2E pre-deploy manual of PR $C1 .*already run in uat" "Running action E2E flaky post-deploy of PR $C1" "!failed, stopping execution"
status_check W7b ci-status-c1-uat "statuses in uat after the promotion" "--pr-ids $C1" \
  "S:$C1:e2e-flaky-$C1:uat=success" "S:$C1:e2e-after-flaky-$C1:uat=success" "S:$C1:e2e-manual-$C1:uat=manual"

# ------------------------------------------------------------------ W8: CI files without safe.directory
# For a pull_request event GitHub runs the workflow of the Pull Request: this one removes the line, as
# a project that copied the templates before it existed has it
if [ -n "$CI_SAFE_DIRECTORY_FILES" ]; then
  git checkout -q -f integration && git pull -q origin integration
  git checkout -q -B feature/E2E-504-no-safe-dir
  # shellcheck disable=SC2086 # a list of files on purpose
  sed -i '/safe.directory/d' $CI_SAFE_DIRECTORY_FILES
  story_resource=force-app/main/default/staticresources/E2E_C4
  printf 'workflow without safe.directory\n' >"$story_resource.resource"
  cat >"$story_resource.resource-meta.xml" <<'META'
<?xml version="1.0" encoding="UTF-8"?>
<StaticResource xmlns="http://soap.sforce.com/2006/04/metadata">
    <cacheControl>Public</cacheControl>
    <contentType>text/plain</contentType>
</StaticResource>
META
  # shellcheck disable=SC2086
  git add $CI_SAFE_DIRECTORY_FILES "$story_resource.resource" "$story_resource.resource-meta.xml"
  git commit -qm "test: CI files without safe.directory" && git push -q -u origin feature/E2E-504-no-safe-dir
  printf 'CI files without the safe.directory line: the job must stop and name the line to add.\n' >"$BODIES/c4.md"
  C4=$(p_open feature/E2E-504-no-safe-dir integration "E2E-504 C4 no safe.directory" "$BODIES/c4.md") || exit 1
  ci_wait_check "$C4" "$(head_sha feature/E2E-504-no-safe-dir)" ci-check-no-safe-dir
  assert_log W8 ci-check-no-safe-dir 1 "git refuses the checkout: the job stops and names the line to add" \
    "Git refuses this repository \(detected dubious ownership\)" "$CI_SAFE_DIRECTORY_HINT"
  p_close "$C4" >/dev/null 2>&1
else
  record W8 SKIP "$CI_SAFE_DIRECTORY_SKIP"
fi

# ------------------------------------------------------------------ W9: identical actions in a real job
# Two stories carrying the same post-deployment command (sfdx-hardis#2271). Each merge into integration
# is a job of its own, so each runs its copy; the promotion carrying both to uat is one job, which runs
# it once and records the second as done by the first
step "W9: identical actions"
for kind_story in "505-ci-shared-a:E2E_C5" "506-ci-shared-b:E2E_C6"; do
  slug="${kind_story%%:*}"
  resource="${kind_story##*:}"
  printf 'CI story %s: the shared post-deployment step of section 6sexies.\n' "$resource" >"$BODIES/$resource.md"
  number=$(open_story "feature/E2E-$slug" integration "$resource" "E2E-$slug $resource shared step" "$BODIES/$resource.md" identical) || exit 1
  printf 'export %s="%s"\n' "${resource#E2E_}" "$number" >>"$LOGS/ci-vars.sh"
done
# shellcheck source=/dev/null
source "$LOGS/ci-vars.sh"
step "C5=#$C5 C6=#$C6"
# The validations prove the provider knows the head with the actions file before the merge takes it
ci_wait_check "$C5" "$(head_sha feature/E2E-505-ci-shared-a)" ci-check-c5
ci_wait_check "$C6" "$(head_sha feature/E2E-506-ci-shared-b)" ci-check-c6
p_merge "$C5" >/dev/null || record "merge-$C5" FAIL "merge of #$C5"
ci_wait_deploy integration "$(ci_merge_sha "$C5")" ci-deploy-integration-c5
p_merge "$C6" >/dev/null || record "merge-$C6" FAIL "merge of #$C6"
ci_wait_deploy integration "$(ci_merge_sha "$C6")" ci-deploy-integration-c6
assert_log W9a ci-deploy-integration-c6 0 "the merge of #$C6 is a job of its own: its shared step runs there" \
  "Running action E2E shared step of PR $C6 \(from PR #$C6\)" "!same action as"
job_promote integration "$C5,$C6" ci-promotion-identical-uat
CP2=$(promo_number ci-promotion-identical-uat)
printf 'export CP2="%s"\n' "$CP2" >>"$LOGS/ci-vars.sh"
step "promotion #$CP2"
ci_wait_check "$CP2" "$(ci_pr_head_sha "$CP2")" ci-check-promotion-identical
p_merge "$CP2" >/dev/null || record "merge-$CP2" FAIL "merge of #$CP2"
ci_wait_deploy uat "$(ci_merge_sha "$CP2")" ci-deploy-uat-identical
assert_log W9 ci-deploy-uat-identical 0 "the deployment of the promotion runs the shared step once and records the second as done by the first" \
  "Running action E2E shared step of PR $C5 \(from PR #$C5\)" \
  "Skipping action E2E shared step of PR $C6 \(from PR #$C6\): same action as E2E shared step of PR $C5 \(#$C5\), run once for this deployment" \
  "!Running action E2E shared step of PR $C6 "
status_check W9b ci-status-identical-uat "the copy is done in uat, with the note naming the action that ran" "--pr-ids $C5,$C6" \
  "S:$C5:e2e-shared-$C5:uat=success" "S:$C6:e2e-shared-$C6:uat=success" \
  "N:$C6:e2e-shared-$C6:uat~Not run twice: the identical action \"E2E shared step of PR $C5\" of #$C5"

# ------------------------------------------------------------------ X1 X2: what the extension shows
# The comments of this repository come from real jobs: the modal tabs and the pipeline must show them
step "extension checks"
p_pr_modal_check --json "$(cygpath -m "$LOGS" 2>/dev/null || echo "$LOGS")/ci-pr-modal.json" >"$LOGS/ci-pr-modal.log" 2>&1
echo $? >"$LOGS/ci-pr-modal.code"
assert_log X1 ci-pr-modal 0 "the single Pull Request modal tabs show the comments of the real jobs, merged Pull Requests included"
cat >"$LOGS/ci-pipeline-expect.json" <<JSON
{
  "label": "end of the real CI section",
  "windows": { "integration": [], "uat": [$C1, $C3, $C5, $C6] },
  "arrows": { "integration>uat": null, "uat>preprod": null }
}
JSON
pipeline_check ci-pipeline "$(cygpath -m "$LOGS/ci-pipeline-expect.json" 2>/dev/null || echo "$LOGS/ci-pipeline-expect.json")" >/dev/null
echo $? >"$LOGS/ci-pipeline.code"
assert_log X2 ci-pipeline 0 "the DevOps Pipeline lists C1, C3, C5 and C6 in uat, nothing in integration, no open promotion"

echo
echo "=== section 6quinquies summary ($PROVIDER) ==="
echo "$(grep -c '| OK |' "$RESULTS") OK"
echo "$(grep -c '| FAIL |' "$RESULTS") FAIL"
echo "$(grep -c '| SKIP |' "$RESULTS") SKIP"
echo "$(cut -f3 "$LOGS/ci-jobs.tsv" | grep -c '^real CI$') jobs in real CI, $(cut -f3 "$LOGS/ci-jobs.tsv" | grep -c '^simulated') simulated ($LOGS/ci-jobs.tsv)"
if [ -f "$LOGS/bb-minutes-gone" ]; then echo "simulated from then on because: $(cat "$LOGS/bb-minutes-gone")"; fi
grep "| FAIL |" "$RESULTS" || true
echo "SECTION 6QUINQUIES DONE"

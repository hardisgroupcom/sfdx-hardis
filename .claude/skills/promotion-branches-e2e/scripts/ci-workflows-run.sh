#!/usr/bin/env bash
# Runbook section 6quinquies: the deployment action features through REAL GitHub Actions workflows,
# in a repository of its own. The jobs run sfdx-hardis built from the branch under test (a step
# links it with `sf plugins link`), and log in with SFDX_AUTH_URL_<BRANCH> secrets.
#
#   export ORG REPO WORK LOGS DEV API          # REPO, WORK and LOGS NEW, not the ones of section 4
#   export SFDX_HARDIS_BRANCH=<branch>         # pushed to hardisgroupcom/sfdx-hardis; default: current
#   bash ci-workflows-run.sh
#
#   W0  the workflows run the linked branch, not the image release
#   W1  the validation of a story stops on its pending pre-deployment manual action
#   W2  ticking its checkbox in the Pull Request comment, then re-running the job, makes it pass
#   W3  a real draft Pull Request (GitHub draft flag, no "draft" in the title) is only warned
#   W4  the deployment job after the merge: the flaky post-deployment command fails, stops the next
#   W5  a promotion to uat: its validation stops until the manual action is marked as done in uat,
#       the forecast says after the merge for the post-deployment manual step
#   W6  marked as done with set-status (the Mark as done button), the validation re-run passes
#   W7  the deployment of the promotion runs the commands (the fix travelled with it)
#
# Prints one line per assertion and writes $LOGS/results-section6quinquies.txt.
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SFDX_HARDIS_ROOT="$(cd "$SCRIPTS_DIR/../../../.." && pwd)"
export PROVIDER=github
: "${ORG:?}" "${REPO:?}" "${WORK:?}" "${LOGS:?}" "${DEV:?}"
SFDX_HARDIS_BRANCH="${SFDX_HARDIS_BRANCH:-$(git -C "$SFDX_HARDIS_ROOT" branch --show-current)}"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/promotion-provider.sh"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/stories.sh"
mkdir -p "$LOGS"
RESULTS="$LOGS/results-section6quinquies.txt"
: >"$RESULTS"
CHECKER="$(cygpath -m "$SCRIPTS_DIR/check-action-status.cjs" 2>/dev/null || echo "$SCRIPTS_DIR/check-action-status.cjs")"
BODIES="$(cygpath -m "$LOGS" 2>/dev/null || echo "$LOGS")/bodies"
mkdir -p "$BODIES"

record() { echo "$1 | $2 | $3" | tee -a "$RESULTS"; }
step() { echo "[$(date +%T)] $*"; }
# Usage: assert_log <id> <label> <expected exit or -> <description> <pattern>... ; ! = must NOT match
assert_log() {
  local id="$1" label="$2" want="$3" desc="$4" problems="" pat code
  shift 4
  code=$(tail -1 "$LOGS/$label.code" 2>/dev/null || echo "?")
  if [ "$want" != "-" ] && [ "$code" != "$want" ]; then
    problems+=" exit=$code (expected $want);"
  fi
  for pat in "$@"; do
    if [ "${pat:0:1}" = "!" ]; then
      grep -aqE -- "${pat:1}" "$LOGS/$label.log" && problems+=" unexpected [${pat:1}];"
    else
      grep -aqE -- "$pat" "$LOGS/$label.log" || problems+=" missing [$pat];"
    fi
  done
  if [ -z "$problems" ]; then record "$id" OK "$label: $desc"; else record "$id" FAIL "$label: $desc:$problems"; fi
}
# The latest run of a workflow for a commit, waited for until it completes. Its log goes to
# $LOGS/<label>.log, 0 or 1 to $LOGS/<label>.code
# Usage: wait_workflow <workflow file> <sha> <label>
wait_workflow() {
  local wf="$1" sha="$2" label="$3" id=""
  for _ in $(seq 1 60); do
    id=$(gh run list -R "$REPO" --workflow "$wf" --commit "$sha" -L 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)
    [ -n "$id" ] && break
    sleep 10
  done
  if [ -z "$id" ]; then
    echo "no $wf run for $sha" >"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    return 1
  fi
  echo "$id" >"$LOGS/$label.run"
  wait_run_id "$id" "$label"
}
wait_run_id() {
  local id="$1" label="$2" status conclusion
  for _ in $(seq 1 180); do
    status=$(gh run view "$id" -R "$REPO" --json status --jq .status 2>/dev/null)
    [ "$status" = "completed" ] && break
    sleep 20
  done
  conclusion=$(gh run view "$id" -R "$REPO" --json conclusion --jq .conclusion 2>/dev/null)
  gh run view "$id" -R "$REPO" --log >"$LOGS/$label.log" 2>&1
  [ "$conclusion" = "success" ] && echo 0 >"$LOGS/$label.code" || echo 1 >"$LOGS/$label.code"
  step "$label: run $id $conclusion"
}
# Re-run every job of a completed run, the way "Re-run all jobs" does, and wait for it
rerun_workflow() {
  local label="$1" from="$2" id
  id=$(cat "$LOGS/$from.run")
  gh run rerun "$id" -R "$REPO" >/dev/null 2>&1 || { echo 9 >"$LOGS/$label.code"; return 1; }
  sleep 15
  wait_run_id "$id" "$label"
}
# An sfdx-hardis command run by a person, on a branch of the working copy
cli() {
  local label="$1" branch="$2"
  shift 2
  cd "$WORK" || return 1
  git checkout -q -f "$branch" && git pull -q origin "$branch"
  p_cli "$@" >"$LOGS/$label.log" 2>&1
  echo $? >"$LOGS/$label.code"
}
status_check() {
  local id="$1" label="$2" desc="$3" flags="$4" out
  shift 4
  cd "$WORK" || return 1
  git checkout -q -f integration && git pull -q origin integration
  # shellcheck disable=SC2086 # the flags are a list on purpose
  p_cli hardis:project:action:list --with-status $flags --json >"$LOGS/$label.json" 2>"$LOGS/$label.err"
  if out=$(node "$CHECKER" "$(cygpath -m "$LOGS/$label.json" 2>/dev/null || echo "$LOGS/$label.json")" "$@" 2>&1); then
    record "$id" OK "$label: $desc"
  else
    record "$id" FAIL "$label: $desc: $(echo "$out" | grep -E '^FAIL' | tr '\n' ';')"
  fi
  echo "$out" >"$LOGS/$label.check"
}
# Tick, in every comment of a Pull Request, the checkbox of a manual action for an org branch
tick_manual_checkbox() {
  local pr="$1" action="$2" org="$3" ids
  ids=$(gh api "repos/$REPO/issues/$pr/comments" --paginate --jq ".[] | select(.body | contains(\"sfdx-hardis-manual-action id:$action org:$org\")) | .id")
  for cid in $ids; do
    gh api "repos/$REPO/issues/comments/$cid" --jq .body >"$LOGS/comment-$cid.md"
    node -e "
const fs=require('fs');const [file,action,org]=process.argv.slice(1);
const body=fs.readFileSync(file,'utf8').replace(new RegExp('- \\\\[ \\\\] (<!-- sfdx-hardis-manual-action id:'+action+' org:'+org+' )','g'),'- [x] \$1');
fs.writeFileSync(file+'.json',JSON.stringify({body}));" "$LOGS/comment-$cid.md" "$action" "$org"
    gh api -X PATCH "repos/$REPO/issues/comments/$cid" --input "$LOGS/comment-$cid.md.json" >/dev/null && echo "ticked in comment $cid"
  done
}
pr_comments() { gh api "repos/$REPO/issues/$1/comments" --paginate --jq '.[].body' >"$LOGS/$2.log" 2>&1; }
head_sha() { git -C "$WORK" rev-parse "$1"; }
merge_sha() { gh pr view "$1" -R "$REPO" --json mergeCommit --jq .mergeCommit.oid; }

# ------------------------------------------------------------------ the repository
step "build the repository, workflows linking sfdx-hardis $SFDX_HARDIS_BRANCH"
WORK="$WORK" API="${API:-67.0}" bash "$SCRIPTS_DIR/build-repo.sh" >"$LOGS/build.log" 2>&1 || { echo "build failed"; exit 1; }
cd "$WORK" || exit 1
# The login of a CI job needs the org of each branch in its config: the simulators pass --target-org
env -u NODE_OPTIONS sf org display --target-org "$ORG" --verbose --json >"$LOGS/org-display.json" 2>/dev/null
org_field() { node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).result[process.argv[2]]||'')" "$(cygpath -m "$LOGS/org-display.json" 2>/dev/null || echo "$LOGS/org-display.json")" "$1"; }
# Not the sfdxAuthUrl of `sf org display --verbose`: recent CLIs redact it there
AUTH_URL=$(env -u NODE_OPTIONS sf org auth show-sfdx-auth-url --target-org "$ORG" --json 2>/dev/null | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).result?.sfdxAuthUrl||'')")
case "$AUTH_URL" in force://*) ;; *) echo "no sfdx auth URL for $ORG"; exit 1 ;; esac
for f in config/branches/.sfdx-hardis.*.yml; do
  printf 'targetUsername: %s\ninstanceUrl: %s\n' "$(org_field username)" "$(org_field instanceUrl)" >>"$f"
done
node "$SCRIPTS_DIR/ci-workflows-prepare.cjs" "$SFDX_HARDIS_ROOT" "$(cygpath -m "$WORK" 2>/dev/null || echo "$WORK")" "$SFDX_HARDIS_BRANCH" >>"$LOGS/build.log" || exit 1
git add -A && git commit -qm "chore: base project" >/dev/null
# Actions off while the major branches are pushed: no deployment of the base project
gh repo create "$REPO" --private >>"$LOGS/build.log" 2>&1 || { echo "repo create failed"; exit 1; }
gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=false >/dev/null
git remote add origin "https://github.com/$REPO.git"
git push -q -u origin main
git branch preprod && git branch uat && git branch integration
git push -q origin preprod uat integration
for b in INTEGRATION UAT PREPROD MAIN; do
  printf '%s' "$AUTH_URL" | gh secret set "SFDX_AUTH_URL_$b" -R "$REPO" >/dev/null
done
gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=true -f allowed_actions=all >/dev/null
step "repository $REPO ready"

# ------------------------------------------------------------------ W1 W2: the gate
cat >"$BODIES/c1.md" <<'MD'
CI story C1: a pre-deployment manual step, a post-deployment command failing until e2e-recovery-ok.txt exists, the command after it, a post-deployment manual step.
MD
story_branch feature/E2E-501-ci-gate integration E2E_C1 >/dev/null 2>&1
C1=$(p_open feature/E2E-501-ci-gate integration "E2E-501 C1 gate in CI" "$BODIES/c1.md") || exit 1
story_actions feature/E2E-501-ci-gate "$C1" recovery >/dev/null 2>&1
printf 'export C1="%s"\n' "$C1" >"$LOGS/ci-vars.sh"
step "C1=#$C1"
wait_workflow check-deploy.yml "$(head_sha feature/E2E-501-ci-gate)" ci-check-c1
assert_log W0 ci-check-c1 - "the job runs sfdx-hardis linked from $SFDX_HARDIS_BRANCH" "sf plugins link /tmp/sfdx-hardis" "sfdx-hardis .*\(link\)"
assert_log W1 ci-check-c1 1 "the validation stops on the pending pre-deployment manual action" \
  "1 pre-deployment manual action\(s\) not marked as performed in integration" "E2E pre-deploy manual of PR $C1" "!Deployment mode:"
pr_comments "$C1" ci-comments-c1-gate
assert_log W1b ci-comments-c1-gate - "the Pull Request comment says why and lists the checkbox" \
  "Manual actions to perform before the merge" "sfdx-hardis-manual-action id:e2e-gate-$C1 org:integration"
tick_manual_checkbox "$C1" "e2e-gate-$C1" integration >"$LOGS/ci-tick-c1.log" 2>&1
rerun_workflow ci-check-c1-rerun ci-check-c1
assert_log W2 ci-check-c1-rerun 0 "ticked in the comment, the re-run records it as done and goes on" \
  "E2E pre-deploy manual of PR $C1" "!not marked as performed in integration"

# ------------------------------------------------------------------ W3: a real draft
cat >"$BODIES/c2.md" <<'MD'
CI story C2, opened as a GitHub draft. Its title does not say so: the draft flag of the provider must.
MD
story_branch feature/E2E-502-ci-wip integration E2E_C2 >/dev/null 2>&1
C2=$(gh pr create -R "$REPO" --draft --base integration --head feature/E2E-502-ci-wip --title "E2E-502 C2 work in progress" --body-file "$BODIES/c2.md" 2>>"$LOGS/p-open.err")
C2="${C2##*/}"
story_actions feature/E2E-502-ci-wip "$C2" pre-manual >/dev/null 2>&1
printf 'export C2="%s"\n' "$C2" >>"$LOGS/ci-vars.sh"
wait_workflow check-deploy.yml "$(head_sha feature/E2E-502-ci-wip)" ci-check-c2-draft
assert_log W3 ci-check-c2-draft 0 "a GitHub draft is not stopped, only warned" "the Pull Request is a draft, so the validation goes on"
p_close "$C2" >/dev/null 2>&1

# ------------------------------------------------------------------ W4: the deployment job
p_merge "$C1" >/dev/null || record "merge-$C1" FAIL "merge of #$C1"
wait_workflow process-deploy.yml "$(merge_sha "$C1")" ci-deploy-integration-c1
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
wait_workflow check-deploy.yml "$(head_sha feature/E2E-503-ci-fix)" ci-check-c3
p_merge "$C3" >/dev/null || record "merge-$C3" FAIL "merge of #$C3"
wait_workflow process-deploy.yml "$(merge_sha "$C3")" ci-deploy-integration-c3
assert_log W4c ci-deploy-integration-c3 0 "the fix story deploys" "!failed, stopping execution"

# ------------------------------------------------------------------ W5 W6 W7: the promotion
job_promote() { p_promote "$@"; echo $? >"$LOGS/$3.code"; }
job_promote integration "$C1,$C3" ci-promotion-integration-uat
P1=$(grep -aoE "Promotion Pull Request created: \S+" "$LOGS/ci-promotion-integration-uat.log" | grep -oE "[0-9]+$" | tail -1)
printf 'export CP1="%s"\n' "$P1" >>"$LOGS/ci-vars.sh"
step "promotion #$P1"
PSHA=$(gh pr view "$P1" -R "$REPO" --json headRefOid --jq .headRefOid)
wait_workflow check-deploy.yml "$PSHA" ci-check-promotion-uat
assert_log W5 ci-check-promotion-uat 1 "the validation of the promotion stops until the manual action is done in uat" \
  "not marked as performed in uat" "E2E pre-deploy manual of PR $C1"
status_check W5b ci-forecast-uat "forecast of the promotion: waiting before the merge, after the merge, at deployment" \
  "--pr-ids $C1 --forecast uat --from-branch integration" \
  "P=$P1" "C:$C1=yes" "F:$C1:e2e-gate-$C1=waiting/manual-before-merge" \
  "F:$C1:e2e-flaky-$C1=runs-at-deployment/deploy-only" "F:$C1:e2e-manual-$C1=after-merge/manual-after-merge"
cli ci-set-status-uat integration hardis:project:action:set-status --agent --pr "$C1" --action-id "e2e-gate-$C1" --org-branch uat --target-org "$ORG"
assert_log W6 ci-set-status-uat 0 "set-status marks it as done in uat (what the Mark as done in uat button runs)" "E2E pre-deploy manual of PR $C1"
rerun_workflow ci-check-promotion-uat-rerun ci-check-promotion-uat
assert_log W6b ci-check-promotion-uat-rerun 0 "the validation re-run skips it and passes" \
  "Skipping E2E pre-deploy manual of PR $C1 .*already run in uat" "!not marked as performed in uat"
status_check W6c ci-forecast-uat-done "forecast once marked: done" "--pr-ids $C1 --forecast uat --from-branch integration" \
  "F:$C1:e2e-gate-$C1=done" "F:$C1:e2e-manual-$C1=after-merge/manual-after-merge"
p_merge "$P1" >/dev/null || record "merge-$P1" FAIL "merge of #$P1"
wait_workflow process-deploy.yml "$(merge_sha "$P1")" ci-deploy-uat-promotion
assert_log W7 ci-deploy-uat-promotion 0 "the deployment of the promotion runs the commands, the fix travelled with it" \
  "Skipping E2E pre-deploy manual of PR $C1 .*already run in uat" "Running action E2E flaky post-deploy of PR $C1" "!failed, stopping execution"
status_check W7b ci-status-c1-uat "statuses in uat after the promotion" "--pr-ids $C1" \
  "S:$C1:e2e-flaky-$C1:uat=success" "S:$C1:e2e-after-flaky-$C1:uat=success" "S:$C1:e2e-manual-$C1:uat=manual"

echo
echo "=== section 6quinquies summary ==="
echo "$(grep -c '| OK |' "$RESULTS") OK"
echo "$(grep -c '| FAIL |' "$RESULTS") FAIL"
grep "| FAIL |" "$RESULTS" || true
echo "SECTION 6QUINQUIES DONE"

#!/usr/bin/env bash
# Runbook section 6bis, steps B0 to B16 and the comment checks C1 to C4, on any git provider, after
# backpromote-setup.sh. Prints one line per assertion and a summary, and writes $LOGS/results.txt.
#
#   export BP_PROVIDER_LIB=<path to e2e-lib.sh | e2e-lib-gitlab.sh | e2e-lib-azure.sh>
#   export <the provider library variables> WORK LOGS DEV API DEVHUB DEVORG DEVORG2 ORG
#   bash backpromote-steps.sh
#
# The developer branch feature/E2E-401-dev is where the checkout starts: a backpromote never commits
# there, it switches to backpromote/integration/<sandbox name> and stays on it.
set -uo pipefail
: "${BP_PROVIDER_LIB:?set BP_PROVIDER_LIB to the provider library}"
: "${DEVORG:?set DEVORG}" "${DEVORG2:?set DEVORG2}" "${ORG:?set ORG (a production org for B2)}"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$BP_PROVIDER_LIB"
source "$SCRIPTS_DIR/stories.sh"
source "$LOGS/bp-vars.sh"
export BP_VAR_S1="$S1" BP_VAR_S2="$S2" BP_VAR_S3="$S3"
cd "$WORK" || exit 1
git checkout -q -f feature/E2E-401-dev || exit 1
DEV_BRANCH=feature/E2E-401-dev
SANDBOX=devorg1
BP_BRANCH="backpromote/integration/$SANDBOX"
export BP_VAR_SANDBOX="$SANDBOX" BP_VAR_BRANCH="$BP_BRANCH"

# Keep every Pull Request number the run opens in bp-vars.sh: when a step fails and has to be rerun
# by hand, sourcing that file again gives the numbers of the stories opened so far
remember() {
  export "BP_VAR_$1=$2"
  export "$1=$2"
  printf 'export %s="%s" BP_VAR_%s="%s"\n' "$1" "$2" "$1" "$2" >>"$LOGS/bp-vars.sh"
}

RESULTS="$LOGS/results.txt"
: >"$RESULTS"
record() { echo "$1 | $2 | $3" | tee -a "$RESULTS"; }
ok_if() { if [ "$2" = "0" ]; then record "$1" OK "$3"; else record "$1" FAIL "$3"; fi; }
check_plan() {
  if backpromote_check "$2" "$3" >"$LOGS/$1.check.txt" 2>&1; then
    record "$1" OK "$(tail -1 "$LOGS/$1.check.txt")"
  else
    record "$1" FAIL "$(grep -E 'FAIL|Error' "$LOGS/$1.check.txt" | head -8 | tr '\n' ';')"
  fi
}
check_comments() {
  local label="$1" expectations="$2"
  shift 2
  if backpromote_comments_check "$label" "$expectations" "$@" >"$LOGS/$label.check.txt" 2>&1; then
    record "$label" OK "$(tail -1 "$LOGS/$label.check.txt")"
  else
    record "$label" FAIL "$(grep -E 'FAIL|Error' "$LOGS/$label.check.txt" | head -8 | tr '\n' ';')"
  fi
}
# The uxLog output of a --json run never reaches stderr (oclif silences it), but sfdx-hardis still
# writes it to its own command log: that is where the lines of a run have to be read.
bp_command_log() { ls -t "$WORK"/hardis-report/commands/*hardis-work-backpromote.log 2>/dev/null | head -1; }
# hardis-report/ is deliberately not gitignored, and every sfdx-hardis command writes its log there,
# so "the tree is clean" means "clean outside the report directory", which is what the command checks
tree_dirty_outside_reports() { git status --porcelain -- . ':(exclude)hardis-report' ':(exclude)hardis-report/**'; }
run_id_of() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s.substring(s.indexOf('{')));console.log((j.result||j.data||{}).runId||'')})" <"$LOGS/$1.json"; }
static_resources() {
  env -u NODE_OPTIONS sf data query --target-org "${1:-$DEVORG}" --query "SELECT Name FROM StaticResource WHERE Name LIKE 'E2E_S%' ORDER BY Name" --json |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.records.map(r=>r.Name).join(',')))"
}
resource_body() {
  env -u NODE_OPTIONS sf data query --target-org "${2:-$DEVORG}" --query "SELECT Body FROM StaticResource WHERE Name = '$1'" --json |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).result.records[0];console.log(r?Buffer.from(r.Body||'','base64').toString().trim().replace(/\r?\n/g,'|'):'')})"
}
# The source file of a story static resource
resource_file() { git ls-files "force-app/**/staticresources/$1.resource" "force-app/**/staticresources/$1.resource-*" | grep -v "meta.xml" | head -1; }
# Change a story resource directly in the developer org (the org version differs from git)
change_in_org() {
  local resource="$1" content="$2" org="${3:-$DEVORG}" file
  file=$(resource_file "$resource")
  cp "$file" "$LOGS/$resource.saved"
  printf '%s\n' "$content" >"$file"
  (env -u NODE_OPTIONS sf project deploy start --source-dir "$file" --target-org "$org" --ignore-conflicts --wait 30) >"$LOGS/bp-org-change-$resource.log" 2>&1
  git checkout -- "$file"
}
# A story merged into integration (a new resource, or a change of an existing one). Prints the number.
merge_story() {
  local branch="$1" resource="$2" title="$3" content="${4:-}"
  git checkout -q -f integration && git pull -q origin integration
  if [ -n "$content" ]; then
    git checkout -q -B "$branch"
    printf '%s\n' "$content" >"$(resource_file "$resource")"
    git commit -q -am "$title" && git push -q -u origin "$branch"
  else
    story_branch "$branch" integration "$resource" >&2 || return 1
  fi
  local number
  number=$(bp_open_and_merge "$branch" "$title") || return 1
  git checkout -q -f "$DEV_BRANCH" 2>/dev/null || git checkout -q -f "$BP_BRANCH"
  echo "$number"
}
solve_markers_keep_both() {
  node -e "const fs=require('fs');const f=process.argv[1];const s=fs.readFileSync(f,'utf8');fs.writeFileSync(f,s.replace(/<<<<<<<[^\n]*\r?\n([\s\S]*?)(?:\|\|\|\|\|\|\|[^\n]*\r?\n[\s\S]*?)?=======\r?\n([\s\S]*?)>>>>>>>[^\n]*\r?\n?/g,(m,a,b)=>a+b))" "$1"
}
DEVUSER=$(env -u NODE_OPTIONS sf org display --target-org "$DEVORG" --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.username))")
S1_FILE=$(resource_file E2E_S1); S2_FILE=$(resource_file E2E_S2); S3_FILE=$(resource_file E2E_S3)
export BP_VAR_S1_FILE="$S1_FILE" BP_VAR_S2_FILE="$S2_FILE" BP_VAR_S3_FILE="$S3_FILE"

echo; echo "=== B0 no git provider token ==="
e2e_backpromote_nogit_json bp-no-token --plan --parent-branch integration --sandbox-name "$SANDBOX"
check_plan B0-plan bp-no-token "$BPX/no-token.json"
e2e_backpromote_nogit_json bp-no-token-run --auto --parent-branch integration --sandbox-name "$SANDBOX"
code=$?
[ "$code" != "0" ] && grep -q "git provider token is required" "$LOGS/bp-no-token-run.json" "$LOGS/bp-no-token-run.log"
ok_if B0-run $? "exit=$code"

echo; echo "=== B1 org of a major branch ==="
printf 'targetUsername: %s\n' "$DEVUSER" >>config/branches/.sfdx-hardis.uat.yml
e2e_backpromote_json bp-refused-major --plan --parent-branch integration --sandbox-name "$SANDBOX"
check_plan B1-plan bp-refused-major "$BPX/refused-major-org.json"
git checkout -- config/branches

echo; echo "=== B1c parent branch not allowed ==="
e2e_backpromote_json bp-refused-parent --plan --parent-branch feature/E2E-105-apex --sandbox-name "$SANDBOX"
check_plan B1c-plan bp-refused-parent "$BPX/refused-parent.json"

echo; echo "=== B2 production org ==="
e2e_backpromote_json bp-refused-prod --plan --parent-branch integration --target-org "$ORG"
check_plan B2-plan bp-refused-prod "$BPX/refused-production.json"

echo; echo "=== B3 first plan: no history, then the window from S1 ==="
e2e_backpromote_json bp-plan-first --plan --parent-branch integration --sandbox-name "$SANDBOX"
check_plan B3-plan-first bp-plan-first "$BPX/plan-first.json"
RUN1=$(run_id_of bp-plan-first)
PROGRESS_FILE="$(cygpath -m "$LOGS" 2>/dev/null || echo "$LOGS")/bp-plan-s1.progress.jsonl"
rm -f "$PROGRESS_FILE"
SFDX_HARDIS_PROGRESS_FILE="$PROGRESS_FILE" e2e_backpromote_json bp-plan-s1 --plan --parent-branch integration --sandbox-name "$SANDBOX" --from-pull-request "$S1" --run-id "$RUN1"
check_plan B3-plan-s1 bp-plan-s1 "$BPX/plan-from-s1.json"
grep -q '"step":"history"' "$PROGRESS_FILE" && grep -q '"step":"delta"' "$PROGRESS_FILE" && grep -q '"step":"retrieve"' "$PROGRESS_FILE"
ok_if B3-progress $? "$(wc -l <"$PROGRESS_FILE" | tr -d ' ') progress lines"
[ "$(git branch --show-current)" = "$DEV_BRANCH" ] && [ -z "$(tree_dirty_outside_reports)" ]
ok_if B3-read-only $? "still on $(git branch --show-current), clean tree"

echo; echo "=== B4 run from S1: S1 to S3 deployed with their actions ==="
e2e_backpromote_json bp-run-1 --auto --parent-branch integration --sandbox-name "$SANDBOX" --from-pull-request "$S1" --run-id "$RUN1"
check_plan B4-result bp-run-1 "$BPX/run-1.json"
[ "$(static_resources)" = "E2E_S1,E2E_S2,E2E_S3" ]
ok_if B4-org $? "resources: $(static_resources)"
BP_RUN1_LOG=$(bp_command_log)
grep -q "E2E pre-deploy of PR $S1" "$BP_RUN1_LOG" && grep -q "E2E post-deploy of PR $S2" "$BP_RUN1_LOG" && grep -q "E2E pre-deploy of PR $S3" "$BP_RUN1_LOG"
ok_if B4-actions $? "pre and post actions ran ($BP_RUN1_LOG)"
[ "$(git branch --show-current)" = "$BP_BRANCH" ]
ok_if B4-checkout $? "checkout on $(git branch --show-current)"
! git ls-remote --exit-code --heads origin "$BP_BRANCH" >/dev/null 2>&1
ok_if B4-not-pushed $? "no manual merge: the branch is not on origin"
check_comments C1-comments "$BPX/comments-after-run-1.json" "$S1" "$S2" "$S3"

echo; echo "=== B5 up to date, then the manual action confirmed ==="
e2e_backpromote_json bp-plan-up-to-date --plan --parent-branch integration --sandbox-name "$SANDBOX"
check_plan B5-plan bp-plan-up-to-date "$BPX/plan-up-to-date.json"
e2e_backpromote_json bp-confirm --confirm-action "e2e-manual-$S1" --parent-branch integration --sandbox-name "$SANDBOX" --run-id "$(run_id_of bp-plan-up-to-date)"
check_plan B5-confirm bp-confirm "$BPX/confirm.json"
check_comments C2-comments "$BPX/comments-after-confirm.json" "$S1"

echo; echo "=== B6 a new story: the default start ==="
S4=$(merge_story feature/E2E-104-delta E2E_S4 "E2E-104 delta") || exit 1
remember S4 "$S4"
e2e_backpromote_json bp-plan-s4 --plan --parent-branch integration --sandbox-name "$SANDBOX"
check_plan B6-plan bp-plan-s4 "$BPX/plan-s4.json"
e2e_backpromote_json bp-run-s4 --auto --parent-branch integration --sandbox-name "$SANDBOX" --run-id "$(run_id_of bp-plan-s4)"
check_plan B6-result bp-run-s4 "$BPX/run-s4.json"
[ "$(static_resources)" = "E2E_S1,E2E_S2,E2E_S3,E2E_S4" ]
ok_if B6-org $? "resources: $(static_resources)"

echo; echo "=== B7 a file that differs: overwrite with the parent branch version ==="
change_in_org E2E_S2 "org version of S2"
S5=$(merge_story feature/E2E-105-epsilon E2E_S2 "E2E-105 epsilon" "git version of S2") || exit 1
remember S5 "$S5"
e2e_backpromote_json bp-plan-diff --plan --parent-branch integration --sandbox-name "$SANDBOX"
check_plan B7-plan bp-plan-diff "$BPX/plan-diff.json"
e2e_backpromote_json bp-run-overwrite --auto --parent-branch integration --sandbox-name "$SANDBOX" --run-id "$(run_id_of bp-plan-diff)" --on-diff "$S2_FILE=git"
check_plan B7-result bp-run-overwrite "$BPX/run-overwrite.json"
[ "$(resource_body E2E_S2)" = "git version of S2" ]
ok_if B7-org $? "org body: $(resource_body E2E_S2)"

echo; echo "=== B8 keep the org version, then the item comes back ==="
change_in_org E2E_S3 "org version of S3"
S6=$(merge_story feature/E2E-106-zeta E2E_S3 "E2E-106 zeta" "git version of S3") || exit 1
remember S6 "$S6"
e2e_backpromote_json bp-run-keep-org --auto --parent-branch integration --sandbox-name "$SANDBOX" --on-diff "$S3_FILE=org"
check_plan B8-result bp-run-keep-org "$BPX/run-keep-org.json"
[ "$(resource_body E2E_S3)" = "org version of S3" ]
ok_if B8-org-kept $? "org body: $(resource_body E2E_S3)"
check_comments C3-comments "$BPX/comments-after-keep-org.json" "$S6"
e2e_backpromote_json bp-plan-left-out --plan --parent-branch integration --sandbox-name "$SANDBOX"
check_plan B8-plan-left-out bp-plan-left-out "$BPX/plan-left-out.json"
e2e_backpromote_json bp-run-left-out --auto --parent-branch integration --sandbox-name "$SANDBOX" --run-id "$(run_id_of bp-plan-left-out)" --on-diff "$S3_FILE=git"
check_plan B8-result-2 bp-run-left-out "$BPX/run-left-out.json"
[ "$(resource_body E2E_S3)" = "git version of S3" ]
ok_if B8-org-overwritten $? "org body: $(resource_body E2E_S3)"

echo; echo "=== B9 agent mode: a merge by hand stops the run, then continues ==="
change_in_org E2E_S1 "org line of S1"
S7=$(merge_story feature/E2E-107-eta E2E_S1 "E2E-107 eta" "git line of S1") || exit 1
remember S7 "$S7"
e2e_backpromote_json bp-agent-waiting --agent --parent-branch integration --sandbox-name "$SANDBOX" --on-diff "$S1_FILE=merge"
check_plan B9-waiting bp-agent-waiting "$BPX/agent-waiting.json"
grep -q "<<<<<<<" "$S1_FILE" && grep -q "|||||||" "$S1_FILE"
ok_if B9-markers $? "three-way markers in $S1_FILE"
ls "$WORK"/hardis-report/backpromote-merge-prompt-*.md >/dev/null 2>&1
ok_if B9-prompt $? "coding agent prompt saved"
solve_markers_keep_both "$S1_FILE"
e2e_backpromote_json bp-agent-done --agent --parent-branch integration --sandbox-name "$SANDBOX" --run-id "$(run_id_of bp-agent-waiting)" --on-diff "$S1_FILE=merge"
check_plan B9-done bp-agent-done "$BPX/agent-done.json"
[ "$(resource_body E2E_S1)" = "org line of S1|git line of S1" ]
ok_if B9-org $? "org body: $(resource_body E2E_S1)"
git ls-remote --exit-code --heads origin "$BP_BRANCH" >/dev/null 2>&1 && git log -1 --format=%s | grep -q "backpromote merges"
ok_if B9-pushed $? "$(git log -1 --format=%s)"

echo; echo "=== B10 panel protocol: prepare, refuse while markers remain, then run ==="
change_in_org E2E_S2 "org line of S2"
S8=$(merge_story feature/E2E-108-theta E2E_S2 "E2E-108 theta" "git line of S2") || exit 1
remember S8 "$S8"
e2e_backpromote_json bp-plan-s8 --plan --parent-branch integration --sandbox-name "$SANDBOX"
RUN8=$(run_id_of bp-plan-s8)
e2e_backpromote_json bp-prepare --prepare --parent-branch integration --sandbox-name "$SANDBOX" --run-id "$RUN8" --on-diff "$S2_FILE=merge"
check_plan B10-prepare bp-prepare "$BPX/prepare.json"
e2e_backpromote_json bp-conflicts-remaining --auto --parent-branch integration --sandbox-name "$SANDBOX" --run-id "$RUN8" --on-diff "$S2_FILE=merge"
check_plan B10-refused bp-conflicts-remaining "$BPX/conflicts-remaining.json"
[ "$(resource_body E2E_S2)" = "org line of S2" ]
ok_if B10-nothing-deployed $? "org body untouched: $(resource_body E2E_S2)"
solve_markers_keep_both "$S2_FILE"
e2e_backpromote_json bp-run-after-merge --auto --parent-branch integration --sandbox-name "$SANDBOX" --run-id "$RUN8" --on-diff "$S2_FILE=merge"
check_plan B10-result bp-run-after-merge "$BPX/run-after-merge.json"
[ "$(resource_body E2E_S2)" = "org line of S2|git line of S2" ]
ok_if B10-org $? "org body: $(resource_body E2E_S2)"

echo; echo "=== B11 a deletion: skipped, then applied on a redeploy ==="
git checkout -q -f integration && git pull -q origin integration
git checkout -q -B feature/E2E-109-iota
git rm -q "$(resource_file E2E_S4)" "$(resource_file E2E_S4)-meta.xml" 2>/dev/null || git rm -q -r "$(dirname "$(resource_file E2E_S4)")/E2E_S4"* 2>/dev/null
git commit -q -am "E2E-109 iota: remove S4" && git push -q -u origin feature/E2E-109-iota
S9=$(bp_open_and_merge feature/E2E-109-iota "E2E-109 iota") || exit 1
remember S9 "$S9"
git checkout -q -f "$BP_BRANCH"
e2e_backpromote_json bp-plan-deletion --plan --parent-branch integration --sandbox-name "$SANDBOX"
check_plan B11-plan bp-plan-deletion "$BPX/plan-deletion.json"
e2e_backpromote_json bp-run-skip-destructive --auto --parent-branch integration --sandbox-name "$SANDBOX" --run-id "$(run_id_of bp-plan-deletion)" --skip-destructive
check_plan B11-skipped bp-run-skip-destructive "$BPX/run-skip-destructive.json"
[ "$(static_resources)" = "E2E_S1,E2E_S2,E2E_S3,E2E_S4" ]
ok_if B11-org-kept $? "S4 kept: $(static_resources)"
e2e_backpromote_json bp-run-delete --auto --parent-branch integration --sandbox-name "$SANDBOX" --from-pull-request "$S9"
check_plan B11-deleted bp-run-delete "$BPX/run-delete.json"
[ "$(static_resources)" = "E2E_S1,E2E_S2,E2E_S3" ]
ok_if B11-org-deleted $? "S4 deleted: $(static_resources)"

echo; echo "=== B12 an item left out comes back in the next plan ==="
git checkout -q -f integration && git pull -q origin integration
git checkout -q -B feature/E2E-110-kappa
# Written here rather than through story_branch: story_branch checks the target branch out again
# and its `git checkout -b` then fails on the branch this step just created, which leaves the
# commits on integration. Only the four files are added: hardis-report/ is not gitignored.
RES_DIR="$(dirname "$(resource_file E2E_S1)")"
printf 'promotion branches end to end test: E2E_S5\n' >"$RES_DIR/E2E_S5.resource"
sed 's/E2E_S1/E2E_S5/g' "$RES_DIR/E2E_S1.resource-meta.xml" >"$RES_DIR/E2E_S5.resource-meta.xml"
printf 'promotion branches end to end test: E2E_S6\n' >"$RES_DIR/E2E_S6.resource"
sed 's/E2E_S1/E2E_S6/g' "$RES_DIR/E2E_S1.resource-meta.xml" >"$RES_DIR/E2E_S6.resource-meta.xml"
git add "$RES_DIR/E2E_S5.resource" "$RES_DIR/E2E_S5.resource-meta.xml" "$RES_DIR/E2E_S6.resource" "$RES_DIR/E2E_S6.resource-meta.xml"
git commit -q -m "E2E-110 kappa: S5 and S6" && git push -q -f -u origin feature/E2E-110-kappa
S10=$(bp_open_and_merge feature/E2E-110-kappa "E2E-110 kappa") || exit 1
remember S10 "$S10"
git checkout -q -f "$BP_BRANCH"
e2e_backpromote_json bp-run-exclude --auto --parent-branch integration --sandbox-name "$SANDBOX" --exclude-metadata StaticResource:E2E_S6
check_plan B12-result bp-run-exclude "$BPX/run-exclude.json"
[ "$(static_resources)" = "E2E_S1,E2E_S2,E2E_S3,E2E_S5" ]
ok_if B12-org $? "S6 not deployed: $(static_resources)"
e2e_backpromote_json bp-plan-excluded-last-time --plan --parent-branch integration --sandbox-name "$SANDBOX"
check_plan B12-plan bp-plan-excluded-last-time "$BPX/plan-excluded-last-time.json"
e2e_backpromote_json bp-run-excluded-back --auto --parent-branch integration --sandbox-name "$SANDBOX" --run-id "$(run_id_of bp-plan-excluded-last-time)"
check_plan B12-result-2 bp-run-excluded-back "$BPX/run-excluded-back.json"
[ "$(static_resources)" = "E2E_S1,E2E_S2,E2E_S3,E2E_S5,E2E_S6" ]
ok_if B12-org-2 $? "S6 deployed: $(static_resources)"

echo; echo "=== B13 dirty working tree on the developer branch: stashed ==="
git checkout -q -f "$DEV_BRANCH"
echo "x" >>NOTES.md
S11=$(merge_story feature/E2E-111-lambda E2E_S7 "E2E-111 lambda") || exit 1
remember S11 "$S11"
git checkout -q -f "$DEV_BRANCH" 2>/dev/null
echo "x" >>NOTES.md
e2e_backpromote_json bp-plan-dirty --plan --parent-branch integration --sandbox-name "$SANDBOX"
check_plan B13-plan bp-plan-dirty "$BPX/plan-dirty.json"
e2e_backpromote_json bp-run-dirty --auto --parent-branch integration --sandbox-name "$SANDBOX" --run-id "$(run_id_of bp-plan-dirty)"
check_plan B13-result bp-run-dirty "$BPX/run-dirty.json"
git stash list | grep -q "sfdx-hardis backpromote $(run_id_of bp-plan-dirty) from $DEV_BRANCH"
ok_if B13-stash $? "$(git stash list | head -1)"
[ "$(git branch --show-current)" = "$BP_BRANCH" ] && [ -z "$(tree_dirty_outside_reports)" ]
ok_if B13-checkout $? "on $(git branch --show-current), clean"
git checkout -q -f "$DEV_BRANCH" && git stash pop -q && grep -q "^x$" NOTES.md
ok_if B13-back $? "back on $DEV_BRANCH with the stash popped"
git checkout -q -- NOTES.md

echo; echo "=== B14 a refreshed sandbox: same name, another org id ==="
e2e_backpromote_json bp-plan-refresh --plan --parent-branch integration --sandbox-name "$SANDBOX" --target-org "$DEVORG2"
check_plan B14-plan bp-plan-refresh "$BPX/plan-refresh.json"
e2e_backpromote_json bp-run-refresh --auto --parent-branch integration --sandbox-name "$SANDBOX" --target-org "$DEVORG2" --from-pull-request "$S1" --run-id "$(run_id_of bp-plan-refresh)"
check_plan B14-result bp-run-refresh "$BPX/run-refresh.json"
[ "$(static_resources "$DEVORG2")" = "E2E_S1,E2E_S2,E2E_S3,E2E_S5,E2E_S6,E2E_S7" ]
ok_if B14-org $? "resources: $(static_resources "$DEVORG2")"
check_comments C4-comments "$BPX/comments-after-refresh.json" "$S1" "$S2" "$S3"

echo; echo "=== B15 scan limit ==="
e2e_backpromote_json bp-plan-scan-limit --plan --parent-branch integration --sandbox-name never-seen --scan-limit 2
check_plan B15-plan bp-plan-scan-limit "$BPX/plan-scan-limit.json"

echo; echo "=== B16 reset the backpromote branch ==="
e2e_backpromote_json bp-reset --reset --auto --parent-branch integration --sandbox-name "$SANDBOX"
check_plan B16-reset bp-reset "$BPX/reset.json"
! git ls-remote --exit-code --heads origin "$BP_BRANCH" >/dev/null 2>&1
ok_if B16-deleted $? "$BP_BRANCH deleted on origin"
git checkout -q -f "$DEV_BRANCH"

echo; echo "=== summary ==="
grep -c "| OK |" "$RESULTS" | xargs -I{} echo "{} OK"
grep -c "| FAIL |" "$RESULTS" | xargs -I{} echo "{} FAIL"
grep "| FAIL |" "$RESULTS" || true
echo "STEPS DONE"

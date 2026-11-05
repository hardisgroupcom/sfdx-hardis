#!/usr/bin/env bash
# Major branch deployment check, end to end, in REAL CI jobs (GitHub Actions, GitLab CI, Azure
# Pipelines or Bitbucket Pipelines) running sfdx-hardis built from the branch under test, and the
# DevOps Pipeline of vscode-sfdx-hardis read headless (check-pipeline.cjs).
#
# The custom field Account.MBC_Drift__c is created in the org directly (never in git), then a story
# brings the Apex class that reads it to integration. The org then drifts: the class and the field
# are deleted from the org. The check of integration redeploys the class, which no longer compiles
# since the field exists nowhere, so it must fail; the one of uat must pass,
# neither may comment a Pull Request nor run a deployment action, and the DevOps Pipeline must show
# each result on the branch node, never on the deployment arrow, and mark it stale when it is too
# old or when the branch was deployed after it.
#
#   PROVIDER=github bash mbc-e2e.sh                     # the whole run (github, gitlab, azure, bitbucket)
#   PROVIDER=github RUN=<run> STEPS="assert-pipeline report" bash mbc-e2e.sh   # replay steps of a run
#
# Steps, in order: org repo deploy drift check-running assert-ci assert-pipeline stale-deployed
# stale-age off not-major report
#
# Settings (environment, then the .env of the sfdx-hardis working copy):
#   PROVIDER            github (default), gitlab, azure or bitbucket
#   DEVHUB              Dev Hub that creates the scratch org (default DevHub)
#   MBC_ORG             org of the three major branches (default: a new scratch org
#                       mbc-e2e-<provider>-<date>). The run creates Account.MBC_Drift__c in it,
#                       then deletes it
#   SFDX_HARDIS_BRANCH  branch of hardisgroupcom/sfdx-hardis the jobs build (default: current, pushed)
#   RUN                 run name (default mbc-e2e-<provider>-<date>): WORK and LOGS under the OS temp dir
#   MBC_GH_REUSE_SECONDS  GitHub: a check started within this many seconds of the previous dispatch
#                       reuses its run (default 600; one run checks every major branch)
#   GitHub: GH_E2E_OWNER. GitLab: GITLAB_E2E_HOST, GITLAB_E2E_GROUP. Azure: AZ_ORG, AZ_PROJECT,
#   AZURE_PERSONAL_ACCESS_TOKEN. Bitbucket: BB_WORKSPACE, BB_PROJECT_KEY, ATLASSIAN_TOKEN,
#   ATLASSIAN_EMAIL (see ../../promotion-branches/scripts/ci-provider-<provider>.sh)
#
# Results: $LOGS/results.tsv (id, OK|FAIL|SKIP, detail), report in $LOGS/report.md
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMO_SCRIPTS="$(cd "$HERE/../../promotion-branches/scripts" && pwd)"
export PROVIDER="${PROVIDER:-github}"
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/env-lib.sh"
e2e_defaults
e2e_load_env DEVHUB MBC_ORG GH_E2E_OWNER GITLAB_E2E_HOST GITLAB_E2E_GROUP AZ_ORG AZ_PROJECT BB_WORKSPACE BB_PROJECT_KEY
ROOT="$E2E_ROOT"
DEVHUB="${DEVHUB:-DevHub}"
STAMP="$(date +%m%d%H%M)"
RUN="${RUN:-mbc-e2e-$PROVIDER-$(date +%Y%m%d-%H%M)}"
export WORK="${MBC_WORK:-$E2E_TMP/$RUN}"
export LOGS="${MBC_LOGS:-$E2E_TMP/$RUN-logs}"
SFDX_HARDIS_BRANCH="${SFDX_HARDIS_BRANCH:-$(git -C "$ROOT" branch --show-current)}"
STEPS="${STEPS:-org repo deploy drift check-running assert-ci assert-pipeline stale-deployed stale-age off not-major report}"
mkdir -p "$LOGS/bodies"
export RESULTS="$LOGS/results.tsv"
touch "$RESULTS" "$LOGS/run.env"
[ -f "$LOGS/ci-jobs.tsv" ] || printf 'label\tprovider\tmode\trun\tresult\tqueued_s\tran_s\tbuild_minutes\n' >"$LOGS/ci-jobs.tsv"
# shellcheck source=/dev/null
source "$LOGS/run.env"
# shellcheck source=/dev/null
[ -f "$LOGS/ci-vars.sh" ] && source "$LOGS/ci-vars.sh"
# One org for the three major branches, new for each run unless MBC_ORG names one
export ORG="${MBC_ORG:-mbc-e2e-$PROVIDER-$STAMP}"
# A repository name of our own, unless a replay already knows it
case "$PROVIDER" in
github)
  [ -n "${REPO:-}" ] || REPO="${GH_E2E_OWNER:-$(gh api user --jq .login)}/sfdx-hardis-mbc-e2e-$STAMP"
  export REPO
  ;;
gitlab)
  [ -n "${GITLAB_E2E_PROJECT:-}" ] || [ -z "${PROJECT_PATH:-}" ] || GITLAB_E2E_PROJECT="${PROJECT_PATH##*/}"
  [ -n "${GITLAB_E2E_PROJECT:-}" ] || GITLAB_E2E_PROJECT="sfdx-hardis-mbc-e2e-gl-$STAMP"
  export GITLAB_E2E_PROJECT
  ;;
azure)
  [ -n "${AZ_REPO_NAME:-}" ] || AZ_REPO_NAME="sfdx-hardis-mbc-e2e-az-$STAMP"
  export AZ_REPO_NAME
  ;;
bitbucket)
  [ -n "${BB_REPO:-}" ] || BB_REPO="sfdx-hardis-mbc-e2e-bb-$STAMP"
  export BB_REPO
  ;;
*)
  echo "PROVIDER=$PROVIDER: github, gitlab, azure or bitbucket"
  exit 2
  ;;
esac

# ci-provider-bitbucket.sh sources its library from SCRIPTS_DIR
export SCRIPTS_DIR="$PROMO_SCRIPTS"
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/ci-provider-$PROVIDER.sh"
ci_provider_init || exit 1
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/section-lib.sh"
# One assertion per line of results.tsv: id, OK|FAIL|SKIP, detail (assert_log records through it)
record() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$RESULTS"
  echo "[$2] $1 - $3"
}
ci_tick_in_file() { :; } # no checkbox in this scenario

save() {
  printf 'export %s=%q\n' "$1" "$2" >>"$LOGS/run.env"
  export "$1=$2"
}
step() { case " $STEPS " in *" $1 "*) return 0 ;; *) return 1 ;; esac }
say() { echo "[$(date +%T)] $*"; }
native() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
# sf can print a warning before its JSON: parse from the first brace
json_of() { node -e "const t=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(t.slice(t.indexOf('{')));const v=($1);process.stdout.write(v===undefined||v===null?'':String(v))}catch(e){}"; }
# The job helpers (p_open, p_merge, p_token...) need the repository to exist
provider_lib() {
  # shellcheck source=/dev/null
  source "$PROMO_SCRIPTS/promotion-provider.sh"
}
# A CI job that could not run: SKIP when the provider had no build minutes left, FAIL otherwise
job_ran() {
  local id="$1" label="$2"
  [ "$(cat "$LOGS/$label.code" 2>/dev/null)" = "9" ] || [ ! -f "$LOGS/$label.code" ] || return 0
  if grep -q "^not run" "$LOGS/$label.mode" 2>/dev/null; then
    record "$id" SKIP "$label did not run: $(head -1 "$LOGS/$label.log" 2>/dev/null)"
  else
    record "$id" FAIL "$label did not run: $(head -1 "$LOGS/$label.log" 2>/dev/null)"
  fi
  return 1
}
# check-pipeline.cjs on the local clone with main checked out: the config the extension reads
# Usage: mbc_pipeline <label> <expectations file> [--now <ISO date>]
mbc_pipeline() {
  local label="$1" expect="$2" code
  shift 2
  git -C "$WORK" checkout -q -f main
  env -u NODE_OPTIONS EXT="$EXT" WORK="$(native "$WORK")" PROVIDER_TOKEN="$(p_token)" PROVIDER_EMAIL="${BB_EMAIL:-}" \
    node "$PROMO_SCRIPTS/check-pipeline.cjs" "$(native "$expect")" --dump "$(native "$LOGS/$label.json")" "$@" >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$code" >"$LOGS/$label.code"
  return $code
}
pipeline_assert() {
  local id="$1" label="$2" desc="$3"
  if [ "$(cat "$LOGS/$label.code" 2>/dev/null)" = "0" ]; then
    record "$id" OK "$label: $desc"
  else
    record "$id" FAIL "$label: $desc: $(grep -E '^FAIL|^Cannot load|^No active git provider|Error' "$LOGS/$label.log" | head -6 | tr '\n' ';')"
  fi
}
# A deletion in the org through a destructive deployment, git untouched
# Usage: drift_delete <key> <metadata type> <member>
drift_delete() {
  local key="$1" type="$2" member="$3" dir="$LOGS/destructive-$1"
  rm -rf "$dir" && mkdir -p "$dir"
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n    <version>%s</version>\n</Package>\n' "$API" >"$dir/package.xml"
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n    <types>\n        <members>%s</members>\n        <name>%s</name>\n    </types>\n    <version>%s</version>\n</Package>\n' "$member" "$type" "$API" >"$dir/destructiveChanges.xml"
  (cd "$WORK" && env -u NODE_OPTIONS sf project deploy start --manifest "$(native "$dir/package.xml")" \
    --post-destructive-changes "$(native "$dir/destructiveChanges.xml")" --target-org "$ORG" --wait 30 --json) >"$LOGS/drift-$key.json" 2>&1
  if grep -q '"status": 0' "$LOGS/drift-$key.json"; then
    record "DRIFT-$key" OK "$type $member deleted from the org by a destructive deployment, git untouched"
  else
    record "DRIFT-$key" FAIL "$type $member not deleted, see drift-$key.json"
  fi
}
# Account.MBC_Drift__c created in the org from a project of its own under $LOGS, outside the
# repository: the field must never be in git (a deleted field is renamed MBC_Drift_del__c, so a
# full deployment carrying it would create it again and the drift would prove nothing)
create_drift_field() {
  local dir="$LOGS/field-project"
  rm -rf "$dir"
  mkdir -p "$dir/force-app/main/default/objects/Account/fields"
  printf '{ "packageDirectories": [{ "path": "force-app", "default": true }], "name": "mbc-e2e-field", "sourceApiVersion": "%s" }\n' "$API" >"$dir/sfdx-project.json"
  cat >"$dir/force-app/main/default/objects/Account/fields/MBC_Drift__c.field-meta.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>MBC_Drift__c</fullName>
    <externalId>false</externalId>
    <label>MBC Drift</label>
    <length>80</length>
    <required>false</required>
    <type>Text</type>
    <unique>false</unique>
</CustomField>
XML
  (cd "$dir" && env -u NODE_OPTIONS sf project deploy start --source-dir force-app -o "$ORG" --wait 30 --json) >"$LOGS/field-create.json" 2>&1
  if grep -q '"status": 0' "$LOGS/field-create.json"; then
    record DEPLOY-FIELD OK "Account.MBC_Drift__c created in the org directly, from a folder outside the repository"
  else
    record DEPLOY-FIELD FAIL "Account.MBC_Drift__c not created in the org, see field-create.json"
    exit 1
  fi
}
# A full deployment of a branch to the org, check only (nothing is written). Exit 0 when it would pass
dry_run() {
  local branch="$1" label="$2"
  (cd "$WORK" && git checkout -q -f "$branch" && git pull -q origin "$branch" &&
    env -u NODE_OPTIONS sf project deploy start --dry-run --manifest manifest/package.xml --target-org "$ORG" \
      --test-level NoTestRun --wait 30 --json) >"$LOGS/$label.json" 2>&1
  grep -q '"status": 0' "$LOGS/$label.json"
}

say "run $RUN - provider $PROVIDER - work $WORK - logs $LOGS - branch under test $SFDX_HARDIS_BRANCH - org $ORG"

# ------------------------------------------------------------------ org: one scratch org for the three branches
if step org; then
  if ! env -u NODE_OPTIONS sf org display -o "$ORG" --json 2>/dev/null | grep -qE '"connectedStatus": "Connected"|"status": "Active"'; then
    env -u NODE_OPTIONS sf org create scratch --target-dev-hub "$DEVHUB" --alias "$ORG" --edition developer --duration-days 2 --wait 30 --json >"$LOGS/org-create.json" 2>&1 || {
      record ORG FAIL "scratch org not created, see org-create.json"
      exit 1
    }
  fi
  save MBC_ORG "$ORG"
  # Recent sf CLI versions hide secrets in "sf org display": the auth URL has its own command
  AUTH_URL=$(env -u NODE_OPTIONS sf org auth show-sfdx-auth-url -o "$ORG" --json 2>/dev/null | json_of "j.result.sfdxAuthUrl")
  [[ "$AUTH_URL" == force://* ]] || {
    record ORG FAIL "no sfdxAuthUrl for $ORG"
    exit 1
  }
  printf '%s' "$AUTH_URL" >"$LOGS/auth-url.txt"
  env -u NODE_OPTIONS sf org display -o "$ORG" --json >"$LOGS/org-display.json" 2>/dev/null
  save ORG_USERNAME "$(json_of "j.result.username" <"$LOGS/org-display.json")"
  save ORG_INSTANCE "$(json_of "j.result.instanceUrl" <"$LOGS/org-display.json")"
  record ORG OK "org $ORG ready ($ORG_USERNAME), its auth URL logs integration, uat and main in"
fi

# ------------------------------------------------------------------ repo: project, CI files, remote, logins
if step repo; then
  WORK="$WORK" API="$API" bash "$HERE/mbc-build-project.sh" >"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "project not built, see build.log"
    exit 1
  }
  cd "$WORK" || exit 1
  for f in config/branches/.sfdx-hardis.*.yml; do
    printf 'targetUsername: %s\ninstanceUrl: %s\n' "$ORG_USERNAME" "$ORG_INSTANCE" >>"$f"
  done
  node "$PROMO_SCRIPTS/ci-workflows-prepare.cjs" --provider "$PROVIDER" "$ROOT" "$(native "$WORK")" "$SFDX_HARDIS_BRANCH" >>"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "CI files not written, see build.log"
    exit 1
  }
  git add -A && git commit -qm "chore: CI files of the sfdx-hardis branch $SFDX_HARDIS_BRANCH"
  : >"$LOGS/ci-vars.sh"
  ci_create_remote "$(cat "$LOGS/auth-url.txt")" >>"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "remote not created, see build.log"
    exit 1
  }
  # shellcheck source=/dev/null
  source "$LOGS/ci-vars.sh"
  ci_prepare_major_branch_check "$(cat "$LOGS/auth-url.txt")" >>"$LOGS/build.log" 2>&1 || {
    record REPO-CHECK-JOB FAIL "the major branch check job is not ready, see build.log"
    exit 1
  }
  save REPO_READY 1
  record REPO OK "repository ${REPO:-${PROJECT_PATH:-${AZ_REPO_NAME:-${BB_REPO:-?}}}} with main integration uat, the CI files of $SFDX_HARDIS_BRANCH including the major branch check, the logins"
fi
if [ -n "${REPO_READY:-}" ]; then provider_lib; fi

# ------------------------------------------------------------------ deploy: the story reaches integration
if step deploy; then
  say "deploy: MBC_Drift__c into the org, then MBCDrift into integration"
  # The org holds the field before the class reaches integration
  create_drift_field
  cd "$WORK" || exit 1
  git fetch -q origin
  git checkout -q -f feature/mbc-drift
  # on top of integration: some providers run the CI file of the source branch
  git rebase -q origin/integration || {
    record DEPLOY-BRANCH FAIL "feature/mbc-drift does not rebase on integration"
    exit 1
  }
  git push -q -u origin feature/mbc-drift
  printf 'MBC-1: the Apex class MBCDrift, which reads Account.MBC_Drift__c (a field of the org, not of git).\n' >"$LOGS/bodies/drift.md"
  PR_N=$(p_open feature/mbc-drift integration "MBC-1 drift class" "$LOGS/bodies/drift.md") || {
    record DEPLOY-PR FAIL "Pull Request not opened, see p-open.err"
    exit 1
  }
  save PR_N "$PR_N"
  say "PR N=#$PR_N"
  ci_wait_check "$PR_N" "$(git rev-parse HEAD)" deploy-check
  assert_log DEPLOY-CHECK deploy-check 0 "the validation of #$PR_N into integration succeeds and runs the pre-deployment command" "MBC_PRE_DEPLOY_MARKER"
  if [ "$(cat "$LOGS/deploy-check.code" 2>/dev/null)" != "0" ]; then
    record DEPLOY SKIP "the validation of #$PR_N failed: nothing is merged, the next steps would prove nothing"
    exit 1
  fi
  p_merge "$PR_N" >/dev/null || {
    record DEPLOY-MERGE FAIL "merge of #$PR_N"
    exit 1
  }
  ci_wait_deploy integration "$(ci_merge_sha "$PR_N")" deploy-integration
  assert_log DEPLOY deploy-integration 0 "the deployment job of integration succeeds and runs the pre-deployment command (the marker can be seen)" "MBC_PRE_DEPLOY_MARKER"
  # The comments of #N as they are after its deployment: no check may add, edit or remove one
  sleep 30
  ci_pr_comments_ids "$PR_N" pr-comments-before
  count=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" "$(native "$LOGS/pr-comments-before.json")" 2>/dev/null)
  if [ -n "$count" ]; then
    record DEPLOY-COMMENTS OK "$count comments of #$PR_N recorded (ids and bodies)"
  else
    record DEPLOY-COMMENTS FAIL "the comments of #$PR_N could not be read"
  fi
fi

# ------------------------------------------------------------------ drift: the org loses what integration holds
if step drift; then
  say "drift: MBCDrift then MBC_Drift__c deleted from the org"
  # The class first: Salesforce refuses to delete a field an Apex class uses
  drift_delete class ApexClass MBCDrift
  drift_delete field CustomField Account.MBC_Drift__c
  # The proof, before any CI minute is spent: a full deployment of integration to the org now
  # fails (the class does not compile without the field), the one of uat still passes (check only,
  # nothing is written)
  if dry_run integration drift-dry-integration; then
    record DRIFT-INTEGRATION FAIL "a full deployment of integration still passes: the org or git still holds MBC_Drift__c, the drift proves nothing (see the README traps)"
  elif grep -q "MBC_Drift" "$LOGS/drift-dry-integration.json"; then
    record DRIFT-INTEGRATION OK "a full deployment of integration to its org fails: MBCDrift does not compile without MBC_Drift__c"
  else
    record DRIFT-INTEGRATION FAIL "the dry run of integration fails for another reason, see drift-dry-integration.json"
  fi
  if dry_run uat drift-dry-uat; then
    record DRIFT-UAT OK "a full deployment of uat to its org still passes"
  else
    record DRIFT-UAT FAIL "the dry run of uat fails, see drift-dry-uat.json"
  fi
fi

# ------------------------------------------------------------------ check-running: the checks start, the pipeline shows them running
if step check-running; then
  say "check-running: the checks of integration and uat start"
  rm -f "$LOGS/.gh-mbc-dispatch"
  rm -f "$LOGS"/mbc-*.code "$LOGS"/mbc-*.run "$LOGS"/mbc-*.job "$LOGS"/mbc-*.build "$LOGS"/mbc-*.pipeline
  for b in integration uat; do
    if start_major_branch_check "$b" "mbc-$b"; then
      record "START-$b" OK "check of $b started: $(cat "$LOGS/mbc-$b.trigger")"
    elif grep -q "^not run\|build minutes used up" "$LOGS/mbc-$b.log" 2>/dev/null; then
      record "START-$b" SKIP "check of $b not started: $(head -1 "$LOGS/mbc-$b.log")"
    else
      record "START-$b" FAIL "check of $b not started: $(head -1 "$LOGS/mbc-$b.log" 2>/dev/null)"
    fi
  done
  # GitHub: the run of integration checks main too, its log is read in assert-ci
  [ -n "${CI_MAJOR_BRANCH_CHECK_ALL:-}" ] && start_major_branch_check main mbc-main >/dev/null
  state=""
  if [ "$(cat "$LOGS/mbc-integration.code" 2>/dev/null)" = "9" ]; then
    state="not started"
  else
    for _ in $(seq 1 40); do
      state=$(ci_major_branch_check_state integration mbc-integration)
      [ "$state" = "running" ] || [ "$state" = "done" ] && break
      sleep 15
    done
  fi
  if [ "$state" = "not started" ]; then
    record CHECK-RUNNING SKIP "the check of integration was not started"
  elif [ "$state" = "done" ]; then
    record CHECK-RUNNING SKIP "the check of integration ended before it was seen running"
  else
    cat >"$LOGS/expect-running.json" <<'JSON'
{
  "label": "the checks of integration and uat run",
  "majorBranchDeploymentCheckEnabled": true,
  "branchChecks": { "integration": { "status": ["running", "pending"], "stale": false } },
  "nodeClasses": { "integration": "gitBranchCheckRunning" },
  "deployArrows": { "integration": "success" }
}
JSON
    mbc_pipeline pipeline-running "$LOGS/expect-running.json"
    after=$(ci_major_branch_check_state integration mbc-integration)
    if [ "$(cat "$LOGS/pipeline-running.code")" != "0" ] && [ "$after" = "done" ]; then
      record CHECK-RUNNING SKIP "the check of integration ended while the pipeline was read: run the step again"
    else
      pipeline_assert CHECK-RUNNING pipeline-running "integration shows a running check (state seen: ${state:-unknown}), the deployment arrow keeps the deployment status"
    fi
  fi
fi

# ------------------------------------------------------------------ assert-ci: what the check jobs did
if step assert-ci; then
  say "assert-ci: waiting for the check jobs"
  BRANCHES="integration uat"
  [ -n "${CI_MAJOR_BRANCH_CHECK_ALL:-}" ] && BRANCHES="$BRANCHES main"
  for b in $BRANCHES; do ci_wait_major_branch_check "$b" "mbc-$b"; done
  if job_ran CI-INTEGRATION mbc-integration; then
    assert_log CI-INTEGRATION mbc-integration 1 "the check of integration fails: MBCDrift does not compile, MBC_Drift__c exists nowhere" "MBC_Drift__c"
  fi
  if job_ran CI-UAT mbc-uat; then
    assert_log CI-UAT mbc-uat 0 "the check of uat succeeds"
  fi
  for b in $BRANCHES; do
    job_ran "CI-$b-MODE" "mbc-$b" || continue
    assert_log "CI-$b-MODE" "mbc-$b" - "full simulation of $b against its org, no Pull Request comment, deployment actions skipped" \
      "Major branch deployment check of $b: full simulation against its org, without Pull Request comment nor deployment action\." \
      "Major branch deployment check: using full deployment mode\." \
      "Major branch deployment check: .+ skipped, they ran when the branch was deployed\." \
      "Major branch deployment check: no Pull Request comment posted\." \
      "!MBC_PRE_DEPLOY_MARKER"
  done
  if [ -z "${PR_N:-}" ]; then
    record CI-COMMENTS SKIP "no Pull Request N recorded (deploy step not run)"
  else
    ci_pr_comments_ids "$PR_N" pr-comments-after
    if cmp -s "$LOGS/pr-comments-before.json" "$LOGS/pr-comments-after.json"; then
      record CI-COMMENTS OK "the comments of #$PR_N are the ones recorded after its deployment (ids and bodies)"
    else
      record CI-COMMENTS FAIL "the comments of #$PR_N changed: compare pr-comments-before.json and pr-comments-after.json"
    fi
  fi
fi

# ------------------------------------------------------------------ assert-pipeline: the results on the branch nodes
if step assert-pipeline; then
  say "assert-pipeline: the DevOps Pipeline after the checks"
  if [ -n "${CI_MAJOR_BRANCH_CHECK_ALL:-}" ]; then
    MAIN_CHECK='{ "status": "success", "stale": false, "staleReason": null }'
    MAIN_CLASS=gitBranchCheckSuccess
  else
    MAIN_CHECK=null
    MAIN_CLASS=gitMain
  fi
  cat >"$LOGS/expect-checks.json" <<JSON
{
  "label": "after the checks of integration and uat",
  "majorBranchDeploymentCheckEnabled": true,
  "branchChecks": {
    "integration": { "status": "failed", "stale": false, "staleReason": null },
    "uat": { "status": "success", "stale": false, "staleReason": null },
    "main": $MAIN_CHECK
  },
  "nodeClasses": { "integration": "gitBranchCheckFailed", "uat": "gitBranchCheckSuccess", "main": "$MAIN_CLASS" },
  "deployArrows": { "integration": "success" },
  "checkLinks": true
}
JSON
  mbc_pipeline pipeline-checks "$LOGS/expect-checks.json"
  pipeline_assert PIPELINE-CHECKS pipeline-checks "integration failed, uat success, main ${MAIN_CLASS}; the arrow of integration keeps the deployment status; the check links open the provider"
  finished=$(json_of "(j.branchChecks&&j.branchChecks.integration||{}).finishedAt" <"$LOGS/pipeline-checks.json" 2>/dev/null)
  [ -n "$finished" ] && save INT_CHECK_FINISHED "$finished"
fi

# ------------------------------------------------------------------ stale-deployed: uat deployed after its check
if step stale-deployed; then
  say "stale-deployed: a Pull Request merged into uat"
  cd "$WORK" || exit 1
  git fetch -q origin
  git checkout -q -f -B feature/mbc-uat-change origin/uat
  sed -i 's#<shortDescription>MBC Label</shortDescription>#<shortDescription>MBC Label changed in uat</shortDescription>#' force-app/main/default/labels/CustomLabels.labels-meta.xml
  grep -q 'MBC Label changed in uat' force-app/main/default/labels/CustomLabels.labels-meta.xml || {
    record STALE-DEPLOYED FAIL "the label edit did not apply"
    exit 1
  }
  git commit -qam "feat: label changed in uat" && git push -q -u origin feature/mbc-uat-change
  printf 'MBC-2: a change deployed to uat after its major branch check.\n' >"$LOGS/bodies/uat.md"
  PR_U=$(p_open feature/mbc-uat-change uat "MBC-2 label change in uat" "$LOGS/bodies/uat.md") || {
    record STALE-DEPLOYED FAIL "Pull Request into uat not opened"
    exit 1
  }
  save PR_U "$PR_U"
  ci_wait_check "$PR_U" "$(git rev-parse HEAD)" uat-check
  p_merge "$PR_U" >/dev/null || record STALE-MERGE FAIL "merge of #$PR_U"
  ci_wait_deploy uat "$(ci_merge_sha "$PR_U")" uat-deploy
  assert_log STALE-UAT-DEPLOY uat-deploy 0 "#$PR_U is deployed to uat after the check of uat started"
  cat >"$LOGS/expect-stale-deployed.json" <<'JSON'
{
  "label": "uat deployed after its check",
  "branchChecks": { "uat": { "status": "success", "stale": true, "staleReason": "deployedAfter" } },
  "nodeClasses": { "uat": "gitBranchCheckSuccessStale" },
  "deployArrows": { "uat": "success" }
}
JSON
  mbc_pipeline pipeline-stale-deployed "$LOGS/expect-stale-deployed.json"
  pipeline_assert STALE-DEPLOYED pipeline-stale-deployed "the check of uat is stale: uat was deployed after it started"
fi

# ------------------------------------------------------------------ stale-age: the check of integration 25 hours later
if step stale-age; then
  if [ -z "${INT_CHECK_FINISHED:-}" ]; then
    record STALE-AGE SKIP "no finishedAt for the check of integration (assert-pipeline did not read one)"
  else
    NOW_LATER=$(node -e "console.log(new Date(Date.parse(process.argv[1]) + 25 * 3600 * 1000).toISOString())" "$INT_CHECK_FINISHED")
    cat >"$LOGS/expect-stale-age.json" <<'JSON'
{
  "label": "25 hours after the check of integration",
  "branchChecks": { "integration": { "status": "failed", "stale": true, "staleReason": "age" } },
  "nodeClasses": { "integration": "gitBranchCheckFailedStale" }
}
JSON
    mbc_pipeline pipeline-stale-age "$LOGS/expect-stale-age.json" --now "$NOW_LATER"
    pipeline_assert STALE-AGE pipeline-stale-age "with --now $NOW_LATER (finished $INT_CHECK_FINISHED + 25h, validity 24h) the check of integration is stale by age"
  fi
fi

# ------------------------------------------------------------------ off: the setting off hides every check
if step off; then
  say "off: enableMajorBranchDeploymentCheck false"
  cd "$WORK" || exit 1
  git checkout -q -f main
  sed -i 's/^enableMajorBranchDeploymentCheck: true$/enableMajorBranchDeploymentCheck: false/' config/.sfdx-hardis.yml
  if ! grep -q '^enableMajorBranchDeploymentCheck: false$' config/.sfdx-hardis.yml; then
    record OFF FAIL "the config edit did not apply"
  else
    # Committed in the local clone only (the extension reads the checkout; a push to main would
    # start a deployment job), and undone right after so every step can be replayed
    git commit -qam "chore: major branch deployment check off"
    cat >"$LOGS/expect-off.json" <<'JSON'
{
  "label": "enableMajorBranchDeploymentCheck: false",
  "majorBranchDeploymentCheckEnabled": false,
  "branchChecks": { "integration": null, "uat": null, "main": null },
  "nodeClasses": { "integration": "gitMajor", "uat": "gitMajor", "main": "gitMain" },
  "deployArrows": { "integration": "success" }
}
JSON
    mbc_pipeline pipeline-off "$LOGS/expect-off.json"
    pipeline_assert OFF pipeline-off "no check on any branch node, classes gitMajor / gitMain, the deployment arrow unchanged"
    git -C "$WORK" reset -q --hard HEAD~1
  fi
fi

# ------------------------------------------------------------------ not-major: refused outside a major branch
if step not-major; then
  cd "$WORK" || exit 1
  git fetch -q origin
  git checkout -q -f -B feature/mbc-not-major origin/integration
  # CI=true: no interactive prompt, like a CI job
  env -u NODE_OPTIONS CI=true node "$DEV" hardis:project:deploy:smart --check --major-branch-check --target-org "$ORG" >"$LOGS/not-major.log" 2>&1
  echo $? >"$LOGS/not-major.code"
  if [ "$(cat "$LOGS/not-major.code")" = "0" ]; then
    record NOT-MAJOR FAIL "not-major: --major-branch-check on feature/mbc-not-major ended with exit 0"
  else
    assert_log NOT-MAJOR not-major - "--major-branch-check is refused on a branch with no branch config file" \
      "runs only on a major branch: feature/mbc-not-major has no branch config file in config/branches\."
  fi
fi

# ------------------------------------------------------------------ report (the last result of each id)
if step report; then
  awk -F'\t' '{last[$1]=$0; if(!($1 in seen)){order[++n]=$1; seen[$1]=1}} END{for(i=1;i<=n;i++) print last[order[i]]}' "$RESULTS" >"$LOGS/results-last.tsv"
  ok=$(grep -c $'\tOK\t' "$LOGS/results-last.tsv")
  fail=$(grep -c $'\tFAIL\t' "$LOGS/results-last.tsv")
  skip=$(grep -c $'\tSKIP\t' "$LOGS/results-last.tsv")
  case "$PROVIDER" in
  github) REPO_URL="https://github.com/${REPO:-?}" ;;
  gitlab) REPO_URL="${GL_HOST:-?}/${PROJECT_PATH:-?}" ;;
  azure) REPO_URL="${AZ_PROJECT_URL:-?}/_git/${AZ_REPO_NAME:-?}" ;;
  bitbucket) REPO_URL="https://bitbucket.org/${BB_WORKSPACE:-?}/${BB_REPO:-?}" ;;
  esac
  {
    echo "# Major branch deployment check e2e - $RUN"
    echo
    echo "- provider: $PROVIDER, repository: $REPO_URL"
    echo "- sfdx-hardis branch: $SFDX_HARDIS_BRANCH ($(git -C "$ROOT" rev-parse --short HEAD))"
    echo "- extension: $EXT ($(git -C "$EXT" branch --show-current 2>/dev/null) $(git -C "$EXT" rev-parse --short HEAD 2>/dev/null))"
    echo "- org: $ORG (${ORG_USERNAME:-?}) for integration, uat and main"
    echo "- Pull Requests: N #${PR_N:-?} into integration, #${PR_U:-?} into uat"
    echo "- result: $ok OK, $fail FAIL, $skip SKIP"
    echo
    echo "| Check | Result | Detail |"
    echo "|-------|--------|--------|"
    awk -F'\t' '{gsub(/\|/,"\\|",$3); printf "| %s | %s | %s |\n", $1, $2, $3}' "$LOGS/results-last.tsv"
    echo
    echo "## How each check was started"
    echo
    for f in "$LOGS"/mbc-*.trigger; do
      [ -f "$f" ] && echo "- $(basename "$f" .trigger): $(cat "$f")"
    done
    echo
    echo "## CI jobs"
    echo
    echo '```'
    column -t -s $'\t' "$LOGS/ci-jobs.tsv" 2>/dev/null || cat "$LOGS/ci-jobs.tsv"
    echo '```'
  } >"$LOGS/report.md"
  say "report: $LOGS/report.md ($ok OK, $fail FAIL, $skip SKIP)"
fi
echo "MBC E2E DONE"

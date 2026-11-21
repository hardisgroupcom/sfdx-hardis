#!/usr/bin/env bash
# sf hardis:project:deploy:cancel, end to end, in REAL CI jobs (GitHub Actions, GitLab CI or Azure
# Pipelines) running sfdx-hardis built from the branch under test, against one throwaway org.
#
# The sample project runs about 7 minutes of Apex tests in each deployment simulation, so a CI job
# can be cancelled while its simulation runs in the org. Each step reads the DeployRequest records
# of the org (Tooling API) to prove what happened there, not only what the job log says.
#
#   PROVIDER=github bash dc-e2e.sh                       # the whole run (github, gitlab, azure)
#   PROVIDER=github RUN=<run> STEPS="timeout report" bash dc-e2e.sh   # replay steps of a run
#
# Steps, in order: org repo new-commit other-pr deploy-order deploy-order-check timeout failed-sim report
#
# Settings (environment, then the .env of the sfdx-hardis working copy):
#   PROVIDER            github (default), gitlab or azure
#   DEVHUB              Dev Hub that creates the scratch org (default DevHub)
#   DC_ORG              org of the three major branches (default: a new scratch org dc-e2e-<provider>-<date>)
#   SFDX_HARDIS_BRANCH  branch the jobs build (default: current, pushed)
#   SFDX_HARDIS_REPO    repository the jobs clone it from (default hardisgroupcom/sfdx-hardis; a fork for
#                       the Pull Request of a contributor)
#   RUN                 run name (default dc-e2e-<provider>-<date>): WORK and LOGS under the OS temp dir
#   DC_TEST_CLASSES, DC_TEST_METHODS   slow test classes and methods of the project (default 8 x 8,
#                       about 7 minutes of tests per simulation)
#   DC_PROVIDER_CANCEL_SECONDS  how long a new commit has to cancel the previous job (default 300)
#   DC_TIMEOUT_MINUTES  timeout of the check job of the timeout step (default: computed from the
#                       new-commit step, the time a job takes to start its simulation plus 90 seconds)
#   GitHub: GH_E2E_OWNER. GitLab: GITLAB_E2E_HOST, GITLAB_E2E_GROUP. Azure: AZ_ORG, AZ_PROJECT,
#   AZURE_PERSONAL_ACCESS_TOKEN (see ../../promotion-branches/scripts/ci-provider-<provider>.sh)
#
# Results: $LOGS/results.tsv (id, OK|FAIL|SKIP, detail), report in $LOGS/report.md
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMO_SCRIPTS="$(cd "$HERE/../../promotion-branches/scripts" && pwd)"
export PROVIDER="${PROVIDER:-github}"
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/env-lib.sh"
e2e_defaults
e2e_load_env DEVHUB DC_ORG SFDX_HARDIS_REPO GH_E2E_OWNER GITLAB_E2E_HOST GITLAB_E2E_GROUP AZ_ORG AZ_PROJECT
ROOT="$E2E_ROOT"
DEVHUB="${DEVHUB:-DevHub}"
STAMP="$(date +%m%d%H%M)"
RUN="${RUN:-dc-e2e-$PROVIDER-$(date +%Y%m%d-%H%M)}"
export WORK="${DC_WORK:-$E2E_TMP/$RUN}"
export LOGS="${DC_LOGS:-$E2E_TMP/$RUN-logs}"
SFDX_HARDIS_BRANCH="${SFDX_HARDIS_BRANCH:-$(git -C "$ROOT" branch --show-current)}"
export SFDX_HARDIS_REPO="${SFDX_HARDIS_REPO:-https://github.com/hardisgroupcom/sfdx-hardis.git}"
STEPS="${STEPS:-org repo new-commit other-pr deploy-order deploy-order-check timeout failed-sim report}"
DC_PROVIDER_CANCEL_SECONDS="${DC_PROVIDER_CANCEL_SECONDS:-300}"
mkdir -p "$LOGS/bodies"
export RESULTS="$LOGS/results.tsv"
touch "$RESULTS" "$LOGS/run.env"
[ -f "$LOGS/ci-jobs.tsv" ] || printf 'label\tprovider\tmode\trun\tresult\tqueued_s\tran_s\tbuild_minutes\n' >"$LOGS/ci-jobs.tsv"
# shellcheck source=/dev/null
source "$LOGS/run.env"
# shellcheck source=/dev/null
[ -f "$LOGS/ci-vars.sh" ] && source "$LOGS/ci-vars.sh"
export ORG="${DC_ORG:-dc-e2e-$PROVIDER-$STAMP}"
case "$PROVIDER" in
github)
  [ -n "${REPO:-}" ] || REPO="${GH_E2E_OWNER:-$(gh api user --jq .login)}/sfdx-hardis-dc-e2e-$STAMP"
  export REPO
  ;;
gitlab)
  [ -n "${GITLAB_E2E_PROJECT:-}" ] || [ -z "${PROJECT_PATH:-}" ] || GITLAB_E2E_PROJECT="${PROJECT_PATH##*/}"
  [ -n "${GITLAB_E2E_PROJECT:-}" ] || GITLAB_E2E_PROJECT="sfdx-hardis-dc-e2e-gl-$STAMP"
  export GITLAB_E2E_PROJECT
  ;;
azure)
  [ -n "${AZ_REPO_NAME:-}" ] || AZ_REPO_NAME="sfdx-hardis-dc-e2e-az-$STAMP"
  export AZ_REPO_NAME
  ;;
*)
  echo "PROVIDER=$PROVIDER: github, gitlab or azure (Bitbucket runs no script for a stopped step, see the README)"
  exit 2
  ;;
esac

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
json_of() { node -e "const t=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(t.slice(t.indexOf('{')));const v=($1);process.stdout.write(v===undefined||v===null?'':String(v))}catch(e){}"; }
provider_lib() {
  # shellcheck source=/dev/null
  source "$PROMO_SCRIPTS/promotion-provider.sh"
}
iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
iso_ago() { date -u -d "-$1 seconds" +%Y-%m-%dT%H:%M:%SZ; }
# Seconds from the first ISO date to the second
secs() { node -e "const a=Date.parse(process.argv[1]),b=Date.parse(process.argv[2]);console.log(isNaN(a)||isNaN(b)?'':Math.round((b-a)/1000))" "$1" "$2"; }
# The cancel messages of sf hardis:project:deploy:cancel (src/i18n/en.json)
MSG_CANCELLING="Cancelling deployment simulation"
MSG_CANCELLED_RE() { echo "Deployment simulation $1 cancelled in org"; }

# ------------------------------------------------------------------ the org: DeployRequest records
# One line per DeployRequest: Id Status CheckOnly CreatedDate StartDate CompletedDate ("-" when empty)
dr_rows() {
  env -u NODE_OPTIONS sf data query --use-tooling-api -o "$ORG" --json \
    -q "SELECT Id, Status, CheckOnly, CreatedDate, StartDate, CompletedDate FROM DeployRequest WHERE $1 ORDER BY CreatedDate ASC LIMIT 50" 2>/dev/null |
    node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{try{const j=JSON.parse(s.slice(s.indexOf('{')));for(const r of (j.result||{}).records||[])console.log([r.Id,r.Status,r.CheckOnly,r.CreatedDate||'-',r.StartDate||'-',r.CompletedDate||'-'].join(' '))}catch(e){}})"
}
# A field of one DeployRequest: dr_field <id> <Status|CheckOnly|CreatedDate|StartDate|CompletedDate>
dr_field() {
  local n
  case "$2" in Status) n=2 ;; CheckOnly) n=3 ;; CreatedDate) n=4 ;; StartDate) n=5 ;; CompletedDate) n=6 ;; esac
  dr_rows "Id = '$1'" | awk -v n="$n" '{print $n}'
}
# The first check-only DeployRequest created since <iso>, not in <excluded ids>, whose status matches
# <regex>, waited for up to <seconds>. Usage: dr_wait_new <iso> "<excluded ids>" <regex> <seconds>
dr_wait_new() {
  local since="$1" excluded="$2" re="$3" limit="$4" waited=0 t0w=$SECONDS id
  while [ "$waited" -lt "$limit" ]; do
    no_foreign_prs
    id=$(dr_rows "CheckOnly = true AND CreatedDate >= $since" | awk -v ex=" $excluded " -v re="$re" 'index(ex, " " $1 " ") == 0 && $2 ~ re {print $1; exit}')
    [ -n "$id" ] && echo "$id" && return 0
    sleep 15
    waited=$((SECONDS - t0w))
  done
  return 1
}
# Wait for a DeployRequest to reach a final status, print it. Usage: dr_wait_final <id> <seconds>
dr_wait_final() {
  local id="$1" limit="$2" waited=0 t0w=$SECONDS status
  while [ "$waited" -le "$limit" ]; do
    status=$(dr_field "$id" Status)
    case "$status" in Succeeded | SucceededPartial | Failed | Canceled) echo "$status" && return 0 ;; esac
    sleep 15
    waited=$((SECONDS - t0w))
  done
  echo "${status:-unknown}"
  return 1
}
# The org runs one deployment at a time: wait until nothing runs nor waits there (a previous step
# may have left a simulation behind)
org_idle() {
  local waited=0 t0w=$SECONDS busy
  no_foreign_prs
  while [ "$waited" -lt 1200 ]; do
    busy=$(dr_rows "Status IN ('Pending','InProgress','Canceling')" | head -1)
    [ -z "$busy" ] && return 0
    sleep 20
    waited=$((SECONDS - t0w))
  done
  say "the org still runs $busy after 20 minutes"
}
dr_dump() { dr_rows "CreatedDate >= $1" >"$LOGS/$2.dr"; }
# GitHub: a Pull Request the test did not open (the Renovate app of the account opens one on a new
# repository, 2026-11-21) runs a check job, whose simulation would take the place of the one a step
# waits for. Closed, and its runs cancelled. renovate.json of the project already disables Renovate.
no_foreign_prs() {
  [ "$PROVIDER" = "github" ] || return 0
  local n branch id
  gh pr list -R "$REPO" --state open --json number,headRefName --jq '.[] | select(.headRefName | startswith("feature/dc-") | not) | "\(.number) \(.headRefName)"' 2>/dev/null |
    while read -r n branch; do
      [ -n "$n" ] || continue
      gh pr close "$n" -R "$REPO" --delete-branch >/dev/null 2>&1
      for id in $(gh run list -R "$REPO" --branch "$branch" -L 10 --json databaseId,status --jq '.[] | select(.status != "completed") | .databaseId' 2>/dev/null); do
        gh run cancel "$id" -R "$REPO" >/dev/null 2>&1
      done
      say "Pull Request #$n ($branch) not opened by the test: closed, its check jobs cancelled"
    done
}

# ------------------------------------------------------------------ provider: the check job of a commit
# dc_find_check <pr> <sha>: the id of the check job (GitHub run, GitLab job, Azure build), or nothing
dc_find_check() {
  case "$PROVIDER" in
  github) gh run list -R "$REPO" --workflow check-deploy.yml --commit "$2" -L 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null ;;
  gitlab)
    local pipeline
    pipeline=$(gl_api GET "projects/$PROJECT_ID/merge_requests/$1/pipelines" | _glci_json "(d.filter(p=>p.sha==='$2').sort((a,b)=>b.id-a.id)[0]||{}).id")
    [[ "$pipeline" =~ ^[0-9]+$ ]] || return 0
    gl_api GET "projects/$PROJECT_ID/pipelines/$pipeline/jobs?per_page=100" | _glci_json "(d.filter(j=>j.name==='$CI_CHECK_JOB').sort((a,b)=>b.id-a.id)[0]||{}).id"
    ;;
  azure) _azci_find_build check "$1" "$2" 0 | awk '{print $1}' ;;
  esac
}
# Wait until the check job of a commit exists, print its id. Usage: dc_wait_find <pr> <sha> [seconds]
dc_wait_find() {
  local id waited=0 t0w=$SECONDS limit="${3:-900}"
  while [ "$waited" -lt "$limit" ]; do
    id=$(dc_find_check "$1" "$2")
    [ -n "$id" ] && echo "$id" && return 0
    sleep 15
    waited=$((SECONDS - t0w))
  done
  return 1
}
# Wait until the check job of a commit has started its simulation in the org: prints
# "<job id> <DeployRequest id>", or the job id alone when the job ended first or the time ran out.
# A GitLab job that failed on a runner with a full disk before sfdx-hardis started (ENOSPC in yarn
# install, 2026-11-21) is retried, as _glci_wait_job does: it says nothing about the branch under test.
# Usage: dc_wait_sim <pr> <sha> <since iso> "<excluded ids>" <status regex> <seconds>
dc_wait_sim() {
  local pr="$1" sha="$2" since="$3" excluded="$4" re="$5" limit="$6" t0w=$SECONDS job dr new
  job=$(dc_wait_find "$pr" "$sha") || return 1
  while [ $((SECONDS - t0w)) -lt "$limit" ]; do
    no_foreign_prs
    dr=$(dr_rows "CheckOnly = true AND CreatedDate >= $since" | awk -v ex=" $excluded " -v re="$re" 'index(ex, " " $1 " ") == 0 && $2 ~ re {print $1; exit}')
    if [ -n "$dr" ]; then
      echo "$job $dr"
      return 0
    fi
    case "$(dc_state "$job")" in
    done:*)
      if [ "$PROVIDER" = "gitlab" ] && gl_api GET "projects/$PROJECT_ID/jobs/$job/trace" | grep -aqF "ENOSPC: no space left on device"; then
        new=$(gl_api POST "projects/$PROJECT_ID/jobs/$job/retry" | _glci_json 'd.id')
        if [[ "$new" =~ ^[0-9]+$ ]]; then
          say "job $job failed on a runner with a full disk (ENOSPC), retried as job $new" >&2
          job="$new"
          continue
        fi
      fi
      echo "$job"
      return 1
      ;;
    esac
    sleep 15
  done
  echo "$job"
  return 1
}
# dc_state <id>: pending, running, or done:<provider conclusion>
dc_state() {
  local answer
  case "$PROVIDER" in
  github)
    answer=$(gh run view "$1" -R "$REPO" --json status,conclusion --jq '.status+" "+.conclusion' 2>/dev/null)
    case "$answer" in completed*) echo "done:${answer#completed }" ;; in_progress*) echo running ;; *) echo pending ;; esac
    ;;
  gitlab)
    answer=$(gl_api GET "projects/$PROJECT_ID/jobs/$1" | _glci_json 'd.status')
    case "$answer" in success | failed | canceled | skipped) echo "done:$answer" ;; running) echo running ;; *) echo pending ;; esac
    ;;
  azure)
    answer=$(_azci_api GET "$AZ_PROJECT_URL/_apis/build/builds/$1?api-version=7.1" | _azci_json 'd.status+" "+(d.result||"")')
    case "$answer" in "completed "*) echo "done:${answer#completed }" ;; inProgress* | cancelling*) echo running ;; *) echo pending ;; esac
    ;;
  esac
}
# Cancel a check job the way a person does from the provider UI
dc_cancel() {
  case "$PROVIDER" in
  github) gh run cancel "$1" -R "$REPO" >/dev/null 2>&1 ;;
  gitlab) gl_api POST "projects/$PROJECT_ID/jobs/$1/cancel" >/dev/null ;;
  azure) _azci_api PATCH "$AZ_PROJECT_URL/_apis/build/builds/$1?api-version=7.1" -d '{"status":"cancelling"}' >/dev/null ;;
  esac
}
# Wait for a check job given by id, keep its log: same .log, .code, .mode and ci-jobs.tsv line as
# the waits of the harness
dc_wait_id() {
  local id="$1" label="$2" status
  case "$PROVIDER" in
  github)
    echo "$id" >"$LOGS/$label.run"
    _gh_wait_run_id "$id" "$label"
    ;;
  gitlab) _glci_wait_job "$id" "$label" ;;
  azure)
    echo "$id" >"$LOGS/$label.build"
    for _ in $(seq 1 360); do
      status=$(_azci_api GET "$AZ_PROJECT_URL/_apis/build/builds/$id?api-version=7.1" | _azci_json 'd.status')
      [ "$status" = "completed" ] && break
      sleep 20
    done
    _azci_finish_build "$id" "$label" "$status"
    ;;
  esac
}
# The provider conclusion of a job given by id once it ended (cancelled / canceled / success...)
dc_conclusion() {
  local s
  s=$(dc_state "$1")
  echo "${s#done:}"
}
dc_is_cancelled() { case "$(dc_conclusion "$1")" in cancelled | canceled) return 0 ;; *) return 1 ;; esac }
# When the job started running (ISO). GitHub: the job of the run, not the run
dc_started_at() {
  case "$PROVIDER" in
  github) gh api "repos/$REPO/actions/runs/$1/jobs" --jq '[.jobs[] | select(.started_at != null)][0].started_at // empty' 2>/dev/null ;;
  gitlab) gl_api GET "projects/$PROJECT_ID/jobs/$1" | _glci_json 'd.started_at' ;;
  azure) _azci_api GET "$AZ_PROJECT_URL/_apis/build/builds/$1?api-version=7.1" | _azci_json 'd.startTime' ;;
  esac
}
# "start end" (ISO) of a finished deployment job of a label
dc_times() {
  local label="$1"
  case "$PROVIDER" in
  # the job, not the run: a run waiting for its concurrency group gets its start time when it is created
  github) gh api "repos/$REPO/actions/runs/$(cat "$LOGS/$label.run")/jobs" --jq '[.jobs[] | select(.started_at != null)][0] | .started_at+" "+.completed_at' 2>/dev/null ;;
  gitlab) gl_api GET "projects/$PROJECT_ID/jobs/$(cat "$LOGS/$label.job")" | _glci_json 'd.started_at+" "+d.finished_at' ;;
  azure) _azci_api GET "$AZ_PROJECT_URL/_apis/build/builds/$(cat "$LOGS/$label.build")?api-version=7.1" | _azci_json 'd.startTime+" "+d.finishTime' ;;
  esac
}
# Cancel every check job still queued or running for a Pull Request (the checks the deploy-order step
# does not need: they would keep the org busy)
dc_cancel_pr_checks() {
  local pr="$1" branch="$2" id
  case "$PROVIDER" in
  github)
    for id in $(gh run list -R "$REPO" --workflow check-deploy.yml --branch "$branch" -L 20 --json databaseId,status --jq '.[] | select(.status != "completed") | .databaseId' 2>/dev/null); do
      gh run cancel "$id" -R "$REPO" >/dev/null 2>&1 && say "check run $id of #$pr cancelled"
    done
    ;;
  gitlab)
    for id in $(gl_api GET "projects/$PROJECT_ID/merge_requests/$pr/pipelines" | _glci_json "(Array.isArray(d)?d:[]).filter(p=>['created','pending','running','waiting_for_resource','preparing'].includes(p.status)).map(p=>p.id).join(' ')"); do
      gl_api POST "projects/$PROJECT_ID/pipelines/$id/cancel" >/dev/null && say "pipeline $id of !$pr cancelled"
    done
    ;;
  azure)
    for id in $(_azci_api GET "$AZ_PROJECT_URL/_apis/build/builds?definitions=$AZ_CHECK_DEF_ID&reasonFilter=pullRequest&statusFilter=notStarted,inProgress&api-version=7.1" |
      PR="$pr" _azci_json "(d.value||[]).filter(b=>String((b.triggerInfo||{})['pr.number'])===process.env.PR).map(b=>b.id).join(' ')"); do
      dc_cancel "$id" && say "build $id of PR $pr cancelled"
    done
    ;;
  esac
}
# A step starts clean, which matters when it is replayed: the Pull Requests of its branches are
# closed and their check jobs cancelled (a job of a closed Pull Request keeps running, 2026-11-21:
# its simulation took the place of the one the step waited for), then the org runs nothing.
# Usage: reset_step <branch>...
reset_step() {
  local branch old
  for branch in "$@"; do
    old=$(p_open_number_for_branch "$branch" 2>/dev/null)
    dc_cancel_pr_checks "${old:-0}" "$branch"
    [ -n "$old" ] && p_close "$old" >/dev/null 2>&1
  done
  org_idle
}
# A story branch from integration: one small Apex class. Usage: new_story <branch> <class suffix>
new_story() {
  local branch="$1" name="DCStory$2"
  cd "$WORK" || return 1
  git fetch -q origin
  git checkout -q -f -B "$branch" origin/integration
  cat >"force-app/main/default/classes/$name.cls" <<APEX
public with sharing class $name {
    public static String story() {
        return '$2';
    }
}
APEX
  # Its test: with RunLocalTests, a class no test covers fails the simulation (average coverage 0%)
  cat >"force-app/main/default/classes/${name}Test.cls" <<APEX
@IsTest
private class ${name}Test {
    @IsTest
    static void story() {
        System.assertEquals('$2', $name.story(), 'the story of the class');
    }
}
APEX
  local cls
  for cls in "$name" "${name}Test"; do
    cat >"force-app/main/default/classes/$cls.cls-meta.xml" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>$API</apiVersion>
    <status>Active</status>
</ApexClass>
XML
  done
  # forced: a replayed step writes its branch again (throwaway repository)
  git add -A && git commit -qm "feat: $name" && git push -q -f -u origin "$branch"
}
# A second commit on a story branch (a comment in its class)
story_amend() {
  cd "$WORK" || return 1
  git checkout -q -f "$1"
  printf '// %s\n' "$2" >>"force-app/main/default/classes/DCStory$3.cls"
  git add -A && git commit -qm "chore: $2" && git push -q origin "$1"
}
open_story() {
  local body="$LOGS/bodies/${1//\//-}.md"
  printf '%s\n' "$4" >"$body"
  p_open "$1" integration "$3" "$body"
}
# The timeout of the check job, for the timeout step (GitHub: the repository variable the template
# reads; GitLab and Azure: the YAML of the story branch, which its Pull Request pipeline runs)
dc_set_timeout() {
  local minutes="$1"
  case "$PROVIDER" in
  github) gh variable set CI_JOB_TIMEOUT_MINUTES -R "$REPO" --body "$minutes" >/dev/null ;;
  gitlab)
    node -e "
const fs=require('fs');const f=process.argv[1];const l=fs.readFileSync(f,'utf8').split('\n');
const s=l.indexOf('check_deploy_to_target_branch_org:');let e=l.findIndex((x,i)=>i>s&&/^\S/.test(x));if(e<0)e=l.length;
const t=l.findIndex((x,i)=>i>s&&i<e&&/^  timeout:/.test(x));if(t<0){console.error('no timeout line');process.exit(1)}
l[t]='  timeout: '+(Number(process.argv[2])+5)+' minutes # E2E ONLY: the timeout step of deploy-cancel, the script stops 5 minutes before';
const v=l.findIndex((x,i)=>i>s&&i<e&&/^  variables:/.test(x));if(v<0){console.error('no variables block');process.exit(1)}
l.splice(v+1,0,'    RUNNER_SCRIPT_TIMEOUT: '+process.argv[2]+'m # E2E ONLY: the timeout step of deploy-cancel');fs.writeFileSync(f,l.join('\n'))" "$(native "$WORK/.gitlab-ci.yml")" "$minutes"
    ;;
  azure)
    node -e "
const fs=require('fs');const f=process.argv[1];const l=fs.readFileSync(f,'utf8').split('\n');
const t=l.findIndex(x=>/^    timeoutInMinutes:/.test(x));if(t<0){console.error('no timeoutInMinutes line');process.exit(1)}
l[t]='    timeoutInMinutes: '+process.argv[2]+' # E2E ONLY: the timeout step of deploy-cancel';fs.writeFileSync(f,l.join('\n'))" "$(native "$WORK/azure-pipelines-checks.yml")" "$minutes"
    ;;
  esac
}
dc_reset_timeout() {
  [ "$PROVIDER" = "github" ] && gh variable delete CI_JOB_TIMEOUT_MINUTES -R "$REPO" >/dev/null 2>&1
  return 0
}

say "run $RUN - provider $PROVIDER - work $WORK - logs $LOGS - branch under test $SFDX_HARDIS_BRANCH from $SFDX_HARDIS_REPO - org $ORG"

# ------------------------------------------------------------------ org: one org for the three major branches
if step org; then
  if ! env -u NODE_OPTIONS sf org display -o "$ORG" --json 2>/dev/null | grep -qE '"connectedStatus": "Connected"|"status": "Active"'; then
    env -u NODE_OPTIONS sf org create scratch --target-dev-hub "$DEVHUB" --alias "$ORG" --edition developer --duration-days 2 --wait 30 --json >"$LOGS/org-create.json" 2>&1 || {
      record ORG FAIL "scratch org not created, see org-create.json"
      exit 1
    }
  fi
  save DC_ORG "$ORG"
  AUTH_URL=$(env -u NODE_OPTIONS sf org auth show-sfdx-auth-url -o "$ORG" --json 2>/dev/null | json_of "j.result.sfdxAuthUrl")
  [[ "$AUTH_URL" == force://* ]] || {
    record ORG FAIL "no sfdxAuthUrl for $ORG"
    exit 1
  }
  printf '%s' "$AUTH_URL" >"$LOGS/auth-url.txt"
  env -u NODE_OPTIONS sf org display -o "$ORG" --json >"$LOGS/org-display.json" 2>/dev/null
  save ORG_USERNAME "$(json_of "j.result.username" <"$LOGS/org-display.json")"
  save ORG_INSTANCE "$(json_of "j.result.instanceUrl" <"$LOGS/org-display.json")"
  if dr_rows "CreatedDate = TODAY" >/dev/null && [ -n "$(env -u NODE_OPTIONS sf data query --use-tooling-api -o "$ORG" -q "SELECT Id FROM DeployRequest LIMIT 1" --json 2>/dev/null | json_of 'j.status===0?"ok":""')" ]; then
    record ORG OK "org $ORG ready ($ORG_USERNAME), its DeployRequest records can be read (Tooling API)"
  else
    record ORG FAIL "DeployRequest cannot be read in $ORG: the steps could not prove anything in the org"
    exit 1
  fi
fi

# ------------------------------------------------------------------ repo: project, CI files, remote, logins
if step repo; then
  WORK="$WORK" API="$API" bash "$HERE/dc-build-project.sh" >"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "project not built, see build.log"
    exit 1
  }
  cd "$WORK" || exit 1
  for f in config/branches/.sfdx-hardis.*.yml; do
    printf 'targetUsername: %s\ninstanceUrl: %s\n' "$ORG_USERNAME" "$ORG_INSTANCE" >>"$f"
  done
  SFDX_HARDIS_REPO="$SFDX_HARDIS_REPO" node "$PROMO_SCRIPTS/ci-workflows-prepare.cjs" --provider "$PROVIDER" "$ROOT" "$(native "$WORK")" "$SFDX_HARDIS_BRANCH" >>"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "CI files not written, see build.log"
    exit 1
  }
  missing=""
  case "$PROVIDER" in
  github) grep -q "sf hardis:project:deploy:cancel" .github/workflows/check-deploy.yml || missing="check-deploy.yml" ;;
  gitlab) grep -q "sf hardis:project:deploy:cancel" .gitlab-ci.yml || missing=".gitlab-ci.yml" ;;
  azure) grep -q "sf hardis:project:deploy:cancel" azure-pipelines-checks.yml || missing="azure-pipelines-checks.yml" ;;
  esac
  if [ -n "$missing" ]; then
    record REPO-TEMPLATE FAIL "$missing of the branch under test does not call sf hardis:project:deploy:cancel"
    exit 1
  fi
  record REPO-TEMPLATE OK "the check job of the template calls sf hardis:project:deploy:cancel when it is cancelled"
  # The scheduled major branch check (cron 1am UTC) would start simulations of every major branch in
  # the same org during the run (2026-11-21): not part of this scenario
  rm -f .github/workflows/check-major-branch-deploy.yml
  git add -A && git commit -qm "chore: CI files of the sfdx-hardis branch $SFDX_HARDIS_BRANCH"
  : >"$LOGS/ci-vars.sh"
  ci_create_remote "$(cat "$LOGS/auth-url.txt")" >>"$LOGS/build.log" 2>&1 || {
    record REPO FAIL "remote not created, see build.log"
    exit 1
  }
  # shellcheck source=/dev/null
  source "$LOGS/ci-vars.sh"
  save REPO_READY 1
  record REPO OK "repository ${REPO:-${PROJECT_PATH:-${AZ_REPO_NAME:-?}}} with main integration uat, the CI files of $SFDX_HARDIS_BRANCH ($SFDX_HARDIS_REPO), the logins"
fi
if [ -n "${REPO_READY:-}" ]; then provider_lib; fi

# ------------------------------------------------------------------ new-commit: a new commit cancels the simulation
if step new-commit; then
  say "new-commit: a second commit on the Pull Request while its simulation runs"
  reset_step feature/dc-new-commit
  T0=$(iso_ago 60)
  new_story feature/dc-new-commit NewCommit >>"$LOGS/build.log" 2>&1
  SHA1=$(git -C "$WORK" rev-parse HEAD)
  PR_NC=$(open_story feature/dc-new-commit x "DC-1 new commit" "A story whose simulation a second commit cancels.") || {
    record NC-PR FAIL "Pull Request not opened, see p-open.err"
    exit 1
  }
  save PR_NC "$PR_NC"
  out=$(dc_wait_sim "$PR_NC" "$SHA1" "$T0" "" "InProgress" 1800)
  J1="${out%% *}"
  X0=""
  [ "$out" != "$J1" ] && X0="${out#* }"
  save J1 "$J1"
  if [ -n "$X0" ]; then
    save X0 "$X0"
    record NC-RUNNING OK "the simulation $X0 of the first commit runs in the org (check job $J1)"
  else
    record NC-RUNNING FAIL "no simulation started in the org for the check job ${J1:-none} of #$PR_NC (job $([ -n "$J1" ] && dc_state "$J1"))"
    exit 1
  fi
  save J1_STARTED "$(dc_started_at "$J1")"
  # CreatedDate, not StartDate: a deployment of someone else on the org delays StartDate, and the
  # timeout step would then wait for the end of the simulation
  save X0_STARTED "$(dr_field "$X0" CreatedDate)"
  save DC_SIM_OFFSET "$(secs "$J1_STARTED" "$X0_STARTED")"
  sleep 30
  story_amend feature/dc-new-commit "second commit" NewCommit >>"$LOGS/build.log" 2>&1
  SHA2=$(git -C "$WORK" rev-parse HEAD)
  save SHA2 "$SHA2"
  # The provider cancels the job of the previous commit (GitHub concurrency, GitLab auto-cancel of
  # redundant pipelines, Azure policy build of the new head): nothing is cancelled by the test here
  waited=0
  t0w=$SECONDS
  while [ "$waited" -lt "$DC_PROVIDER_CANCEL_SECONDS" ]; do
    case "$(dc_state "$J1")" in done:*) break ;; esac
    sleep 15
    waited=$((SECONDS - t0w))
  done
  if dc_is_cancelled "$J1"; then
    record NC-PROVIDER-CANCEL OK "the new commit cancelled the check job $J1 of the first one (${waited}s after the push)"
  else
    record NC-PROVIDER-CANCEL FAIL "the check job $J1 of the first commit is still $(dc_state "$J1") ${DC_PROVIDER_CANCEL_SECONDS}s after the new commit: the provider does not cancel it; cancelled by the test to go on"
    dc_cancel "$J1"
  fi
  dc_wait_id "$J1" nc-first
  assert_log NC-HOOK nc-first - "the cancelled job ran sf hardis:project:deploy:cancel, which cancelled $X0" "$MSG_CANCELLING $X0" "$(MSG_CANCELLED_RE "$X0")"
  if [ "$PROVIDER" = "gitlab" ]; then
    assert_log NC-GITLAB-AFTER-SCRIPT nc-first - "after_script, in a new container, saw CI_JOB_STATUS=canceled, logged in again and cancelled the simulation" \
      "E2E after_script CI_JOB_STATUS=canceled" "$MSG_CANCELLING $X0" "!E2E after_script: no build in /"
  fi
  status=$(dr_wait_final "$X0" 240)
  if [ "$status" = "Canceled" ]; then
    record NC-ORG-CANCELED OK "DeployRequest $X0 is Canceled in the org"
  else
    record NC-ORG-CANCELED FAIL "DeployRequest $X0 is $status in the org, not Canceled"
  fi
  if J2=$(dc_wait_find "$PR_NC" "$SHA2"); then
    dc_wait_id "$J2" nc-second
    assert_log NC-NEXT nc-second 0 "the simulation of the new commit succeeds and cancels nothing" "DC_PRE_DEPLOY_MARKER" "!$MSG_CANCELLING"
    if X1=$(dr_wait_new "$T0" "$X0" "Succeeded|Failed|Canceled|InProgress|Pending" 60); then
      x0s=$(dr_field "$X0" StartDate)
      x0e=$(dr_field "$X0" CompletedDate)
      x1s=$(dr_field "$X1" StartDate)
      x1e=$(dr_field "$X1" CompletedDate)
      gap=$(secs "$x0e" "$x1s")
      d0=$(secs "$x0s" "$x0e")
      d1=$(secs "$x1s" "$x1e")
      if [ -n "$gap" ] && [ -n "$d0" ] && [ -n "$d1" ] && [ "$gap" -le 600 ] && [ "$d0" -lt $((d1 - 60)) ]; then
        record NC-NO-WAIT OK "$X0 stopped after ${d0}s instead of running its ${d1}s of tests; $X1 of the new commit started ${gap}s after it ended"
      else
        record NC-NO-WAIT FAIL "$X0 ran ${d0:-?}s, $X1 ran ${d1:-?}s, gap ${gap:-?}s: the new simulation waited for the old one"
      fi
    else
      record NC-NO-WAIT FAIL "no simulation of the new commit found in the org"
    fi
  else
    record NC-NEXT FAIL "no check job for the new commit $SHA2"
  fi
  dr_dump "$T0" new-commit
fi

# ------------------------------------------------------------------ other-pr: cancelling one job leaves another Pull Request alone
if step other-pr; then
  say "other-pr: two simulations in the org, the check job of A cancelled by hand"
  reset_step feature/dc-pr-a feature/dc-pr-b
  T0=$(iso_ago 60)
  new_story feature/dc-pr-a PrA >>"$LOGS/build.log" 2>&1
  SHA_A=$(git -C "$WORK" rev-parse HEAD)
  new_story feature/dc-pr-b PrB >>"$LOGS/build.log" 2>&1
  SHA_B=$(git -C "$WORK" rev-parse HEAD)
  PR_A=$(open_story feature/dc-pr-a x "DC-2 PR A" "Story A: its check job is cancelled by hand.")
  save PR_A "$PR_A"
  out=$(dc_wait_sim "$PR_A" "$SHA_A" "$T0" "" "InProgress" 1800)
  JA="${out%% *}"
  XA=""
  [ "$out" != "$JA" ] && XA="${out#* }"
  if [ -n "$XA" ]; then
    record OP-A-RUNNING OK "the simulation $XA of A runs in the org (check job $JA)"
  else
    record OP-A-RUNNING FAIL "no simulation of A in the org (check job ${JA:-none} $([ -n "$JA" ] && dc_state "$JA"))"
    exit 1
  fi
  # B: a real Pull Request where jobs run in parallel; on Azure (one free parallel job, B would only
  # start after A) a simulation of B started from the workstation, the same way a job would
  JB=""
  if [ "$PROVIDER" = "azure" ]; then
    B_MODE="simulation of B started from the workstation: one free Azure parallel job, B's job would only start after A's"
    (cd "$WORK" && git checkout -q -f feature/dc-pr-b && env -u NODE_OPTIONS sf project deploy start --dry-run --manifest manifest/package.xml \
      --test-level RunLocalTests --target-org "$ORG" --async --json) >"$LOGS/op-b-local.json" 2>&1
    XB=$(json_of "j.result.id" <"$LOGS/op-b-local.json")
  else
    B_MODE="real Pull Request"
    PR_B=$(open_story feature/dc-pr-b x "DC-3 PR B" "Story B: its simulation runs while A is cancelled.")
    save PR_B "$PR_B"
    out=$(dc_wait_sim "$PR_B" "$SHA_B" "$T0" "$XA" "Pending|InProgress" 1800)
    JB="${out%% *}"
    XB=""
    [ "$out" != "$JB" ] && XB="${out#* }"
  fi
  if [ -n "$XB" ]; then
    record OP-B-STARTED OK "the simulation $XB of B waits in the org behind A ($B_MODE)"
  else
    record OP-B-STARTED FAIL "no simulation of B in the org ($B_MODE)"
    exit 1
  fi
  # Cancelled by hand, through the API of the provider, the way the Cancel button does
  dc_cancel "$JA"
  dc_wait_id "$JA" op-a
  if dc_is_cancelled "$JA"; then
    record OP-MANUAL-CANCEL OK "the check job $JA of A was cancelled by hand"
  else
    record OP-MANUAL-CANCEL FAIL "the check job $JA of A ended $(dc_conclusion "$JA") after a cancel by hand"
  fi
  assert_log OP-HOOK-A op-a - "the job of A cancelled its own simulation $XA, and only it" "$MSG_CANCELLING $XA" "$(MSG_CANCELLED_RE "$XA")" "!$XB"
  status=$(dr_wait_final "$XA" 240)
  if [ "$status" = "Canceled" ]; then
    record OP-A-CANCELED OK "DeployRequest $XA of A is Canceled"
  else
    record OP-A-CANCELED FAIL "DeployRequest $XA of A is $status"
  fi
  status=$(dr_wait_final "$XB" 1800)
  if [ "$status" = "Succeeded" ]; then
    record OP-B-SUCCEEDED OK "DeployRequest $XB of B is Succeeded: the cancellation of A left it alone"
  else
    record OP-B-SUCCEEDED FAIL "DeployRequest $XB of B is $status"
  fi
  if [ -n "$JB" ]; then
    dc_wait_id "$JB" op-b
    assert_log OP-JOB-B op-b 0 "the check job of B succeeds and cancels nothing" "DC_PRE_DEPLOY_MARKER" "!$MSG_CANCELLING"
  fi
  dr_dump "$T0" other-pr
fi

# ------------------------------------------------------------------ deploy-order: a new merge never cancels a deployment
if step deploy-order; then
  say "deploy-order: two merges into integration a few seconds apart"
  reset_step feature/dc-merge-1 feature/dc-merge-2
  T0=$(iso_ago 60)
  save DO_T0 "$T0"
  new_story feature/dc-merge-1 Merge1 >>"$LOGS/build.log" 2>&1
  new_story feature/dc-merge-2 Merge2 >>"$LOGS/build.log" 2>&1
  PR_M1=$(open_story feature/dc-merge-1 x "DC-4 merge 1" "First of two quick merges.")
  PR_M2=$(open_story feature/dc-merge-2 x "DC-5 merge 2" "Second of two quick merges.")
  save PR_M1 "$PR_M1"
  save PR_M2 "$PR_M2"
  p_merge "$PR_M1" >/dev/null || {
    record DO-MERGE FAIL "merge of #$PR_M1"
    exit 1
  }
  M1=$(ci_merge_sha "$PR_M1")
  save M1 "$M1"
  if [ "$PROVIDER" = "gitlab" ]; then
    # The resource group exists once a job uses it: then set it to run the jobs in pipeline order,
    # as the documentation tells
    rg=""
    for _ in $(seq 1 40); do
      rg=$(gl_api GET "projects/$PROJECT_ID/resource_groups/deploy-integration" | _glci_json 'd.key')
      [ -n "$rg" ] && break
      sleep 5
    done
    mode=$(gl_api PUT "projects/$PROJECT_ID/resource_groups/deploy-integration" -d process_mode=oldest_first | _glci_json 'd.process_mode')
    if [ "$mode" = "oldest_first" ]; then
      record DO-RESOURCE-GROUP OK "resource group deploy-integration set to oldest_first through the API, as the documentation says"
    else
      record DO-RESOURCE-GROUP FAIL "resource group deploy-integration: process_mode ${mode:-not set} (exists: ${rg:-no})"
    fi
  fi
  sleep 20
  p_merge "$PR_M2" >/dev/null || {
    record DO-MERGE FAIL "merge of #$PR_M2"
    exit 1
  }
  M2=$(ci_merge_sha "$PR_M2")
  save M2 "$M2"
  record DO-MERGE OK "#$PR_M1 then #$PR_M2 merged into integration about 20 seconds apart"
  # Their check jobs would keep the org busy: cancelled (a check job cancelled before its simulation
  # has nothing to cancel)
  dc_cancel_pr_checks "$PR_M1" feature/dc-merge-1
  dc_cancel_pr_checks "$PR_M2" feature/dc-merge-2
  ci_wait_deploy integration "$M1" do-deploy-1
  ci_wait_deploy integration "$M2" do-deploy-2
  for n in 1 2; do
    assert_log "DO-DEPLOY-$n" "do-deploy-$n" 0 "the deployment of merge $n succeeds, never cancelled, and runs its pre and post-deployment commands" \
      "DC_PRE_DEPLOY_MARKER" "DC_POST_DEPLOY_MARKER" "!$MSG_CANCELLING"
  done
fi

# ------------------------------------------------------------------ deploy-order-check: one after the other, in merge order
# Apart from deploy-order, so a check can be replayed without merging again
if step deploy-order-check; then
  read -r s1 e1 <<<"$(dc_times do-deploy-1)"
  read -r s2 e2 <<<"$(dc_times do-deploy-2)"
  first=$(secs "$s1" "$s2")
  after=$(secs "$e1" "$s2")
  if [ -n "$first" ] && [ -n "$after" ] && [ "$first" -gt 0 ] && [ "$after" -ge -5 ]; then
    record DO-ORDER OK "the deployment of merge 2 started ${after}s after the one of merge 1 ended: one after the other, in merge order"
  else
    record DO-ORDER FAIL "deployment 1 $s1 -> $e1, deployment 2 $s2 -> $e2: not one after the other in merge order"
  fi
  dr_dump "$DO_T0" deploy-order
  deploys=$(awk '$3 == "false"' "$LOGS/deploy-order.dr")
  if [ "$(echo "$deploys" | grep -c ' Succeeded ')" -ge 2 ] && ! echo "$deploys" | grep -q ' Canceled '; then
    record DO-ORG OK "two deployments Succeeded in the org, none Canceled"
  else
    record DO-ORG FAIL "deployments in the org: $(echo "$deploys" | awk '{print $1":"$2}' | tr '\n' ' ')"
  fi
fi

# ------------------------------------------------------------------ timeout: a job killed by its timeout
if step timeout; then
  say "timeout: the check job is killed by its timeout while its simulation runs"
  reset_step feature/dc-timeout
  minutes="${DC_TIMEOUT_MINUTES:-}"
  if [ -z "$minutes" ]; then
    offset="${DC_SIM_OFFSET:-480}"
    minutes=$(((offset + 90 + 59) / 60))
  fi
  [ "$minutes" -lt 3 ] && minutes=3
  T0=$(iso_ago 60)
  new_story feature/dc-timeout Timeout >>"$LOGS/build.log" 2>&1
  if [ "$PROVIDER" != "github" ]; then
    dc_set_timeout "$minutes" && git -C "$WORK" add -A && git -C "$WORK" commit -qm "chore: check job timeout $minutes minutes (E2E)" && git -C "$WORK" push -q origin feature/dc-timeout
  else
    dc_set_timeout "$minutes"
  fi
  SHA_T=$(git -C "$WORK" rev-parse HEAD)
  PR_T=$(open_story feature/dc-timeout x "DC-6 timeout" "A story whose check job is killed by its timeout of $minutes minutes.")
  save PR_T "$PR_T"
  out=$(dc_wait_sim "$PR_T" "$SHA_T" "$T0" "" "InProgress" 1200)
  JT="${out%% *}"
  XT=""
  [ "$out" != "$JT" ] && XT="${out#* }"
  if [ -z "$JT" ]; then
    record TO-JOB FAIL "no check job for #$PR_T"
    dc_reset_timeout
    exit 1
  fi
  if [ -n "$XT" ]; then
    record TO-RUNNING OK "the simulation $XT runs in the org before the timeout of $minutes minutes (check job $JT)"
  else
    record TO-RUNNING SKIP "no simulation started before the job ended ($(dc_state "$JT")), timeout $minutes minutes: raise DC_TIMEOUT_MINUTES"
  fi
  dc_wait_id "$JT" to-job
  dc_reset_timeout
  conclusion=$(dc_conclusion "$JT")
  seen=$(grep -aoE "E2E after_script CI_JOB_STATUS=[a-z]+" "$LOGS/to-job.log" | head -1)
  [ "$PROVIDER" = "gitlab" ] && [ -z "$seen" ] && seen="the after_script printed no CI_JOB_STATUS: it did not run"
  hook="hook not run"
  grep -aqF "$MSG_CANCELLING" "$LOGS/to-job.log" && hook="hook ran"
  if [ -n "${XT:-}" ]; then
    status=$(dr_wait_final "$XT" 180)
    if [ "$status" = "Canceled" ]; then
      record TO-CANCELLED OK "the job killed by its timeout ended $conclusion, $hook, and DeployRequest $XT is Canceled${seen:+ ($seen)}"
    else
      record TO-CANCELLED FAIL "finding: the job killed by its timeout ended $conclusion, $hook${seen:+, $seen}; DeployRequest $XT is $status, its simulation keeps the org busy"
      # Not left running for the next run on this org
      env -u NODE_OPTIONS sf project deploy cancel --job-id "$XT" --target-org "$ORG" --async --json >"$LOGS/to-cleanup-cancel.json" 2>&1
    fi
  fi
  dr_dump "$T0" timeout
fi

# ------------------------------------------------------------------ failed-sim: a failed simulation keeps its job id, a later cancel says it is completed
# From the workstation, sfdx-hardis of the working copy (bin/dev.js), CI=true as in a job: provider
# independent, and a CI job would need a step of its own after a failed simulation
if step failed-sim; then
  say "failed-sim: a simulation that fails (a class that does not compile), then a cancel on its job id"
  reset_step
  fdir="$LOGS/failed-sim-project"
  rm -rf "$fdir"
  WORK="$fdir" API="$API" DC_TEST_CLASSES=1 DC_TEST_METHODS=1 bash "$HERE/dc-build-project.sh" >>"$LOGS/build.log" 2>&1
  (
    cd "$fdir" || exit 1
    printf 'targetUsername: %s\n' "$ORG_USERNAME" >>config/branches/.sfdx-hardis.integration.yml
    printf 'public class DCBroken {\n    public static Integer broken() {\n        return notDeclared;\n    }\n}\n' >force-app/main/default/classes/DCBroken.cls
    cp force-app/main/default/classes/DCSlowTest1.cls-meta.xml force-app/main/default/classes/DCBroken.cls-meta.xml
    git add -A && git commit -qm "feat: a class that does not compile" && git checkout -q -b integration
    env -u NODE_OPTIONS CI=true CONFIG_BRANCH=integration ORG_ALIAS=integration node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" --agent >"$LOGS/fs-check.log" 2>&1
    echo $? >"$LOGS/fs-check.code"
  )
  FS_FILE="$fdir/.cache/sfdx-hardis/running-deployment-simulation.json"
  XF=$(json_of "j.jobId" <"$FS_FILE" 2>/dev/null)
  if [ "$(cat "$LOGS/fs-check.code")" != "0" ] && grep -aq "Variable does not exist" "$LOGS/fs-check.log" && [ -n "$XF" ]; then
    record FS-FILE-KEPT OK "the simulation failed (DCBroken does not compile) and its job id $XF stays in .cache/sfdx-hardis/running-deployment-simulation.json"
  else
    record FS-FILE-KEPT FAIL "exit $(cat "$LOGS/fs-check.code"), job id file: ${XF:-missing} (see fs-check.log)"
  fi
  if [ -n "$XF" ]; then
    status=$(dr_wait_final "$XF" 120)
    if [ "$status" = "Failed" ]; then
      record FS-ORG OK "DeployRequest $XF is Failed in the org"
    else
      record FS-ORG FAIL "DeployRequest $XF is $status"
    fi
    (cd "$fdir" && env -u NODE_OPTIONS CI=true node "$DEV" hardis:project:deploy:cancel --agent >"$LOGS/fs-cancel.log" 2>&1)
    if grep -aqF "Deployment simulation $XF is already completed (Failed): nothing to cancel." "$LOGS/fs-cancel.log" && [ ! -f "$FS_FILE" ]; then
      record FS-CANCEL OK "a later cancel logs that $XF is already completed (Failed), and deletes the job id file"
    else
      record FS-CANCEL FAIL "the cancel after the failed simulation: $(grep -a "sfdx-hardis\]" "$LOGS/fs-cancel.log" | tail -2 | tr '\n' ' '); file $([ -f "$FS_FILE" ] && echo kept || echo deleted)"
    fi
  else
    record FS-CANCEL SKIP "no job id recorded by the failed simulation"
  fi
fi

# ------------------------------------------------------------------ report
if step report; then
  {
    echo "# deploy-cancel end to end: $RUN"
    echo
    echo "- Provider: $PROVIDER"
    echo "- Branch under test: $SFDX_HARDIS_BRANCH ($SFDX_HARDIS_REPO)"
    echo "- Repository: ${REPO:-${PROJECT_PATH:-${AZ_REPO_NAME:-?}}}"
    echo "- Org: a throwaway scratch org"
    echo "- Simulation length: ${DC_TEST_CLASSES:-8} x ${DC_TEST_METHODS:-8} slow test methods; a job starts its simulation ${DC_SIM_OFFSET:-?}s after it starts"
    echo
    echo "| Check | Result | Detail |"
    echo "|-------|--------|--------|"
    awk -F'\t' '{a[$1]=$0; if(!($1 in o)){o[$1]=++n; k[n]=$1}} END{for(i=1;i<=n;i++){split(a[k[i]],f,"\t"); gsub(/\|/,"/",f[3]); printf "| %s | %s | %s |\n", f[1], f[2], f[3]}}' "$RESULTS"
    echo
    echo "## CI jobs"
    echo
    echo '```'
    cat "$LOGS/ci-jobs.tsv"
    echo '```'
    echo
    echo "## DeployRequest records of each step (Id Status CheckOnly Created Start Completed)"
    for s in new-commit other-pr deploy-order timeout; do
      [ -f "$LOGS/$s.dr" ] || continue
      echo
      echo "### $s"
      echo
      echo '```'
      cat "$LOGS/$s.dr"
      echo '```'
    done
  } >"$LOGS/report.md"
  say "report: $LOGS/report.md"
  grep -c "	FAIL	" "$RESULTS" | xargs -I{} echo "FAIL lines: {}"
fi

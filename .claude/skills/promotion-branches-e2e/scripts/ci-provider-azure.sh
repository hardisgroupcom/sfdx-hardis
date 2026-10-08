#!/usr/bin/env bash
# Azure Pipelines side of the real CI section (runbook section 6quinquies). Sourced by
# ci-workflows-run.sh when PROVIDER=azure; do not run it on its own. The functions it defines are
# listed in ci-provider-github.sh.
#
# A repository is created in the team project, with the azure-pipelines-checks.yml and
# azure-pipelines-deployment.yml of ci-workflows-prepare.cjs --provider azure; then, through the
# REST API: the two pipeline definitions (POST _apis/pipelines on the YAML path), their variables
# (the SFDX_AUTH_URL_<BRANCH> logins, secret), a preview of both (the YAML as Azure expands it, before
# any job runs), and a build validation policy on each major branch, so the checks pipeline runs on
# every Pull Request. The deployment pipeline runs from the CI trigger of its YAML on a merge.
# Read from the environment, else from .env (env-lib.sh); nothing prints a token:
#
#   AZ_ORG                       organization (https://dev.azure.com/<AZ_ORG>/)
#   AZ_PROJECT                   team project the repository is created in
#   AZURE_PERSONAL_ACCESS_TOKEN  PAT: Code (Read, write & manage), Build (Read & execute),
#                                Pull Request Threads (Read & write); Security (Manage) lets the
#                                script grant the build service its permission (see below).
#                                AZ_TOKEN overrides it
#   AZ_REPO_NAME                 optional: default sfdx-hardis-promo-e2e-ci-az-<n>, <n> one more
#                                than the highest one of the project
#   AZURE_E2E_CI_TOKEN           system (default): the jobs post their comments with
#                                $(System.AccessToken), as a real project does: the build service
#                                of the project needs "Contribute to pull requests" on the
#                                repository. pat: a secret variable CI_SFDX_HARDIS_AZURE_TOKEN holds
#                                the PAT, the comments are the PAT user's (see W2 below)
#   CI_WAIT_APPEAR_SECONDS       a build to be queued (default 900)
#   CI_WAIT_QUEUE_SECONDS        a queued build to start (default 10800: one free parallel job, the
#                                builds wait for each other)
#   CI_WAIT_JOB_SECONDS          a started build to end (default 3600: the free tier stops a job
#                                at 60 minutes)
#   CI_WAIT_REQUEUE_SECONDS      no build for a Pull Request after this long: the build policy is
#                                queued again by hand (default 300; a draft, for instance)
#
# The build service: with AZURE_E2E_CI_TOKEN=system the script grants the identity
# "<project> Build Service (<organization>)" Contribute and Contribute to pull requests on the new
# repository (Security namespace Git Repositories). When the PAT cannot (no Security scope), it
# says so and goes on: grant it ONCE on all the repositories of the project by hand (Project
# settings > Repositories > Security > "<project> Build Service (<organization>)" > Contribute to
# pull requests: Allow), and every later run inherits it. preflight.sh reads that permission.
#
# Every wait logs the queue time apart from the run time, in $LOGS/ci-jobs.tsv and on its line.

# shellcheck disable=SC2034 # read by ci-workflows-run.sh
CI_DRAFT_DESC="an Azure DevOps draft (isDraft, no \"draft\" in the title) is not stopped, only warned"
CI_SAFE_DIRECTORY_FILES=""
CI_SAFE_DIRECTORY_HINT=""
CI_SAFE_DIRECTORY_SKIP="GitHub only: the Azure template has no safe.directory line, the agent maps its own checkout into the container"
AZ_BUILD_POLICY_TYPE=0609b952-1397-4640-95ec-e00a01b2c241
AZ_GIT_SECURITY_NAMESPACE=2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87
AZ_CHECK_PIPELINE_FILE=azure-pipelines-checks.yml
AZ_DEPLOY_PIPELINE_FILE=azure-pipelines-deployment.yml

# A field of a JSON document read on stdin, as UTF-8. Usage: ... | _azci_json '<js expression of d>'
_azci_json() {
  node -e "let s='';process.stdin.setEncoding('utf8').on('data',c=>s+=c).on('end',()=>{let d;try{d=JSON.parse(s)}catch(e){console.log('');return}const v=($1);console.log(v===undefined||v===null?'':v)})"
}

_azci_path() { e2e_native_path "$1"; }

# Usage: _azci_api <method> <url> [curl args...]   (prints the body)
_azci_api() {
  local method="$1" url="$2"
  shift 2
  curl -sS -u ":$AZ_TOKEN" -X "$method" -H "Content-Type: application/json" "$url" "$@"
}

# Usage: _azci_call <method> <url> <body out file> [curl args...]   (prints the HTTP code)
_azci_call() {
  local method="$1" url="$2" out="$3"
  shift 3
  curl -sS -u ":$AZ_TOKEN" -X "$method" -H "Content-Type: application/json" -o "$out" -w '%{http_code}' "$url" "$@"
}

ci_provider_init() {
  AZ_TOKEN="${AZ_TOKEN:-${AZURE_PERSONAL_ACCESS_TOKEN:-}}"
  : "${AZ_ORG:?set AZ_ORG (environment or .env) to the Azure DevOps organization}"
  : "${AZ_PROJECT:?set AZ_PROJECT (environment or .env) to the team project}"
  : "${AZ_TOKEN:?set AZURE_PERSONAL_ACCESS_TOKEN (environment or .env) or AZ_TOKEN}"
  export AZ_TOKEN AZ_ORG AZ_PROJECT
  AZURE_E2E_CI_TOKEN="${AZURE_E2E_CI_TOKEN:-system}"
  export AZURE_E2E_CI_TOKEN
  CI_WAIT_APPEAR_SECONDS="${CI_WAIT_APPEAR_SECONDS:-900}"
  CI_WAIT_QUEUE_SECONDS="${CI_WAIT_QUEUE_SECONDS:-10800}"
  CI_WAIT_JOB_SECONDS="${CI_WAIT_JOB_SECONDS:-3600}"
  CI_WAIT_REQUEUE_SECONDS="${CI_WAIT_REQUEUE_SECONDS:-300}"
  AZ_COLLECTION="https://dev.azure.com/$AZ_ORG/"
  AZ_PROJECT_URL="${AZ_COLLECTION}$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$AZ_PROJECT")"
  export AZ_COLLECTION AZ_PROJECT_URL

  AZ_PROJECT_ID=$(_azci_api GET "${AZ_COLLECTION}_apis/projects/$AZ_PROJECT?api-version=7.1" | _azci_json 'd.id')
  if [ -z "$AZ_PROJECT_ID" ]; then
    echo "team project $AZ_PROJECT not found in $AZ_COLLECTION, or the PAT cannot read it" >&2
    return 1
  fi
  local code
  code=$(_azci_call GET "$AZ_PROJECT_URL/_apis/pipelines?api-version=7.1" "$LOGS/.az-pipelines.json")
  rm -f "$LOGS/.az-pipelines.json"
  if [ "$code" != "200" ]; then
    echo "GET _apis/pipelines answered $code: the PAT needs the Build (Read & execute) scope" >&2
    return 1
  fi
  if [ -z "${AZ_REPO_NAME:-}" ]; then
    local highest
    highest=$(_azci_api GET "$AZ_PROJECT_URL/_apis/git/repositories?api-version=7.1" |
      _azci_json "Math.max(0,...(d.value||[]).map(r=>(r.name.match(/^sfdx-hardis-promo-e2e-ci-az-(\\d+)\$/)||[])[1]).filter(Boolean).map(Number))")
    AZ_REPO_NAME="sfdx-hardis-promo-e2e-ci-az-$((highest + 1))"
  fi
  export AZ_REPO_NAME AZ_PROJECT_ID
  echo "Azure DevOps repository to create: $AZ_COLLECTION$AZ_PROJECT/_git/$AZ_REPO_NAME (job token: $AZURE_E2E_CI_TOKEN)"
}

ci_create_remote() {
  local auth_url="$1" b answer
  answer=$(_azci_api POST "$AZ_PROJECT_URL/_apis/git/repositories?api-version=7.1" \
    -d "{\"name\":\"$AZ_REPO_NAME\",\"project\":{\"id\":\"$AZ_PROJECT_ID\"}}")
  AZ_REPO_ID=$(printf '%s' "$answer" | _azci_json 'd.id')
  if [ -z "$AZ_REPO_ID" ]; then
    echo "repository creation failed: $(printf '%s' "$answer" | head -c 300)"
    return 1
  fi
  export AZ_REPO_ID
  echo "[$(date +%T)] repository $AZ_REPO_NAME created, id $AZ_REPO_ID"

  # The PAT in an http.extraHeader of this clone only: the remote URL stays clean, which the extension
  # and check-pipeline.cjs read. No pipeline exists yet, so these pushes run nothing.
  local remote="${AZ_PROJECT_URL}/_git/$AZ_REPO_NAME"
  git remote add origin "$remote"
  git config --local "http.$remote.extraHeader" "Authorization: Basic $(printf 'azure:%s' "$AZ_TOKEN" | base64 | tr -d '\n')"
  git push -q -u origin main || return 1
  git branch preprod && git branch uat && git branch integration
  git push -q origin preprod uat integration || return 1

  if [ "$AZURE_E2E_CI_TOKEN" = "system" ]; then
    _azci_grant_build_service
  fi
  AZ_CHECK_DEF_ID=$(_azci_create_pipeline "sfdx-hardis check ($AZ_REPO_NAME)" "$AZ_CHECK_PIPELINE_FILE") || return 1
  AZ_DEPLOY_DEF_ID=$(_azci_create_pipeline "sfdx-hardis deployment ($AZ_REPO_NAME)" "$AZ_DEPLOY_PIPELINE_FILE") || return 1
  export AZ_CHECK_DEF_ID AZ_DEPLOY_DEF_ID
  echo "[$(date +%T)] pipelines created: check $AZ_CHECK_DEF_ID, deployment $AZ_DEPLOY_DEF_ID"
  for id in "$AZ_CHECK_DEF_ID" "$AZ_DEPLOY_DEF_ID"; do
    AUTH_URL="$auth_url" _azci_set_variables "$id" || return 1
  done
  # The YAML as Azure expands it, before any job runs and before a minute is spent
  for id in "$AZ_CHECK_DEF_ID" "$AZ_DEPLOY_DEF_ID"; do
    _azci_preview "$id" || return 1
  done
  for b in integration uat preprod main; do
    _azci_build_policy "$b" || return 1
  done
  printf 'export AZ_REPO_NAME="%s" AZ_REPO_ID="%s" AZ_CHECK_DEF_ID="%s" AZ_DEPLOY_DEF_ID="%s" AZ_PROJECT_ID="%s"\n' \
    "$AZ_REPO_NAME" "$AZ_REPO_ID" "$AZ_CHECK_DEF_ID" "$AZ_DEPLOY_DEF_ID" "$AZ_PROJECT_ID" >>"$LOGS/ci-vars.sh"
}

# Contribute (4) and Contribute to pull requests (16384) on the repository for the project build
# service, the identity of $(System.AccessToken) when the job authorization scope is the project
_azci_grant_build_service() {
  local file code descriptor
  # Its descriptor is Microsoft.TeamFoundation.ServiceIdentity;<an id of the organization>:Build:<project id>.
  # That first id is not the instanceId of connectionData: it is read from the access control list
  # of the repositories of the project, where the build service always has an entry
  descriptor=$(_azci_api GET "${AZ_COLLECTION}_apis/accesscontrollists/$AZ_GIT_SECURITY_NAMESPACE?token=repoV2/$AZ_PROJECT_ID&api-version=7.1" |
    PROJECT="$AZ_PROJECT_ID" _azci_json "Object.keys(((d.value||[])[0]||{}).acesDictionary||{}).find(k=>k.startsWith('Microsoft.TeamFoundation.ServiceIdentity;')&&k.endsWith(':Build:'+process.env.PROJECT))")
  file="$(_azci_path "$LOGS")/.az-ace.json"
  if [ -z "$descriptor" ]; then
    code="none (the build service was not found in the access control list of the project repositories)"
  else
  code=$(_azci_call POST "${AZ_COLLECTION}_apis/accesscontrolentries/$AZ_GIT_SECURITY_NAMESPACE?api-version=7.1" "$file" \
    -d "{\"token\":\"repoV2/$AZ_PROJECT_ID/$AZ_REPO_ID\",\"merge\":true,\"accessControlEntries\":[{\"descriptor\":\"$descriptor\",\"allow\":16388,\"deny\":0}]}")
  fi
  rm -f "$file"
  if [ "$code" = "200" ]; then
    echo "[$(date +%T)] build service: Contribute and Contribute to pull requests granted on $AZ_REPO_NAME"
  else
    echo "[$(date +%T)] build service: the grant answered HTTP $code (the PAT needs Security (Manage)). If the comments of the jobs" \
      "are missing, allow once 'Contribute to pull requests' to '$AZ_PROJECT Build Service ($AZ_ORG)' in Project settings >" \
      "Repositories > Security (all repositories), or run with AZURE_E2E_CI_TOKEN=pat"
  fi
}

# Usage: _azci_create_pipeline <name> <yaml path>   (prints the definition id)
_azci_create_pipeline() {
  local answer id
  answer=$(_azci_api POST "$AZ_PROJECT_URL/_apis/pipelines?api-version=7.1" -d "{\"name\":\"$1\",\"folder\":\"\\\\\",\"configuration\":{\"type\":\"yaml\",\"path\":\"/$2\",\"repository\":{\"id\":\"$AZ_REPO_ID\",\"name\":\"$AZ_REPO_NAME\",\"type\":\"azureReposGit\"}}}")
  id=$(printf '%s' "$answer" | _azci_json 'd.id')
  if ! [[ "$id" =~ ^[0-9]+$ ]]; then
    echo "pipeline $1 not created: $(printf '%s' "$answer" | head -c 300)" >&2
    return 1
  fi
  echo "$id"
}

# The logins (and the PAT with AZURE_E2E_CI_TOKEN=pat) as secret variables of a definition. The
# values go through the environment and a file removed right after, never the command line.
# Usage: AUTH_URL=<auth url> _azci_set_variables <definition id>
_azci_set_variables() {
  local id="$1" file code
  file="$(_azci_path "$LOGS")/.az-definition-$id.json"
  _azci_api GET "$AZ_PROJECT_URL/_apis/build/definitions/$id?api-version=7.1" -o "$file"
  CI_TOKEN_VALUE="$([ "$AZURE_E2E_CI_TOKEN" = "pat" ] && printf '%s' "$AZ_TOKEN")" node -e '
const fs = require("fs");
const file = process.argv[1];
const def = JSON.parse(fs.readFileSync(file, "utf8"));
def.variables = def.variables || {};
for (const b of ["INTEGRATION", "UAT", "PREPROD", "MAIN"]) {
  def.variables["SFDX_AUTH_URL_" + b] = { value: process.env.AUTH_URL, isSecret: true, allowOverride: false };
}
if (process.env.CI_TOKEN_VALUE) {
  def.variables.CI_SFDX_HARDIS_AZURE_TOKEN = { value: process.env.CI_TOKEN_VALUE, isSecret: true, allowOverride: false };
}
fs.writeFileSync(file, JSON.stringify(def));' "$file"
  code=$(_azci_call PUT "$AZ_PROJECT_URL/_apis/build/definitions/$id?api-version=7.1" "$file.answer" --data-binary "@$file")
  rm -f "$file" "$file.answer"
  if [ "$code" != "200" ]; then
    echo "variables of pipeline $id not set: HTTP $code"
    return 1
  fi
  echo "[$(date +%T)] pipeline $id: SFDX_AUTH_URL_INTEGRATION, _UAT, _PREPROD, _MAIN set as secrets"
}

# POST _apis/pipelines/<id>/preview: Azure expands the YAML of the default branch and answers the
# final YAML, or the errors a run would stop on. Nothing is queued.
_azci_preview() {
  local id="$1" file code
  file="$(_azci_path "$LOGS")/preview-$id.json"
  code=$(_azci_call POST "$AZ_PROJECT_URL/_apis/pipelines/$id/preview?api-version=7.1-preview.1" "$file" -d '{"previewRun":true}')
  if [ "$code" = "200" ] && [ -n "$(_azci_json 'd.finalYaml' <"$file")" ]; then
    echo "[$(date +%T)] pipeline $id: preview valid"
    return 0
  fi
  echo "preview of pipeline $id refused (HTTP $code): $(_azci_json 'd.message||JSON.stringify(d)' <"$file" | head -c 500)"
  return 1
}

# A build validation policy on a major branch: the checks pipeline runs on every Pull Request into
# it, again on a push to its source branch, never again on a merge into the target (minutes), and
# does not block the merge (the run merges with az_pr_merge, which bypasses policies anyway)
_azci_build_policy() {
  local branch="$1" file code
  file="$(_azci_path "$LOGS")/.az-policy.json"
  code=$(_azci_call POST "$AZ_PROJECT_URL/_apis/policy/configurations?api-version=7.1" "$file" -d "{
    \"isEnabled\": true, \"isBlocking\": false, \"type\": {\"id\": \"$AZ_BUILD_POLICY_TYPE\"},
    \"settings\": {\"buildDefinitionId\": $AZ_CHECK_DEF_ID, \"queueOnSourceUpdateOnly\": true, \"manualQueueOnly\": false,
      \"displayName\": \"sfdx-hardis check\", \"validDuration\": 0,
      \"scope\": [{\"repositoryId\": \"$AZ_REPO_ID\", \"refName\": \"refs/heads/$branch\", \"matchKind\": \"exact\"}]}}")
  if [ "$code" != "200" ]; then
    echo "build validation policy on $branch refused (HTTP $code): $(_azci_json 'd.message||JSON.stringify(d)' <"$file" | head -c 300)"
    rm -f "$file"
    return 1
  fi
  rm -f "$file"
  echo "[$(date +%T)] build validation policy on $branch"
}

ci_open_draft() {
  local file
  file="$(_azci_path "$LOGS")/.az-draft.json"
  node -e '
const fs = require("fs");
const [source, target, title, body, out] = process.argv.slice(1);
fs.writeFileSync(out, JSON.stringify({ sourceRefName: "refs/heads/" + source, targetRefName: "refs/heads/" + target,
  title, description: fs.readFileSync(body, "utf8"), isDraft: true }));' "$1" "$2" "$3" "$(_azci_path "$4")" "$file"
  _azci_api POST "$AZ_REPO_API/pullrequests?api-version=7.1" --data-binary "@$file" | _azci_json 'd.pullRequestId'
  rm -f "$file"
}

ci_is_draft() { [ "$(_azci_api GET "$AZ_REPO_API/pullrequests/$1?api-version=7.1" | _azci_json 'd.isDraft===true?"yes":""')" = "yes" ]; }

# The validation: the build of the checks pipeline that the policy queued for that head commit
ci_wait_check() {
  echo "$1" >"$LOGS/$3.pr"
  echo "$2" >"$LOGS/$3.sha"
  _azci_wait_build check "$1" "$2" "$3" 0
}

# The deployment: the CI build of the deployment pipeline on the merge commit
ci_wait_deploy() { _azci_wait_build deploy "$1" "$2" "$3" 0; }

# Queue the build policy of the Pull Request again (the Re-queue button), then wait for the new build
ci_rerun() {
  local label="$1" from="$2" pr sha old
  pr=$(cat "$LOGS/$from.pr" 2>/dev/null)
  sha=$(cat "$LOGS/$from.sha" 2>/dev/null)
  old=$(cat "$LOGS/$from.build" 2>/dev/null || echo 0)
  if ! _azci_requeue_policy "$pr"; then
    echo "re-queue of the build policy of PR $pr refused" >"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    return 1
  fi
  echo "$pr" >"$LOGS/$label.pr"
  echo "$sha" >"$LOGS/$label.sha"
  _azci_wait_build check "$pr" "$sha" "$label" "$old"
}

# Usage: _azci_requeue_policy <pr id>
_azci_requeue_policy() {
  local evaluation code
  evaluation=$(_azci_api GET "$AZ_PROJECT_URL/_apis/policy/evaluations?artifactId=vstfs:///CodeReview/CodeReviewId/$AZ_PROJECT_ID/$1&api-version=7.1-preview.1" |
    _azci_json "((d.value||[]).find(e=>e.configuration&&e.configuration.type&&e.configuration.type.id==='$AZ_BUILD_POLICY_TYPE')||{}).evaluationId")
  [ -n "$evaluation" ] || return 1
  code=$(_azci_call PATCH "$AZ_PROJECT_URL/_apis/policy/evaluations/$evaluation?api-version=7.1-preview.1" "$LOGS/.az-requeue.json")
  rm -f "$LOGS/.az-requeue.json"
  echo "[$(date +%T)] build policy of PR $1 queued again (HTTP $code)"
  [ "$code" = "200" ]
}

# Tick, in every comment of a Pull Request, the checkbox of a manual action for an org branch.
# Azure DevOps lets only the author of a comment edit it: with AZURE_E2E_CI_TOKEN=system the comments
# are the build service's, and the PATCH may be refused (the tick log says so)
ci_tick_manual_checkbox() {
  local pr="$1" action="$2" org="$3" pairs pair tid cid file code
  pairs=$(_azci_api GET "$AZ_REPO_API/pullRequests/$pr/threads?api-version=7.1" |
    _azci_json "(d.value||[]).flatMap(t=>(t.comments||[]).filter(c=>!c.isDeleted&&(c.content||'').includes('sfdx-hardis-manual-action id:$action org:$org')).map(c=>t.id+':'+c.id)).join(' ')")
  for pair in $pairs; do
    tid="${pair%%:*}"
    cid="${pair##*:}"
    file="$LOGS/comment-$tid-$cid.md"
    _azci_api GET "$AZ_REPO_API/pullRequests/$pr/threads/$tid/comments/$cid?api-version=7.1" |
      node -e "let s='';process.stdin.setEncoding('utf8').on('data',c=>s+=c).on('end',()=>require('fs').writeFileSync(process.argv[1],JSON.parse(s).content||''))" "$(_azci_path "$file")"
    ci_tick_in_file "$file" "$action" "$org" content
    code=$(_azci_call PATCH "$AZ_REPO_API/pullRequests/$pr/threads/$tid/comments/$cid?api-version=7.1" "$file.answer" \
      --data-binary "@$(_azci_path "$file.json")")
    if [ "$code" = "200" ]; then
      echo "ticked in thread $tid comment $cid"
    else
      echo "tick refused in thread $tid comment $cid: HTTP $code (only the author edits a comment; AZURE_E2E_CI_TOKEN=pat posts them as the PAT user)"
    fi
  done
}

ci_pr_comments() {
  _azci_api GET "$AZ_REPO_API/pullRequests/$1/threads?api-version=7.1" |
    _azci_json "(d.value||[]).filter(t=>!t.isDeleted).flatMap(t=>(t.comments||[]).filter(c=>!c.isDeleted).map(c=>c.content||'')).join('\n')" >"$LOGS/$2.log" 2>&1
}

# The merge commit of a completed Pull Request (noFastForward: the commit pushed to the target)
ci_merge_sha() {
  local sha=""
  for _ in $(seq 1 30); do
    sha=$(_azci_api GET "$AZ_REPO_API/pullrequests/$1?api-version=7.1" | _azci_json "d.status==='completed'&&d.lastMergeCommit?d.lastMergeCommit.commitId:''")
    [ -n "$sha" ] && break
    sleep 2
  done
  echo "$sha"
}

ci_pr_head_sha() { _azci_api GET "$AZ_REPO_API/pullrequests/$1?api-version=7.1" | _azci_json 'd.lastMergeSourceCommit&&d.lastMergeSourceCommit.commitId'; }

# The newest build matching a kind, a key and a commit, newer than a build id. Prints "id status".
# check: the policy build of Pull Request <key> for head <sha>; deploy: the CI build of branch <key>
# on commit <sha>.
_azci_find_build() {
  local kind="$1" key="$2" sha="$3" min="$4" url
  if [ "$kind" = "check" ]; then
    url="$AZ_PROJECT_URL/_apis/build/builds?definitions=$AZ_CHECK_DEF_ID&reasonFilter=pullRequest&queryOrder=queueTimeDescending&\$top=50&api-version=7.1"
  else
    url="$AZ_PROJECT_URL/_apis/build/builds?definitions=$AZ_DEPLOY_DEF_ID&branchName=refs/heads/$key&queryOrder=queueTimeDescending&\$top=50&api-version=7.1"
  fi
  _azci_api GET "$url" | KIND="$kind" KEY="$key" SHA="$sha" MIN="$min" _azci_json "(()=>{const e=process.env;const b=(d.value||[]).filter(b=>b.id>Number(e.MIN)&&(e.KIND==='check'
    ?String((b.triggerInfo||{})['pr.number'])===e.KEY&&(((b.triggerInfo||{})['pr.sourceSha']||'')===e.SHA||(!(b.triggerInfo||{})['pr.sourceSha']&&b.sourceBranch==='refs/pull/'+e.KEY+'/merge'))
    :b.sourceVersion===e.SHA)).sort((x,y)=>y.id-x.id)[0];return b?b.id+' '+b.status:''})()"
}

# A build of the Pull Request for another head, still queued or running, only costs minutes and the
# single parallel job: cancel it
_azci_cancel_superseded() {
  local pr="$1" sha="$2" ids id
  ids=$(_azci_api GET "$AZ_PROJECT_URL/_apis/build/builds?definitions=$AZ_CHECK_DEF_ID&reasonFilter=pullRequest&statusFilter=notStarted,inProgress&api-version=7.1" |
    PR="$pr" SHA="$sha" _azci_json "(d.value||[]).filter(b=>String((b.triggerInfo||{})['pr.number'])===process.env.PR&&(b.triggerInfo||{})['pr.sourceSha']&&b.triggerInfo['pr.sourceSha']!==process.env.SHA).map(b=>b.id).join(' ')")
  for id in $ids; do
    _azci_api PATCH "$AZ_PROJECT_URL/_apis/build/builds/$id?api-version=7.1" -d '{"status":"cancelling"}' >/dev/null
    echo "[$(date +%T)] build $id of PR $pr cancelled: it validates a previous head"
  done
}

# Wait for a build: to appear, then to leave the queue, then to end. The queue time (the single free
# parallel job busy with an earlier build) is logged apart from the run time.
# Usage: _azci_wait_build <check|deploy> <pr id|branch> <sha> <label> <newer than build id>
_azci_wait_build() {
  local kind="$1" key="$2" sha="$3" label="$4" min="$5" found="" id="" status="" waited=0 requeued="" last_note=0
  while [ "$waited" -lt "$CI_WAIT_APPEAR_SECONDS" ]; do
    [ "$kind" = "check" ] && _azci_cancel_superseded "$key" "$sha"
    found=$(_azci_find_build "$kind" "$key" "$sha" "$min")
    [ -n "$found" ] && break
    if [ "$kind" = "check" ] && [ -z "$requeued" ] && [ "$waited" -ge "$CI_WAIT_REQUEUE_SECONDS" ]; then
      _azci_requeue_policy "$key" || true
      requeued=yes
    fi
    sleep 15
    waited=$((waited + 15))
  done
  if [ -z "$found" ]; then
    echo "no $kind build for $key at $sha after ${CI_WAIT_APPEAR_SECONDS}s" >"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    echo "[$(date +%T)] $label: no build"
    return 1
  fi
  id="${found%% *}"
  echo "$id" >"$LOGS/$label.build"
  echo "real CI" >"$LOGS/$label.mode"
  waited=0
  while true; do
    status=$(_azci_api GET "$AZ_PROJECT_URL/_apis/build/builds/$id?api-version=7.1" | _azci_json 'd.status')
    [ "$status" = "completed" ] && break
    if [ "$status" = "notStarted" ] && [ "$waited" -ge "$CI_WAIT_QUEUE_SECONDS" ]; then break; fi
    if [ "$status" = "inProgress" ] && [ "$waited" -ge $((CI_WAIT_QUEUE_SECONDS + CI_WAIT_JOB_SECONDS)) ]; then break; fi
    if [ $((waited - last_note)) -ge 300 ]; then
      echo "[$(date +%T)] $label: build $id $status"
      last_note=$waited
    fi
    sleep 20
    waited=$((waited + 20))
  done
  _azci_finish_build "$id" "$label" "$status"
}

# The log of every step of a build, without timestamps nor colors, the exit code and the timings
_azci_finish_build() {
  local id="$1" label="$2" status="$3" build result queue run log_ids lid
  build=$(_azci_api GET "$AZ_PROJECT_URL/_apis/build/builds/$id?api-version=7.1")
  result=$(printf '%s' "$build" | _azci_json 'd.result')
  queue=$(printf '%s' "$build" | _azci_json 'd.startTime?Math.round((Date.parse(d.startTime)-Date.parse(d.queueTime))/1000):""')
  run=$(printf '%s' "$build" | _azci_json 'd.startTime&&d.finishTime?Math.round((Date.parse(d.finishTime)-Date.parse(d.startTime))/1000):""')
  : >"$LOGS/$label.log"
  log_ids=$(_azci_api GET "$AZ_PROJECT_URL/_apis/build/builds/$id/logs?api-version=7.1" | _azci_json '(d.value||[]).map(l=>l.id).sort((a,b)=>a-b).join(" ")')
  for lid in $log_ids; do
    _azci_api GET "$AZ_PROJECT_URL/_apis/build/builds/$id/logs/$lid?api-version=7.1" -H "Accept: text/plain" |
      sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z //; s/\x1b\[[0-9;]*[A-Za-z]//g; s/\r//g' >>"$LOGS/$label.log"
  done
  case "$status:$result" in
  completed:succeeded | completed:partiallySucceeded) echo 0 >"$LOGS/$label.code" ;;
  completed:*) echo 1 >"$LOGS/$label.code" ;;
  *)
    printf '\nE2E: build %s still %s (CI_WAIT_QUEUE_SECONDS / CI_WAIT_JOB_SECONDS): no parallel job free, or it hangs\n' "$id" "${status:-unknown}" >>"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    ;;
  esac
  printf '%s\tazure\treal CI\t%s\t%s\t%s\t%s\n' "$label" "$id" "${result:-$status}" "${queue:-}" "${run:-}" >>"$LOGS/ci-jobs.tsv"
  echo "[$(date +%T)] $label: build $id ${result:-$status} (queued ${queue:-?}s, ran ${run:-?}s)"
}

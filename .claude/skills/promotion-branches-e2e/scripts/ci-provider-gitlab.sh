#!/usr/bin/env bash
# GitLab CI side of the real CI section (runbook section 6quinquies). Sourced by ci-workflows-run.sh
# when PROVIDER=gitlab; do not run it on its own. The functions it defines are listed in
# ci-provider-github.sh.
#
# The project is created inside a group whose runners run the jobs, with the .gitlab-ci.yml and
# .gitlab-ci-config.yml of ci-workflows-prepare.cjs --provider gitlab. Read from the environment,
# else from the .env of the sfdx-hardis working copy (env-lib.sh, loaded by ci-workflows-run.sh);
# nothing prints a token:
#
#   GITLAB_E2E_HOST     host of the GitLab instance (with or without https://)
#   GITLAB_E2E_GROUP    full path of the group the project is created in
#   GL_TOKEN            api token of the person running the test; default:
#                       `glab config get token --host <host>`
#   GITLAB_E2E_PROJECT  optional: the project name. Default: sfdx-hardis-promo-e2e-ci-gl-<n>, <n>
#                       one more than the highest one of the group
#   GITLAB_E2E_CI_TOKEN project (default): a project access token (api, write_repository,
#                       Maintainer, 7 days) becomes CI_SFDX_HARDIS_GITLAB_TOKEN, as a real project
#                       does; user: GL_TOKEN itself (when the group refuses project access tokens)
#   GITLAB_RUNNER_TAG   the runner tag the jobs carry (default ubuntu, checked against the runners
#                       of the group before anything is created)
#   CI_WAIT_APPEAR_SECONDS / CI_WAIT_JOB_SECONDS   timeouts of a pipeline to appear (600) and of a
#                       job to finish (3600)

# shellcheck disable=SC2034 # read by ci-workflows-run.sh
CI_DRAFT_DESC="a GitLab draft (\"Draft:\" title prefix, draft flag of the API) is not stopped, only warned"
CI_SAFE_DIRECTORY_FILES=""
CI_SAFE_DIRECTORY_HINT=""
CI_SAFE_DIRECTORY_SKIP="GitHub only: the GitLab template has no safe.directory line, the runner owns its clone"
CI_CHECK_JOB=check_deploy_to_target_branch_org
CI_DEPLOY_JOB=deploy_to_org

# The REST API before e2e-lib-gitlab.sh is sourced (it needs PROJECT_ID, which does not exist yet)
_glci_api() {
  local method="$1" path="$2"
  shift 2
  curl -sS -X "$method" -H "PRIVATE-TOKEN: $GL_TOKEN" "$GL_HOST/api/v4/$path" "$@"
}

# A field of a JSON document read on stdin, as UTF-8 (python on Windows would use the codepage)
# Usage: ... | _glci_json '<js expression of d>'
_glci_json() {
  node -e "let s='';process.stdin.setEncoding('utf8').on('data',c=>s+=c).on('end',()=>{let d;try{d=JSON.parse(s)}catch(e){console.log('');return}const v=($1);console.log(v===undefined||v===null?'':v)})"
}

_glci_urlencode() { node -e "console.log(encodeURIComponent(process.argv[1]))" "$1"; }

ci_provider_init() {
  : "${GITLAB_E2E_HOST:?set GITLAB_E2E_HOST (environment or .env) to the GitLab host}"
  : "${GITLAB_E2E_GROUP:?set GITLAB_E2E_GROUP (environment or .env) to the group the project is created in}"
  case "$GITLAB_E2E_HOST" in
  http://* | https://*) GL_HOST="${GITLAB_E2E_HOST%/}" ;;
  *) GL_HOST="https://${GITLAB_E2E_HOST%/}" ;;
  esac
  export GL_HOST
  GL_TOKEN="${GL_TOKEN:-$(glab config get token --host "${GL_HOST#https://}" 2>/dev/null)}"
  : "${GL_TOKEN:?no GL_TOKEN, and glab has no token for $GL_HOST}"
  export GL_TOKEN
  GITLAB_RUNNER_TAG="${GITLAB_RUNNER_TAG:-ubuntu}"
  export GITLAB_RUNNER_TAG
  CI_WAIT_APPEAR_SECONDS="${CI_WAIT_APPEAR_SECONDS:-600}"
  CI_WAIT_JOB_SECONDS="${CI_WAIT_JOB_SECONDS:-3600}"

  GL_GROUP_ID=$(_glci_api GET "groups/$(_glci_urlencode "$GITLAB_E2E_GROUP")" | _glci_json 'd.id')
  if ! [[ "$GL_GROUP_ID" =~ ^[0-9]+$ ]]; then
    echo "group $GITLAB_E2E_GROUP not found on $GL_HOST, or the token cannot read it" >&2
    return 1
  fi
  # The group runners only take tagged jobs: one of them must be online with the tag the jobs carry
  local runners
  runners=$(_glci_api GET "groups/$GL_GROUP_ID/runners?per_page=100&status=online" | _glci_json 'd.map(r=>r.id).join(" ")')
  local ok="" id answer
  for id in $runners; do
    answer=$(_glci_api GET "runners/$id" | _glci_json "(d.tag_list||[]).includes(process.env.GITLAB_RUNNER_TAG)||d.run_untagged===true?'yes':''")
    [ "$answer" = "yes" ] && ok=yes && break
  done
  if [ -z "$ok" ]; then
    echo "no online runner of $GITLAB_E2E_GROUP takes jobs tagged $GITLAB_RUNNER_TAG (instance runners are not checked)" >&2
    return 1
  fi
  if [ -z "${GITLAB_E2E_PROJECT:-}" ]; then
    local highest
    highest=$(_glci_api GET "groups/$GL_GROUP_ID/projects?per_page=100&search=sfdx-hardis-promo-e2e-ci-gl-&include_subgroups=false" |
      _glci_json "Math.max(0,...d.map(p=>(p.path.match(/^sfdx-hardis-promo-e2e-ci-gl-(\\d+)\$/)||[])[1]).filter(Boolean).map(Number))")
    GITLAB_E2E_PROJECT="sfdx-hardis-promo-e2e-ci-gl-$((highest + 1))"
  fi
  PROJECT_PATH="$GITLAB_E2E_GROUP/$GITLAB_E2E_PROJECT"
  export PROJECT_PATH
  echo "GitLab project to create: $GL_HOST/$PROJECT_PATH (runner tag $GITLAB_RUNNER_TAG)"
}

ci_create_remote() {
  local auth_url="$1" b answer
  answer=$(_glci_api POST projects -H "Content-Type: application/json" --data-binary \
    "{\"name\":\"$GITLAB_E2E_PROJECT\",\"path\":\"$GITLAB_E2E_PROJECT\",\"namespace_id\":$GL_GROUP_ID,\"visibility\":\"private\",\"initialize_with_readme\":false}")
  PROJECT_ID=$(printf '%s' "$answer" | _glci_json 'd.id')
  if ! [[ "$PROJECT_ID" =~ ^[0-9]+$ ]]; then
    echo "project creation failed: $(printf '%s' "$answer" | head -c 300)"
    return 1
  fi
  export PROJECT_ID
  printf 'export PROJECT_ID="%s" PROJECT_PATH="%s" GL_HOST="%s"\n' "$PROJECT_ID" "$PROJECT_PATH" "$GL_HOST" >>"$LOGS/ci-vars.sh"
  echo "[$(date +%T)] project $PROJECT_PATH created, id $PROJECT_ID"
  # Merge commits, never squash (the -x trailers of the cherry-picks), the merge never waits on a
  # pipeline (W1 merges nothing while its job fails, but W4 merges right after a validation)
  _glci_api PUT "projects/$PROJECT_ID" -d merge_method=merge -d squash_option=never \
    -d only_allow_merge_if_pipeline_succeeds=false -d remove_source_branch_after_merge=false >/dev/null

  # git over HTTPS with the token in a header of this clone only: the remote URL stays clean, which
  # the extension and check-pipeline.cjs read
  git remote add origin "$GL_HOST/$PROJECT_PATH.git"
  git config --local "http.$GL_HOST/.extraHeader" "Authorization: Basic $(printf 'oauth2:%s' "$GL_TOKEN" | base64 | tr -d '\n')"

  # The logins. Not protected: a protected variable only reaches pipelines of protected branches,
  # and the validation job runs in the merge request pipeline of a feature branch. Masked when
  # GitLab accepts the value (its masking rules refuse some characters), else visible to the
  # Maintainers of this throwaway project only.
  for b in INTEGRATION UAT PREPROD MAIN; do
    _glci_set_variable "SFDX_AUTH_URL_$b" "$auth_url" || return 1
  done
  local ci_token="$GL_TOKEN"
  if [ "${GITLAB_E2E_CI_TOKEN:-project}" = "project" ]; then
    ci_token=$(_glci_api POST "projects/$PROJECT_ID/access_tokens" -H "Content-Type: application/json" --data-binary \
      "{\"name\":\"sfdx-hardis e2e\",\"scopes\":[\"api\",\"write_repository\"],\"access_level\":40,\"expires_at\":\"$(date -d '+7 days' +%F)\"}" |
      _glci_json 'd.token')
    if [ -z "$ci_token" ]; then
      echo "project access token refused: CI_SFDX_HARDIS_GITLAB_TOKEN falls back to GL_TOKEN (GITLAB_E2E_CI_TOKEN=user)"
      ci_token="$GL_TOKEN"
    fi
  fi
  _glci_set_variable CI_SFDX_HARDIS_GITLAB_TOKEN "$ci_token" || return 1

  # No pipeline for the base project: ci.skip on every push of the major branches
  git push -q -o ci.skip -u origin main || return 1
  git branch preprod && git branch uat && git branch integration
  git push -q -o ci.skip origin preprod uat integration || return 1
  # The CI files as GitLab reads them, include resolved: stop now rather than wait on pipelines
  # that will never be created
  answer=$(_glci_api GET "projects/$PROJECT_ID/ci/lint?include_jobs=true")
  if [ "$(printf '%s' "$answer" | _glci_json 'd.valid===true&&d.jobs.some(j=>j.name==="deploy_to_org")?"yes":""')" != "yes" ]; then
    echo "CI lint of $PROJECT_PATH failed: $(printf '%s' "$answer" | _glci_json 'JSON.stringify(d.errors||d)' | head -c 500)"
    return 1
  fi
  echo "[$(date +%T)] CI lint of $PROJECT_PATH: valid"
}

# Usage: _glci_set_variable <key> <value>   (the value never reaches the command line of curl)
_glci_set_variable() {
  local key="$1" file masked answer
  file="$(cygpath -m "$LOGS" 2>/dev/null || echo "$LOGS")/.variable.json"
  for masked in true false; do
    VALUE="$2" node -e "require('fs').writeFileSync(process.argv[1],JSON.stringify({key:process.argv[2],value:process.env.VALUE,masked:process.argv[3]==='true',protected:false,raw:true}))" "$file" "$key" "$masked"
    answer=$(_glci_api POST "projects/$PROJECT_ID/variables" -H "Content-Type: application/json" --data-binary "@$file")
    rm -f "$file"
    if [ "$(printf '%s' "$answer" | _glci_json 'd.key')" = "$key" ]; then
      [ "$masked" = "false" ] && echo "variable $key: GitLab refused to mask it, stored unmasked"
      return 0
    fi
  done
  echo "variable $key not created: $(printf '%s' "$answer" | _glci_json 'JSON.stringify(d.message||d.error||d)' | head -c 300)"
  return 1
}

# GitLab marks a draft with the "Draft:" title prefix, there is no separate flag to set
ci_open_draft() { gl_mr_create "$1" "$2" "Draft: $3" "$(cygpath -m "$4" 2>/dev/null || echo "$4")" 2>>"$LOGS/p-open.err"; }

ci_is_draft() { [ "$(gl_api GET "projects/$PROJECT_ID/merge_requests/$1" | _glci_json 'd.draft===true?"yes":""')" = "yes" ]; }

# The validation job: the merge request pipeline of that head commit. Without merged results
# pipelines (a paid feature) it is a detached pipeline on the source branch head, not on the merge.
ci_wait_check() {
  local mr="$1" sha="$2" label="$3"
  _glci_wait_pipeline "merge_requests/$mr/pipelines" "$sha" "$CI_CHECK_JOB" "$label"
}

# The deployment job: the push pipeline of the merge commit on the major branch
ci_wait_deploy() {
  local branch="$1" sha="$2" label="$3"
  _glci_wait_pipeline "pipelines?ref=$branch&sha=$sha&source=push" "$sha" "$CI_DEPLOY_JOB" "$label"
}

# Retry the validation job (the Retry button), then wait for the new job
ci_rerun() {
  local label="$1" from="$2" id new
  id=$(cat "$LOGS/$from.job" 2>/dev/null)
  new=$(gl_api POST "projects/$PROJECT_ID/jobs/$id/retry" | _glci_json 'd.id')
  if ! [[ "$new" =~ ^[0-9]+$ ]]; then
    echo "retry of job $id refused" >"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    return 1
  fi
  cp "$LOGS/$from.pipeline" "$LOGS/$label.pipeline" 2>/dev/null
  _glci_wait_job "$new" "$label"
}

# Tick, in every note of a merge request, the checkbox of a manual action for an org branch. A note
# can only be edited by its author or a Maintainer: GL_TOKEN is the Owner of the group
ci_tick_manual_checkbox() {
  local mr="$1" action="$2" org="$3" ids nid file
  ids=$(gl_api GET "projects/$PROJECT_ID/merge_requests/$mr/notes?per_page=100" |
    _glci_json "d.filter(n=>!n.system&&(n.body||'').includes('sfdx-hardis-manual-action id:$action org:$org')).map(n=>n.id).join(' ')")
  for nid in $ids; do
    file="$LOGS/note-$nid.md"
    gl_api GET "projects/$PROJECT_ID/merge_requests/$mr/notes/$nid" | node -e "let s='';process.stdin.setEncoding('utf8').on('data',c=>s+=c).on('end',()=>require('fs').writeFileSync(process.argv[1],JSON.parse(s).body||''))" "$(cygpath -m "$file" 2>/dev/null || echo "$file")"
    ci_tick_in_file "$file" "$action" "$org" body
    gl_api PUT "projects/$PROJECT_ID/merge_requests/$mr/notes/$nid" -H "Content-Type: application/json" \
      --data-binary "@$(cygpath -m "$file.json" 2>/dev/null || echo "$file.json")" >/dev/null && echo "ticked in note $nid"
  done
}

ci_pr_comments() {
  gl_api GET "projects/$PROJECT_ID/merge_requests/$1/notes?per_page=100&sort=asc" |
    _glci_json "d.filter(n=>!n.system).map(n=>n.body).join('\n')" >"$LOGS/$2.log" 2>&1
}

# GitLab fills merge_commit_sha a moment after the merge
ci_merge_sha() {
  local sha=""
  for _ in $(seq 1 30); do
    sha=$(gl_api GET "projects/$PROJECT_ID/merge_requests/$1" | _glci_json 'd.merge_commit_sha')
    [ -n "$sha" ] && break
    sleep 2
  done
  echo "$sha"
}

ci_pr_head_sha() { gl_mr_sha "$1"; }

# Wait for the newest pipeline of a commit to appear, then for one of its jobs.
# Usage: _glci_wait_pipeline <pipelines API path> <sha> <job name> <label>
_glci_wait_pipeline() {
  local list="$1" sha="$2" job="$3" label="$4" pipeline="" waited=0 id="" status
  while [ "$waited" -lt "$CI_WAIT_APPEAR_SECONDS" ]; do
    pipeline=$(gl_api GET "projects/$PROJECT_ID/$list" | _glci_json "(d.filter(p=>p.sha==='$sha').sort((a,b)=>b.id-a.id)[0]||{}).id")
    if [[ "$pipeline" =~ ^[0-9]+$ ]]; then
      id=$(gl_api GET "projects/$PROJECT_ID/pipelines/$pipeline/jobs?per_page=100" | _glci_json "(d.filter(j=>j.name==='$job').sort((a,b)=>b.id-a.id)[0]||{}).id")
      [[ "$id" =~ ^[0-9]+$ ]] && break
      status=$(gl_api GET "projects/$PROJECT_ID/pipelines/$pipeline" | _glci_json 'd.status')
      case "$status" in success | failed | canceled | skipped)
        echo "pipeline $pipeline of $sha ended ($status) without a $job job: check the only/except rules and DEPLOY_BRANCHES" >"$LOGS/$label.log"
        echo 9 >"$LOGS/$label.code"
        echo "[$(date +%T)] $label: pipeline $pipeline has no $job job"
        return 1
        ;;
      esac
    fi
    sleep 10
    waited=$((waited + 10))
  done
  if ! [[ "$id" =~ ^[0-9]+$ ]]; then
    echo "no $job job for $sha after ${CI_WAIT_APPEAR_SECONDS}s (pipeline: ${pipeline:-none}; $list)" >"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    echo "[$(date +%T)] $label: no $job job for $sha"
    return 1
  fi
  echo "$pipeline" >"$LOGS/$label.pipeline"
  _glci_wait_job "$id" "$label"
}

# Wait for a job to end, keep its trace without colors nor section markers
_glci_wait_job() {
  local id="$1" label="$2" status="" waited=0
  echo "$id" >"$LOGS/$label.job"
  while [ "$waited" -lt "$CI_WAIT_JOB_SECONDS" ]; do
    status=$(gl_api GET "projects/$PROJECT_ID/jobs/$id" | _glci_json 'd.status')
    case "$status" in success | failed | canceled | skipped | manual) break ;; esac
    sleep 20
    waited=$((waited + 20))
  done
  gl_api GET "projects/$PROJECT_ID/jobs/$id/trace" |
    sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g; s/section_(start|end):[0-9]+:[A-Za-z0-9_.-]+(\[[^]]*\])?//g; s/\r//g' >"$LOGS/$label.log"
  case "$status" in
  success) echo 0 >"$LOGS/$label.code" ;;
  failed | canceled | skipped | manual) echo 1 >"$LOGS/$label.code" ;;
  *)
    printf '\nE2E: job %s still %s after %ss (CI_WAIT_JOB_SECONDS): no runner took it, or it hangs\n' "$id" "${status:-unknown}" "$CI_WAIT_JOB_SECONDS" >>"$LOGS/$label.log"
    echo 9 >"$LOGS/$label.code"
    ;;
  esac
  echo "real CI" >"$LOGS/$label.mode"
  local timing
  timing=$(gl_api GET "projects/$PROJECT_ID/jobs/$id" | _glci_json '[Math.round(d.queued_duration||0),Math.round(d.duration||0)].join(" ")')
  printf '%s\tgitlab\treal CI\t%s\t%s\t%s\t%s\t\n' "$label" "$id" "${status:-unknown}" "${timing%% *}" "${timing##* }" >>"$LOGS/ci-jobs.tsv"
  echo "[$(date +%T)] $label: job $id ${status:-unknown} (queued ${timing%% *}s, ran ${timing##* }s)"
}

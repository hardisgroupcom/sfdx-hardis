#!/usr/bin/env bash
# Provider neutral names for the job simulators, so promotion-run.sh, promotion-edge.sh,
# deployment-actions-run.sh and identical-actions-run.sh run the same steps on GitHub, GitLab, Azure
# DevOps and Bitbucket Cloud. Source it with PROVIDER=github|gitlab|azure|bitbucket; it sources the
# provider library (e2e-lib.sh, e2e-lib-gitlab.sh, e2e-lib-azure.sh, e2e-lib-bitbucket.sh), which
# names the variables it needs.
#
#   p_check <number> <target> <label>      validation job of a Pull Request / merge request
#   p_deploy <target> <label>              deployment job of a major branch
#   p_promote <source> <numbers> <label> [flags]
#   p_release_notes <label> [flags]
#   p_open <branch> <target> <title> <body file>   prints the number
#   p_merge <number>                       merge commit, never squash
#   p_close <number>                       close without merging
#   p_body <number>                        prints the description
#   p_set_body <number> <body file>        replaces the description
#   p_token                                the provider token
#   p_cli <args...>                        an sfdx-hardis command run like a person does: provider token, no CI
#   p_open_number_for_branch <branch>      the newest open Pull Request of a source branch
#   p_list_candidates <source> <label> [flags]     promotion:list-candidates
#   p_promote_no_provider <source> <numbers> <label> [flags]   a promotion with no provider token
#   p_wait_merge_ref <number> [sha]        waits until the provider's view of the Pull Request holds the
#                                          pushed head (GitHub, GitLab, Azure: the merge ref; Bitbucket,
#                                          which has none: the source commit of the API)
#   p_check_edited <number> <target> <label> <shell edit>   validation with the checkout edited first
#   p_deploy_branch <branch> <label>       deployment job run from any branch
#   p_pr_modal_check [--prs 1,2] [--json out]   check-pr-modal.cjs with this provider's variables
#
# Every one of them is defined for each of the four providers: nothing in the section scripts tests
# PROVIDER itself.

_P_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${PROVIDER:?set PROVIDER to github, gitlab, azure or bitbucket}" in
github)
  # shellcheck source=/dev/null
  source "$_P_DIR/e2e-lib.sh"
  p_check() { e2e_check "$@"; }
  p_deploy() { e2e_deploy "$@"; }
  p_promote() { e2e_promote "$@"; }
  p_release_notes() { e2e_release_notes "$@"; }
  p_token() { gh auth token; }
  p_cli() { env -u NODE_OPTIONS -u CI GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY="$REPO" GITHUB_REPOSITORY_OWNER="${REPO%%/*}" GITHUB_SERVER_URL="https://github.com" node "$DEV" "$@"; }
  p_open() {
    local url
    for _ in $(seq 1 10); do
      if url=$(gh pr create --repo "$REPO" --base "$2" --head "$1" --title "$3" --body-file "$4" 2>"$LOGS/p-open.err"); then
        echo "${url##*/}"
        return 0
      fi
      sleep 3
    done
    echo "Pull Request creation failed for $1: $(tail -3 "$LOGS/p-open.err")" >&2
    return 1
  }
  # GitHub refuses a merge right after a push to the source branch ("Base branch was modified")
  p_merge() {
    for _ in $(seq 1 15); do
      if gh pr merge "$1" --repo "$REPO" --merge --delete-branch=false >/dev/null 2>"$LOGS/p-merge.err"; then
        echo merged
        return 0
      fi
      sleep 4
    done
    echo "merge of #$1 failed: $(tail -3 "$LOGS/p-merge.err")" >&2
    return 1
  }
  p_close() { gh pr close "$1" --repo "$REPO" >/dev/null; }
  p_body() { gh api "repos/$REPO/pulls/$1" --jq .body; }
  p_set_body() {
    node -e "const fs=require('fs');fs.writeFileSync(process.argv[2],JSON.stringify({body:fs.readFileSync(process.argv[1],'utf8')}))" "$2" "$2.json"
    gh api -X PATCH "repos/$REPO/pulls/$1" --input "$2.json" >/dev/null
  }
  # The newest open Pull Request whose source branch starts with a prefix
  p_open_number_for_branch() {
    gh pr list --repo "$REPO" --state open --head "$1" --json number --jq '.[0].number'
  }
  # promotion:list-candidates, same variables as a promotion
  p_list_candidates() {
    local source="$1" label="$2" code start
    shift 2
    cd "$WORK" || return 1
    git checkout -q -f "$source" && git pull -q origin "$source"
    start=$(e2e_now_ms)
    env -u NODE_OPTIONS GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY="$REPO" GITHUB_REPOSITORY_OWNER="${REPO%%/*}" GITHUB_SERVER_URL="https://github.com" CONFIG_BRANCH="$source" node "$DEV" hardis:project:promotion:list-candidates --agent --source-branch "$source" "$@" >"$LOGS/$label.log" 2>&1
    code=$?
    e2e_time_record "$label" list-candidates "$start" "$code"
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  # A promotion with no way to reach the provider: no token, and the GitHub CLI off PATH
  p_promote_no_provider() {
    local source="$1" prs="$2" label="$3" code nogh
    shift 3
    cd "$WORK" || return 1
    git checkout -q -f "$source" && git pull -q origin "$source"
    nogh=$(echo "$PATH" | tr ':' '
' | grep -viE "GitHub CLI|/gh(/|$)" | paste -sd:)
    env -u NODE_OPTIONS -u GITHUB_TOKEN -u GH_TOKEN PATH="$nogh" GITHUB_REPOSITORY="$REPO" GITHUB_REPOSITORY_OWNER="${REPO%%/*}" GITHUB_SERVER_URL="https://github.com" CONFIG_BRANCH="$source" GH_CONFIG_DIR="$LOGS/no-gh-config" node "$DEV" hardis:project:promotion:create --agent --source-branch "$source" --pull-requests "$prs" "$@" >"$LOGS/$label.log" 2>&1
    code=$?
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  # refs/pull/<N>/merge lags behind a push: wait until it holds the head of the source branch
  p_wait_merge_ref() {
    # the head pushed locally when given: the API itself can answer with the previous head for a while
    local pr="$1" sha="${2:-}"
    [ -z "$sha" ] && sha=$(gh api "repos/$REPO/pulls/$pr" --jq .head.sha)
    for _ in $(seq 1 30); do
      if git -C "$WORK" fetch -q origin "+refs/pull/$pr/merge:refs/remotes/origin/prmerge-check-$pr" 2>/dev/null &&
        git -C "$WORK" merge-base --is-ancestor "$sha" "origin/prmerge-check-$pr" 2>/dev/null; then
        return 0
      fi
      sleep 3
    done
    return 1
  }
  # Validation job with the checked-out tree edited first (the feature-off case)
  # Usage: p_check_edited <pr> <target> <label> <shell command run in the checkout>
  p_check_edited() {
    local pr="$1" target="$2" label="$3" edit="$4" code
    cd "$WORK" || return 1
    git checkout -q -f --detach HEAD
    e2e_fetch_merge_ref "$pr" "prmerge-$pr" "$label" || return 1
    git checkout -q -f "prmerge-$pr" || return 1
    eval "$edit"
    e2e_ci_env GITHUB_REF_NAME="$pr/merge" GITHUB_REF="refs/pull/$pr/merge" FORCE_TARGET_BRANCH="$target" CONFIG_BRANCH="$target" node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" >"$LOGS/$label.log" 2>&1
    code=$?
    git checkout -q -f -- . 2>/dev/null
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  # A deployment job run from a branch that is not a major branch (push pipeline of that branch)
  p_deploy_branch() {
    local branch="$1" label="$2" code
    cd "$WORK" || return 1
    git fetch -q origin "$branch" && git checkout -q -f -B "$branch" "origin/$branch"
    e2e_ci_env GITHUB_REF_NAME="$branch" GITHUB_REF="refs/heads/$branch" node "$DEV" hardis:project:deploy:smart --target-org "$ORG" >"$LOGS/$label.log" 2>&1
    code=$?
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  p_pr_modal_check() {
    env -u NODE_OPTIONS PROVIDER=github REPO="$REPO" WORK="$(cygpath -m "$WORK" 2>/dev/null || echo "$WORK")" DEV="$DEV" EXT="$EXT" \
      node "$_P_DIR/check-pr-modal.cjs" "$@"
  }
  ;;
gitlab)
  # shellcheck source=/dev/null
  source "$_P_DIR/e2e-lib-gitlab.sh"
  p_check() { gl_check "$@"; }
  p_deploy() { gl_deploy "$@"; }
  p_promote() { gl_promote "$@"; }
  p_release_notes() { gl_release_notes "$@"; }
  p_token() { echo "$GL_TOKEN"; }
  p_cli() { env -u NODE_OPTIONS -u CI CI_SFDX_HARDIS_GITLAB_TOKEN="$GL_TOKEN" CI_SERVER_URL="$GL_HOST" CI_PROJECT_ID="$PROJECT_ID" CI_PROJECT_PATH="$PROJECT_PATH" CI_PROJECT_URL="$GL_HOST/$PROJECT_PATH" node "$DEV" "$@"; }
  p_open() {
    local iid body
    body="$(cygpath -m "$4" 2>/dev/null || echo "$4")"
    for _ in $(seq 1 15); do
      iid=$(gl_mr_create "$1" "$2" "$3" "$body" 2>"$LOGS/p-open.err")
      if [[ "$iid" =~ ^[0-9]+$ ]]; then
        echo "$iid"
        return 0
      fi
      sleep 3
    done
    echo "merge request creation failed for $1: $(tail -3 "$LOGS/p-open.err")" >&2
    return 1
  }
  # bp_merge waits until GitLab knows the last commit pushed on the source branch
  p_merge() { bp_merge "$1"; }
  p_close() { gl_api PUT "projects/$PROJECT_ID/merge_requests/$1" -d state_event=close >/dev/null; }
  p_body() {
    gl_api GET "projects/$PROJECT_ID/merge_requests/$1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).description||''))"
  }
  p_set_body() {
    node -e "const fs=require('fs');fs.writeFileSync(process.argv[2],JSON.stringify({description:fs.readFileSync(process.argv[1],'utf8')}))" "$(cygpath -m "$2")" "$(cygpath -m "$2").json"
    gl_api PUT "projects/$PROJECT_ID/merge_requests/$1" -H "Content-Type: application/json" --data-binary "@$(cygpath -m "$2").json" >/dev/null
  }
  p_open_number_for_branch() {
    gl_api GET "projects/$PROJECT_ID/merge_requests?state=opened&source_branch=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$1")" |
      node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);console.log(a.length?a[0].iid:'')})"
  }
  p_list_candidates() {
    local source="$1" label="$2" code start
    shift 2
    cd "$WORK" || return 1
    git checkout -q -f "$source" && git pull -q origin "$source"
    start=$(e2e_now_ms)
    gl_ci_env CI_COMMIT_REF_NAME="$source" CONFIG_BRANCH="$source" node "$DEV" hardis:project:promotion:list-candidates --agent --source-branch "$source" "$@" >"$LOGS/$label.log" 2>&1
    code=$?
    e2e_time_record "$label" list-candidates "$start" "$code"
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  p_promote_no_provider() {
    local source="$1" prs="$2" label="$3" code
    shift 3
    cd "$WORK" || return 1
    git checkout -q -f "$source" && git pull -q origin "$source"
    env -u NODE_OPTIONS -u CI_SFDX_HARDIS_GITLAB_TOKEN -u CI_JOB_TOKEN CI_SERVER_URL="$GL_HOST" CI_PROJECT_ID="$PROJECT_ID" CI_PROJECT_PATH="$PROJECT_PATH" CI_PROJECT_URL="$GL_HOST/$PROJECT_PATH" CI_COMMIT_REF_NAME="$source" CONFIG_BRANCH="$source" node "$DEV" hardis:project:promotion:create --agent --source-branch "$source" --pull-requests "$prs" "$@" >"$LOGS/$label.log" 2>&1
    code=$?
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  p_wait_merge_ref() {
    cd "$WORK" || return 1
    gl_fetch_merge_ref "$1"
  }
  p_check_edited() {
    local mr="$1" target="$2" label="$3" edit="$4" code
    cd "$WORK" || return 1
    git checkout -q -f --detach HEAD
    gl_fetch_merge_ref "$mr" || return 1
    git checkout -q -f "mrmerge-$mr" || return 1
    eval "$edit"
    gl_ci_env CI_MERGE_REQUEST_IID="$mr" CI_COMMIT_REF_NAME="refs/merge-requests/$mr/merge" CI_MERGE_REQUEST_TARGET_BRANCH_NAME="$target" FORCE_TARGET_BRANCH="$target" CONFIG_BRANCH="$target" node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" >"$LOGS/$label.log" 2>&1
    code=$?
    git checkout -q -f -- . 2>/dev/null
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  p_deploy_branch() {
    local branch="$1" label="$2" code
    cd "$WORK" || return 1
    git fetch -q origin "$branch" && git checkout -q -f -B "$branch" "origin/$branch"
    gl_ci_env CI_COMMIT_REF_NAME="$branch" node "$DEV" hardis:project:deploy:smart --target-org "$ORG" >"$LOGS/$label.log" 2>&1
    code=$?
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  p_pr_modal_check() {
    env -u NODE_OPTIONS PROVIDER=gitlab GL_HOST="$GL_HOST" GL_TOKEN="$GL_TOKEN" PROJECT_ID="$PROJECT_ID" WORK="$(cygpath -m "$WORK" 2>/dev/null || echo "$WORK")" DEV="$DEV" EXT="$EXT" \
      node "$_P_DIR/check-pr-modal.cjs" "$@"
  }
  ;;
azure)
  # shellcheck source=/dev/null
  source "$_P_DIR/e2e-lib-azure.sh"
  p_check() { az_check "$@"; }
  p_deploy() { az_deploy "$@"; }
  p_promote() { az_promote "$@"; }
  p_release_notes() { az_release_notes "$@"; }
  p_token() { echo "$AZ_TOKEN"; }
  p_cli() { bp_provider_env node "$DEV" "$@"; }
  p_open() {
    local id body
    body="$(cygpath -m "$4" 2>/dev/null || echo "$4")"
    for _ in $(seq 1 10); do
      id=$(az_pr_create "$1" "$2" "$3" "$body" 2>"$LOGS/p-open.err")
      if [[ "$id" =~ ^[0-9]+$ ]]; then
        echo "$id"
        return 0
      fi
      sleep 3
    done
    echo "Pull Request creation failed for $1: $(tail -3 "$LOGS/p-open.err")" >&2
    return 1
  }
  # bp_merge waits until Azure knows the last commit pushed on the source branch, then completes
  # with noFastForward (a merge commit, never squash)
  p_merge() { bp_merge "$1"; }
  p_close() { az_pr_abandon "$1"; }
  # The full description: the list API truncates it at 400 characters, a single read does not
  p_body() {
    az_api GET "$AZ_REPO_API/pullrequests/$1?api-version=7.1" |
      node -e "let s='';process.stdin.setEncoding('utf8').on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).description||''))"
  }
  # Azure refuses a description over 4000 characters (runbook section 8bis)
  p_set_body() {
    node -e "const fs=require('fs');fs.writeFileSync(process.argv[2],JSON.stringify({description:fs.readFileSync(process.argv[1],'utf8')}))" "$(cygpath -m "$2" 2>/dev/null || echo "$2")" "$(cygpath -m "$2" 2>/dev/null || echo "$2").json"
    az_api PATCH "$AZ_REPO_API/pullrequests/$1?api-version=7.1" --data-binary "@$(cygpath -m "$2" 2>/dev/null || echo "$2").json" >/dev/null
  }
  p_open_number_for_branch() {
    az_api GET "$AZ_REPO_API/pullrequests?searchCriteria.status=active&searchCriteria.sourceRefName=refs/heads/$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$1")&api-version=7.1" |
      node -e "let s='';process.stdin.setEncoding('utf8').on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).value||[];a.sort((x,y)=>y.pullRequestId-x.pullRequestId);console.log(a.length?a[0].pullRequestId:'')})"
  }
  p_list_candidates() {
    local source="$1" label="$2" code start
    shift 2
    cd "$WORK" || return 1
    git checkout -q -f "$source" && git pull -q origin "$source"
    start=$(e2e_now_ms)
    az_ci_env CI_COMMIT_REF_NAME="$source" BUILD_SOURCEBRANCHNAME="$source" CONFIG_BRANCH="$source" node "$DEV" hardis:project:promotion:list-candidates --agent --source-branch "$source" "$@" >"$LOGS/$label.log" 2>&1
    code=$?
    e2e_time_record "$label" list-candidates "$start" "$code"
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  # No token in any of the three variables the CLI reads for Azure DevOps
  p_promote_no_provider() {
    local source="$1" prs="$2" label="$3" code
    shift 3
    cd "$WORK" || return 1
    git checkout -q -f "$source" && git pull -q origin "$source"
    env -u NODE_OPTIONS -u SYSTEM_ACCESSTOKEN -u CI_SFDX_HARDIS_AZURE_TOKEN -u AZURE_DEVOPS_EXT_PAT \
      SYSTEM_COLLECTIONURI="$AZ_COLLECTION" SYSTEM_TEAMPROJECT="$AZ_PROJECT" BUILD_REPOSITORY_ID="$AZ_REPO_ID" BUILD_REPOSITORY_NAME="$AZ_REPO_NAME" \
      CI_COMMIT_REF_NAME="$source" BUILD_SOURCEBRANCHNAME="$source" CONFIG_BRANCH="$source" \
      node "$DEV" hardis:project:promotion:create --agent --source-branch "$source" --pull-requests "$prs" "$@" >"$LOGS/$label.log" 2>&1
    code=$?
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  # refs/pull/<id>/merge is recomputed asynchronously: wait until it holds the remote head of the
  # source branch (the sha argument of the GitHub version is not needed, the head is read with ls-remote)
  p_wait_merge_ref() {
    cd "$WORK" || return 1
    az_fetch_merge_ref "$1"
  }
  p_check_edited() {
    local pr="$1" target="$2" label="$3" edit="$4" code
    cd "$WORK" || return 1
    git checkout -q -f --detach HEAD
    az_fetch_merge_ref "$pr" "$label" || return 1
    git checkout -q -f "prmerge-$pr" || return 1
    eval "$edit"
    az_ci_env SYSTEM_PULLREQUEST_PULLREQUESTID="$pr" SYSTEM_JOB_DISPLAY_NAME="DeploymentCheck" CI_COMMIT_REF_NAME="refs/pull/$pr/merge" BUILD_SOURCEBRANCHNAME="merge" FORCE_TARGET_BRANCH="$target" CONFIG_BRANCH="$target" node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" >"$LOGS/$label.log" 2>&1
    code=$?
    git checkout -q -f -- . 2>/dev/null
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  p_deploy_branch() {
    local branch="$1" label="$2" code
    cd "$WORK" || return 1
    git fetch -q origin "$branch" && git checkout -q -f -B "$branch" "origin/$branch"
    az_ci_env SYSTEM_JOB_DISPLAY_NAME="Deployment" CI_COMMIT_REF_NAME="$branch" BUILD_SOURCEBRANCHNAME="$branch" node "$DEV" hardis:project:deploy:smart --target-org "$ORG" >"$LOGS/$label.log" 2>&1
    code=$?
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  p_pr_modal_check() {
    env -u NODE_OPTIONS PROVIDER=azure AZ_ORG="$AZ_ORG" AZ_PROJECT="$AZ_PROJECT" AZ_REPO_ID="$AZ_REPO_ID" AZ_TOKEN="$AZ_TOKEN" \
      WORK="$(cygpath -m "$WORK" 2>/dev/null || echo "$WORK")" DEV="$DEV" EXT="$EXT" \
      node "$_P_DIR/check-pr-modal.cjs" "$@"
  }
  ;;
bitbucket)
  # shellcheck source=/dev/null
  source "$_P_DIR/e2e-lib-bitbucket.sh"
  p_check() { bb_check "$@"; }
  p_deploy() { bb_deploy "$@"; }
  p_promote() { bb_promote "$@"; }
  p_release_notes() { bb_release_notes "$@"; }
  p_token() { echo "$BB_TOKEN"; }
  p_cli() { bp_provider_env node "$DEV" "$@"; }
  p_open() {
    local id body
    body="$(cygpath -m "$4" 2>/dev/null || echo "$4")"
    for _ in $(seq 1 10); do
      id=$(bb_pr_create "$1" "$2" "$3" "$body" 2>"$LOGS/p-open.err")
      if [[ "$id" =~ ^[0-9]+$ ]]; then
        echo "$id"
        return 0
      fi
      sleep 3
    done
    echo "Pull Request creation failed for $1: $(tail -3 "$LOGS/p-open.err")" >&2
    return 1
  }
  # bp_merge waits until Bitbucket reports the last commit pushed on the source branch, then merges
  # with merge_strategy merge_commit (never squash)
  p_merge() { bp_merge "$1"; }
  p_close() { bb_pr_decline "$1"; }
  p_body() {
    bb_api GET "$BB_API/pullrequests/$1" |
      node -e "let s='';process.stdin.setEncoding('utf8').on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).description||''))"
  }
  # The title goes with the description: a PUT is an update of the fields it carries
  p_set_body() {
    local file
    file="$(cygpath -m "$2" 2>/dev/null || echo "$2")"
    bb_api GET "$BB_API/pullrequests/$1" >"$file.current.json"
    node -e "const fs=require('fs');const pr=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));fs.writeFileSync(process.argv[2],JSON.stringify({title:pr.title,description:fs.readFileSync(process.argv[1],'utf8')}))" "$file" "$file.json" "$file.current.json"
    bb_api PUT "$BB_API/pullrequests/$1" --data-binary "@$file.json" >/dev/null
  }
  # q= with state inside it: Bitbucket drops the state parameter as soon as q is present (8ter)
  p_open_number_for_branch() {
    bb_api GET "$BB_API/pullrequests?pagelen=50&q=$(node -e "console.log(encodeURIComponent('source.branch.name=\"'+process.argv[1]+'\" AND state=\"OPEN\"'))" "$1")" |
      node -e "let s='';process.stdin.setEncoding('utf8').on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).values||[];a.sort((x,y)=>y.id-x.id);console.log(a.length?a[0].id:'')})"
  }
  p_list_candidates() {
    local source="$1" label="$2" code start
    shift 2
    cd "$WORK" || return 1
    git checkout -q -f "$source" && git pull -q origin "$source"
    start=$(e2e_now_ms)
    bb_ci_env BITBUCKET_BRANCH="$source" CI_COMMIT_REF_NAME="$source" CONFIG_BRANCH="$source" node "$DEV" hardis:project:promotion:list-candidates --agent --source-branch "$source" "$@" >"$LOGS/$label.log" 2>&1
    code=$?
    e2e_time_record "$label" list-candidates "$start" "$code"
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  # Neither of the two variables the CLI picks Bitbucket from
  p_promote_no_provider() {
    local source="$1" prs="$2" label="$3" code
    shift 3
    cd "$WORK" || return 1
    git checkout -q -f "$source" && git pull -q origin "$source"
    env -u NODE_OPTIONS -u CI_SFDX_HARDIS_BITBUCKET_TOKEN -u CI_SFDX_HARDIS_BITBUCKET_EMAIL -u BITBUCKET_WORKSPACE -u BITBUCKET_REPO_SLUG \
      CI_COMMIT_REF_NAME="$source" CONFIG_BRANCH="$source" \
      node "$DEV" hardis:project:promotion:create --agent --source-branch "$source" --pull-requests "$prs" "$@" >"$LOGS/$label.log" 2>&1
    code=$?
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  # No merge ref on Bitbucket: bb_check merges the target into the source itself. What can lag is the
  # API, which reads the description and the commits of the Pull Request: wait until it reports the
  # pushed head
  p_wait_merge_ref() {
    cd "$WORK" || return 1
    bb_wait_pr_head "$1" "${2:-}"
  }
  p_check_edited() {
    local pr="$1" target="$2" label="$3" edit="$4" code
    cd "$WORK" || return 1
    git checkout -q -f --detach HEAD
    if ! bb_checkout_pr_merge "$pr" 2>"$LOGS/$label.log"; then
      return 1
    fi
    eval "$edit"
    bb_ci_env BITBUCKET_PR_ID="$pr" BITBUCKET_BRANCH="pull-requests/$pr/merge" CI_COMMIT_REF_NAME="pull-requests/$pr/merge" FORCE_TARGET_BRANCH="$target" CONFIG_BRANCH="$target" node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" >"$LOGS/$label.log" 2>&1
    code=$?
    git checkout -q -f -- . 2>/dev/null
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  p_deploy_branch() {
    local branch="$1" label="$2" code
    cd "$WORK" || return 1
    git fetch -q origin "$branch" && git checkout -q -f -B "$branch" "origin/$branch"
    bb_ci_env BITBUCKET_BRANCH="$branch" CI_COMMIT_REF_NAME="$branch" node "$DEV" hardis:project:deploy:smart --target-org "$ORG" >"$LOGS/$label.log" 2>&1
    code=$?
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  p_pr_modal_check() {
    env -u NODE_OPTIONS PROVIDER=bitbucket BB_WORKSPACE="$BB_WORKSPACE" BB_REPO="$BB_REPO" BB_EMAIL="$BB_EMAIL" BB_TOKEN="$BB_TOKEN" \
      WORK="$(cygpath -m "$WORK" 2>/dev/null || echo "$WORK")" DEV="$DEV" EXT="$EXT" \
      node "$_P_DIR/check-pr-modal.cjs" "$@"
  }
  ;;
*)
  echo "unknown PROVIDER $PROVIDER" >&2
  return 1
  ;;
esac

#!/usr/bin/env bash
# Provider neutral names for the job simulators, so promotion-run.sh and promotion-edge.sh run the same
# steps on GitHub and on GitLab. Source it with PROVIDER set; it sources the provider library.
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

_P_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${PROVIDER:?set PROVIDER to github or gitlab}" in
github)
  # shellcheck source=/dev/null
  source "$_P_DIR/e2e-lib.sh"
  p_check() { e2e_check "$@"; }
  p_deploy() { e2e_deploy "$@"; }
  p_promote() { e2e_promote "$@"; }
  p_release_notes() { e2e_release_notes "$@"; }
  p_token() { gh auth token; }
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
    env -u NODE_OPTIONS GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY="$REPO" GITHUB_REPOSITORY_OWNER="${REPO%%/*}"       GITHUB_SERVER_URL="https://github.com" CONFIG_BRANCH="$source"       node "$DEV" hardis:project:promotion:list-candidates --agent --source-branch "$source" "$@" >"$LOGS/$label.log" 2>&1
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
    env -u NODE_OPTIONS -u GITHUB_TOKEN -u GH_TOKEN PATH="$nogh" GITHUB_REPOSITORY="$REPO" GITHUB_REPOSITORY_OWNER="${REPO%%/*}"       GITHUB_SERVER_URL="https://github.com" CONFIG_BRANCH="$source" GH_CONFIG_DIR="$LOGS/no-gh-config"       node "$DEV" hardis:project:promotion:create --agent --source-branch "$source" --pull-requests "$prs" "$@" >"$LOGS/$label.log" 2>&1
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
    git fetch -q origin "+refs/pull/$pr/merge:refs/heads/prmerge-$pr" || return 1
    git checkout -q -f "prmerge-$pr" || return 1
    eval "$edit"
    e2e_ci_env GITHUB_REF_NAME="$pr/merge" GITHUB_REF="refs/pull/$pr/merge" FORCE_TARGET_BRANCH="$target" CONFIG_BRANCH="$target"       node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" >"$LOGS/$label.log" 2>&1
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
    e2e_ci_env GITHUB_REF_NAME="$branch" GITHUB_REF="refs/heads/$branch"       node "$DEV" hardis:project:deploy:smart --target-org "$ORG" >"$LOGS/$label.log" 2>&1
    code=$?
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
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
    gl_ci_env CI_COMMIT_REF_NAME="$source" CONFIG_BRANCH="$source"       node "$DEV" hardis:project:promotion:list-candidates --agent --source-branch "$source" "$@" >"$LOGS/$label.log" 2>&1
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
    env -u NODE_OPTIONS -u CI_SFDX_HARDIS_GITLAB_TOKEN -u CI_JOB_TOKEN CI_SERVER_URL="$GL_HOST" CI_PROJECT_ID="$PROJECT_ID"       CI_PROJECT_PATH="$PROJECT_PATH" CI_PROJECT_URL="$GL_HOST/$PROJECT_PATH" CI_COMMIT_REF_NAME="$source" CONFIG_BRANCH="$source"       node "$DEV" hardis:project:promotion:create --agent --source-branch "$source" --pull-requests "$prs" "$@" >"$LOGS/$label.log" 2>&1
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
    gl_ci_env CI_MERGE_REQUEST_IID="$mr" CI_COMMIT_REF_NAME="refs/merge-requests/$mr/merge" CI_MERGE_REQUEST_TARGET_BRANCH_NAME="$target"       FORCE_TARGET_BRANCH="$target" CONFIG_BRANCH="$target"       node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" >"$LOGS/$label.log" 2>&1
    code=$?
    git checkout -q -f -- . 2>/dev/null
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  p_deploy_branch() {
    local branch="$1" label="$2" code
    cd "$WORK" || return 1
    git fetch -q origin "$branch" && git checkout -q -f -B "$branch" "origin/$branch"
    gl_ci_env CI_COMMIT_REF_NAME="$branch"       node "$DEV" hardis:project:deploy:smart --target-org "$ORG" >"$LOGS/$label.log" 2>&1
    code=$?
    echo "$label exit=$code log=$LOGS/$label.log"
    return $code
  }
  ;;
*)
  echo "unknown PROVIDER $PROVIDER" >&2
  return 1
  ;;
esac

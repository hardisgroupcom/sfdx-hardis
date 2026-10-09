#!/usr/bin/env bash
# Job simulators for the promotion branches end to end test, Bitbucket Cloud flavour. Source this
# file, do not execute it.
#
#   export ORG BB_WORKSPACE BB_REPO BB_EMAIL BB_TOKEN WORK LOGS DEV
#   source .claude/skills/promotion-branches-e2e/scripts/e2e-lib-bitbucket.sh
#
# sfdx-hardis picks Bitbucket when BITBUCKET_WORKSPACE or CI_SFDX_HARDIS_BITBUCKET_TOKEN is set,
# and reads the repository and the Pull Request from BITBUCKET_REPO_SLUG / BITBUCKET_PR_ID, so
# running the CLI locally with those variables reproduces a Bitbucket Pipelines job exactly.
#
#   ORG           target org username or alias
#   BB_WORKSPACE  workspace slug, e.g. sfdxhardistest (always required)
#   BB_REPO       repository slug of the throwaway test repository
#   BB_EMAIL      Atlassian account email, empty for a workspace/repository Access Token.
#                 Defaults to ATLASSIAN_EMAIL when BB_EMAIL is not set at all (set it to "" for an
#                 Access Token)
#   BB_TOKEN      Atlassian API token with Bitbucket scopes, or a Bitbucket Access Token.
#                 Defaults to ATLASSIAN_TOKEN
#   WORK          local clone
#   LOGS          folder where each job log is written
#   DEV           path to bin/dev.js of the sfdx-hardis working copy under test
#
# ATLASSIAN_TOKEN and ATLASSIAN_EMAIL are read from the environment, or else from the .env file at the
# root of the sfdx-hardis working copy (E2E_ENV_FILE to point elsewhere). Nothing prints them.
#
# Credentials: an Atlassian API token authenticates as Basic auth with the account email as the
# username, and it must be an API token WITH SCOPES covering Bitbucket (a classic Atlassian API
# token answers "API Token provided has no Bitbucket scopes"). A Bitbucket workspace or repository
# Access Token authenticates as a Bearer token instead: leave BB_EMAIL empty for that one.

# Settings from the environment, else .env, else derived (env-lib.sh): ORG defaults to E2E_ORG,
# BB_WORKSPACE, ATLASSIAN_TOKEN and ATLASSIAN_EMAIL come from .env when not exported
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env-lib.sh"
e2e_defaults
BB_TOKEN="${BB_TOKEN:-${ATLASSIAN_TOKEN:-}}"
# unset (not empty) BB_EMAIL takes the Atlassian email: an empty one means a Bearer Access Token
BB_EMAIL="${BB_EMAIL-${ATLASSIAN_EMAIL:-}}"

: "${ORG:?set ORG to the target org}"
: "${BB_WORKSPACE:?set BB_WORKSPACE to the workspace slug}"
: "${BB_REPO:?set BB_REPO to the repository slug}"
: "${BB_TOKEN:?set BB_TOKEN (or ATLASSIAN_TOKEN) to a Bitbucket capable token}"
: "${WORK:?set WORK to the local clone}"
: "${LOGS:?set LOGS to the log folder}"
: "${DEV:?set DEV to the path of bin/dev.js}"
export BB_TOKEN BB_EMAIL

mkdir -p "$LOGS"

BB_API="https://api.bitbucket.org/2.0/repositories/$BB_WORKSPACE/$BB_REPO"

# The remote to clone and push with. Git does not take the account email as user name: an Atlassian
# API token (BB_EMAIL set) pushes as x-bitbucket-api-token-auth, which is what the Atlassian
# documentation gives; a workspace or repository Access Token (BB_EMAIL empty) as x-token-auth.
# BB_GIT_USER overrides it, e.g. BB_GIT_USER=x-token-auth when an API token is refused under the
# first name.
# Usage: git remote set-url origin "$(bb_remote_url)"
bb_remote_url() {
  local user="${BB_GIT_USER:-}"
  if [ -z "$user" ]; then
    if [ -n "$BB_EMAIL" ]; then user=x-bitbucket-api-token-auth; else user=x-token-auth; fi
  fi
  echo "https://$user:$BB_TOKEN@bitbucket.org/$BB_WORKSPACE/$BB_REPO.git"
}

# The Bitbucket Cloud REST API. Basic auth with the account email for an Atlassian API token,
# Bearer for a workspace or repository Access Token.
# Usage: bb_api <method> <url> [curl args...]
# -g: the uuid of a pipeline comes in braces, which curl would otherwise expand as a set and send
# without them (every call on a pipeline then answers 404)
bb_api() {
  local method="$1" url="$2"
  shift 2
  if [ -n "$BB_EMAIL" ]; then
    curl -g -sS -u "$BB_EMAIL:$BB_TOKEN" -X "$method" -H "Content-Type: application/json" "$url" "$@"
  else
    curl -g -sS -H "Authorization: Bearer $BB_TOKEN" -X "$method" -H "Content-Type: application/json" "$url" "$@"
  fi
}

# Every CLI call goes through this: NODE_OPTIONS is cleared because the VS Code inspector
# bootloader keeps node alive after the command ends, and the job then looks stuck.
bb_ci_env() {
  env -u NODE_OPTIONS \
    CI=true \
    CI_SFDX_HARDIS_BITBUCKET_TOKEN="$BB_TOKEN" \
    CI_SFDX_HARDIS_BITBUCKET_EMAIL="$BB_EMAIL" \
    BITBUCKET_WORKSPACE="$BB_WORKSPACE" \
    BITBUCKET_REPO_SLUG="$BB_REPO" \
    BITBUCKET_BUILD_NUMBER="1" \
    "$@"
}

# One field of a Pull Request, as Bitbucket knows it
# Usage: bb_pr_field <id> <python expression over `d`>
bb_pr_field() {
  bb_api GET "$BB_API/pullrequests/$1" |
    python -c "import json,sys; d=json.loads(sys.stdin.buffer.read().decode('utf-8')); print($2)"
}

# The head of a branch on the remote, as git itself sees it
# Usage: bb_remote_head <branch>
bb_remote_head() {
  git -C "$WORK" ls-remote origin "refs/heads/$1" | cut -f1
}

# Wait until the Pull Request API reports a given commit (or the remote head of its source branch)
# as its source: Bitbucket knows a pushed commit a moment after the push. The API answers a 12
# character hash. There is no merge ref to wait for (see bb_checkout_pr_merge).
# Usage: bb_wait_pr_head <id> [sha]
bb_wait_pr_head() {
  local id="$1" head="${2:-}" branch got
  if [ -z "$head" ]; then
    branch=$(bb_pr_field "$id" "d['source']['branch']['name']")
    head=$(bb_remote_head "$branch")
    [ -z "$head" ] && head=$(git -C "$WORK" rev-parse "origin/$branch" 2>/dev/null || git -C "$WORK" rev-parse "$branch")
  fi
  for _ in $(seq 1 30); do
    got=$(bb_pr_field "$id" "d['source']['commit']['hash']")
    if [ -n "$got" ] && [[ "$head" == "$got"* ]]; then
      return 0
    fi
    sleep 2
  done
  echo "PR $id never reported $head as its source commit (last answer: $got)" >&2
  return 1
}

# Build the tree a Bitbucket Pipelines pull request job runs on.
#
# Unlike GitHub, GitLab and Azure DevOps, Bitbucket Cloud publishes NO merge ref: neither
# refs/pull-requests/<id>/merge nor .../from is fetchable, and `git ls-remote` advertises none of
# them. What a `pull-requests:` pipeline actually does is check out the SOURCE branch and merge the
# destination branch into it before running the steps, so that is what this reproduces. The upside
# is that there is no lazily written ref to wait for; the downside is that a merge conflict shows
# up here rather than as a stale tree.
# Usage: bb_checkout_pr_merge <id>
bb_checkout_pr_merge() {
  local pr="$1" source target
  source=$(bb_pr_field "$pr" "d['source']['branch']['name']")
  target=$(bb_pr_field "$pr" "d['destination']['branch']['name']")
  if [ -z "$source" ] || [ -z "$target" ]; then
    echo "cannot read the branches of PR $pr" >&2
    return 1
  fi
  git fetch -q origin "$source" "$target" || return 1
  git checkout -q -f --detach "origin/$source" || return 1
  # Bitbucket Pipelines fails the pull request build when this merge conflicts, and so does this
  if ! git -c user.email=e2e@example.com -c user.name=e2e merge -q --no-edit "origin/$target"; then
    git merge --abort 2>/dev/null
    echo "merging $target into $source for PR $pr conflicts" >&2
    return 1
  fi
  return 0
}

# Validation job: Bitbucket Pipelines checks out the merge of the Pull Request
# Usage: bb_check <pr id> <target branch> <log label>
bb_check() {
  local pr="$1" target="$2" label="$3" code
  cd "$WORK" || return 1
  git checkout -q -f --detach HEAD
  # A checkout that fails says so in the job log, so a missing log is never the only trace of it
  if ! bb_checkout_pr_merge "$pr" 2>"$LOGS/$label.log"; then
    cat "$LOGS/$label.log" >&2
    return 1
  fi
  local start
  start=$(e2e_now_ms)
  bb_ci_env \
    BITBUCKET_PR_ID="$pr" \
    BITBUCKET_BRANCH="pull-requests/$pr/merge" \
    CI_COMMIT_REF_NAME="pull-requests/$pr/merge" \
    FORCE_TARGET_BRANCH="$target" \
    CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  e2e_time_record "$label" check "$start" "$code"
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Deployment job: Bitbucket Pipelines checks out the target branch at the merge commit
# Usage: bb_deploy <target branch> <log label>
bb_deploy() {
  local target="$1" label="$2" code
  cd "$WORK" || return 1
  git checkout -q -f "$target" && git pull -q origin "$target"
  local start
  start=$(e2e_now_ms)
  bb_ci_env \
    BITBUCKET_BRANCH="$target" \
    CI_COMMIT_REF_NAME="$target" \
    CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --target-org "$ORG" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  e2e_time_record "$label" deploy "$start" "$code"
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Assemble a promotion, agent mode so nothing prompts
# Usage: bb_promote <source branch> <comma separated PR ids> <log label> [extra flags...]
bb_promote() {
  local source="$1" prs="$2" label="$3" code
  shift 3
  cd "$WORK" || return 1
  git checkout -q -f "$source" && git pull -q origin "$source"
  local start
  start=$(e2e_now_ms)
  bb_ci_env \
    BITBUCKET_BRANCH="$source" \
    CI_COMMIT_REF_NAME="$source" \
    CONFIG_BRANCH="$source" \
    node "$DEV" hardis:project:promotion:create --agent \
    --source-branch "$source" --pull-requests "$prs" "$@" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  e2e_time_record "$label" promote "$start" "$code"
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Release notes of the last go-live merged into main
# Usage: bb_release_notes <log label> [extra flags, e.g. --include-promotions]
bb_release_notes() {
  local label="$1" code
  shift
  cd "$WORK" || return 1
  git checkout -q -f main && git pull -q origin main
  local start
  start=$(e2e_now_ms)
  bb_ci_env \
    BITBUCKET_BRANCH=main \
    CI_COMMIT_REF_NAME=main \
    CONFIG_BRANCH=main \
    node "$DEV" hardis:doc:release-notes --mode post --target-branch main \
    --merge-commit "$(git log --merges -1 --format=%H)" --no-pdf --agent "$@" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  e2e_time_record "$label" release-notes "$start" "$code"
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Open a Pull Request and echo its id
# Usage: bb_pr_create <source branch> <target branch> <title> <description file, or - for none>
bb_pr_create() {
  local source="$1" target="$2" title="$3" body_file="$4" payload
  payload=$(python -c "
import io, json, sys
body = io.open(sys.argv[4], encoding='utf-8').read() if sys.argv[4] != '-' else ''
print(json.dumps({'title': sys.argv[3], 'description': body,
                  'source': {'branch': {'name': sys.argv[1]}},
                  'destination': {'branch': {'name': sys.argv[2]}},
                  'close_source_branch': False}))
" "$source" "$target" "$title" "$body_file")
  bb_api POST "$BB_API/pullrequests" -d "$payload" |
    python -c "
import json, sys
d = json.loads(sys.stdin.buffer.read().decode('utf-8'))
if not d.get('id'):
    print('PR CREATION FAILED', json.dumps(d)[:400], file=sys.stderr); sys.exit(1)
print(d['id'])
"
}

# Merge a Pull Request with a real merge commit, never squashing: the -x trailers of the
# cherry-picks must survive. Bitbucket can answer 202 and merge in the background, so the state is
# polled; the merge is asked again when it did not happen, and a merge that went through earlier
# (its answer lost) counts.
# Usage: bb_pr_merge <id>
bb_pr_merge() {
  local pr="$1" state answer=""
  for _ in $(seq 1 3); do
    state=$(bb_pr_field "$pr" "d.get('state')")
    if [ "$state" = "MERGED" ]; then
      echo "merged"
      return 0
    fi
    answer=$(bb_api POST "$BB_API/pullrequests/$pr/merge" \
      -d '{"merge_strategy": "merge_commit", "close_source_branch": false}')
    for _ in $(seq 1 30); do
      state=$(bb_pr_field "$pr" "d.get('state')")
      if [ "$state" = "MERGED" ]; then
        echo "merged"
        return 0
      fi
      sleep 2
    done
    sleep 5
  done
  echo "MERGE FAILED for PR $pr, last state $state: $(printf '%s' "$answer" | head -c 300)" >&2
  return 1
}

# Decline a Pull Request (close without merging). Opening a new one between the same two branches
# later reopens this one instead of creating a new number (runbook section 8ter).
# Usage: bb_pr_decline <id>
bb_pr_decline() {
  bb_api POST "$BB_API/pullrequests/$1/decline" >/dev/null
}

# The lines worth reading in a job log. Same expression as the GitHub library.
if ! declare -f e2e_grep >/dev/null 2>&1; then
  e2e_grep() {
    grep -aE "PromotionBranch|Pull Request scope|Test classes selected|^ - Promo|Final test level|Delta deployment has been|Found [0-9]+ (Pre|Post)-deployment|Running action|Skipping .*action|Manual action|Successfully (checked|deployed)|Deployment mode|Error \(SfError\)|carries|already" "$1"
  }
fi

# Dump the Pull Requests and their comments in the provider agnostic shape audit-pr-comments.cjs
# reads. Usage: dump_pr_comments <out.json> [pr id ...]   (all Pull Requests when none is given)
dump_pr_comments() {
  local out="$1"
  shift
  BB_API="$BB_API" BB_TOKEN="$BB_TOKEN" BB_EMAIL="$BB_EMAIL" python -c "
import json, os, subprocess, sys

API, TOKEN, EMAIL = os.environ['BB_API'], os.environ['BB_TOKEN'], os.environ['BB_EMAIL']
AUTH = ['-u', EMAIL + ':' + TOKEN] if EMAIL else ['-H', 'Authorization: Bearer ' + TOKEN]

def get(url):
    return json.loads(subprocess.check_output(['curl', '-sS'] + AUTH + [url]))

def paged(url):
    values = []
    while url:
        page = get(url)
        values.extend(page.get('values') or [])
        url = page.get('next')
    return values

# sfdx-hardis hides its markers on Bitbucket in links with no text (utilsBitbucketMarkup.ts): the
# dump gives them back as the HTML comments every checker reads, as the CLI does when it reads them
def shown(text):
    import base64, re, urllib.parse
    def marker(m):
        if m.group(1):
            return '<!-- ' + base64.urlsafe_b64decode(m.group(2) + '=' * (-len(m.group(2)) % 4)).decode('utf-8') + ' -->'
        return '<!-- ' + urllib.parse.unquote(m.group(2)) + ' -->'
    text = re.sub(r'\[\]\(#hardis(64)?:([^)\s]*)\)', marker, text)
    # a task item is sent with a box symbol, which Bitbucket draws where it draws no checkbox
    return re.sub(r'(?m)^(\s*[-*] )([' + chr(0x2610) + chr(0x2611) + r']) ',
                  lambda m: m.group(1) + ('[x] ' if m.group(2) == chr(0x2611) else '[ ] '), text)

wanted = set(int(a) for a in sys.argv[2:])
prs = []
for raw in paged(API + '/pullrequests?state=MERGED&state=OPEN&state=DECLINED&state=SUPERSEDED&pagelen=50'):
    if wanted and raw['id'] not in wanted:
        continue
    comments = []
    for c in paged(API + '/pullrequests/%s/comments?pagelen=50' % raw['id']):
        if c.get('deleted'):
            continue
        comments.append({'id': str(c.get('id')),
                         'body': shown(((c.get('content') or {}).get('raw') or '')),
                         'url': (((c.get('links') or {}).get('html') or {}).get('href') or '')})
    prs.append({'number': raw['id'], 'title': raw.get('title') or '',
                'sourceBranch': (((raw.get('source') or {}).get('branch') or {}).get('name') or ''),
                'targetBranch': (((raw.get('destination') or {}).get('branch') or {}).get('name') or ''),
                'state': (raw.get('state') or '').lower(),
                'description': shown(raw.get('description') or ''),
                'comments': comments})
json.dump({'provider': 'bitbucket', 'prs': prs}, open(sys.argv[1], 'w', encoding='utf-8'), indent=1)
print('dumped %d Pull Requests to %s' % (len(prs), sys.argv[1]))
" "$out" "$@"
}

# Where this library sits, so the pipeline check can find its script next to it
E2E_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# What the vscode-sfdx-hardis DevOps Pipeline shows right now: the User Stories of each branch
# node, its counter bubble, and the open promotion drawn on a merge arrow. Run it before and after
# every promotion operation, with the expectations of that point of the run.
# Usage: pipeline_check <log label> [expectations file]
pipeline_check() {
  local label="$1" expect="${2:-}" code
  env -u NODE_OPTIONS EXT="$EXT" WORK="$WORK" PROVIDER_TOKEN="$BB_TOKEN" PROVIDER_EMAIL="${BB_EMAIL:-}" node "$E2E_SCRIPTS_DIR/check-pipeline.cjs" ${expect:+"$expect"} >"$LOGS/$label.log" 2>&1
  code=$?
  cat "$LOGS/$label.log"
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Backpromote (Beta) hooks of scripts/e2e-lib-backpromote.sh (runbook section 6bis): the variables the
# CLI reads outside CI (no CI, no BITBUCKET_PR_ID), and a Pull Request into integration opened then
# merged. Bitbucket knows a pushed commit a moment later: bp_merge waits until the Pull Request head is
# the last commit of its source branch, so the merge carries the deployment actions file.
bp_provider_env() {
  env -u NODE_OPTIONS -u CI -u BITBUCKET_PR_ID \
    CI_SFDX_HARDIS_BITBUCKET_TOKEN="$BB_TOKEN" \
    CI_SFDX_HARDIS_BITBUCKET_EMAIL="$BB_EMAIL" \
    BITBUCKET_WORKSPACE="$BB_WORKSPACE" \
    BITBUCKET_REPO_SLUG="$BB_REPO" \
    "$@"
}

# Usage: bp_open <branch> <title> [body]  (prints the Pull Request id)
bp_open() {
  local body="$LOGS/bp-pr-body.md" id
  printf '%s\n' "${3:-backpromote end to end test}" >"$body"
  for _ in $(seq 1 10); do
    id=$(bb_pr_create "$1" integration "$2" "$(cygpath -m "$body" 2>/dev/null || echo "$body")" 2>"$LOGS/bp-pr-create.err")
    if [[ "$id" =~ ^[0-9]+$ ]]; then
      echo "$id"
      return 0
    fi
    sleep 3
  done
  echo "Pull Request creation failed for $1: $(tail -3 "$LOGS/bp-pr-create.err")" >&2
  return 1
}

# Usage: bp_merge <id>. Prints "merged" like the other libraries.
bp_merge() {
  bb_wait_pr_head "$1" 2>/dev/null
  bb_pr_merge "$1"
}

# Backpromote (Beta) helpers, provider agnostic
# shellcheck source=/dev/null
source "$E2E_SCRIPTS_DIR/e2e-lib-backpromote.sh"

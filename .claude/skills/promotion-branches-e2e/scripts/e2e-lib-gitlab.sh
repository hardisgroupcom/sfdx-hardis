#!/usr/bin/env bash
# Job simulators for the promotion branches end to end test, GitLab flavour. Source this file.
#
#   export ORG PROJECT_ID PROJECT_PATH GL_HOST GL_TOKEN WORK LOGS DEV
#   source .claude/skills/promotion-branches-e2e/scripts/e2e-lib-gitlab.sh
#
# sfdx-hardis picks GitLab when CI_SFDX_HARDIS_GITLAB_TOKEN (or CI_JOB_TOKEN) is set, and reads the
# project and the merge request from CI_PROJECT_ID / CI_MERGE_REQUEST_IID, so running the CLI
# locally with those variables reproduces a GitLab CI job exactly.
#
#   ORG           target org username or alias
#   PROJECT_ID    numeric id of the throwaway test project
#   PROJECT_PATH  group/name of that project
#   GL_HOST       https://gitlab.example.com
#   GL_TOKEN      a personal or project access token with api scope
#   WORK          local clone
#   LOGS          folder where each job log is written
#   DEV           path to bin/dev.js of the sfdx-hardis working copy under test

: "${ORG:?set ORG to the target org}"
: "${PROJECT_ID:?set PROJECT_ID to the numeric project id}"
: "${PROJECT_PATH:?set PROJECT_PATH to group/name}"
: "${GL_HOST:?set GL_HOST to https://gitlab.example.com}"
: "${GL_TOKEN:?set GL_TOKEN to an api token}"
: "${WORK:?set WORK to the local clone}"
: "${LOGS:?set LOGS to the log folder}"
: "${DEV:?set DEV to the path of bin/dev.js}"

mkdir -p "$LOGS"

# The GitLab REST API, without glab: it prints its own decorations and defaults to gitlab.com
gl_api() {
  local method="$1" path="$2"
  shift 2
  curl -sS -X "$method" -H "PRIVATE-TOKEN: $GL_TOKEN" "$GL_HOST/api/v4/$path" "$@"
}

gl_ci_env() {
  env -u NODE_OPTIONS \
    CI=true \
    CI_SFDX_HARDIS_GITLAB_TOKEN="$GL_TOKEN" \
    CI_SERVER_URL="$GL_HOST" \
    CI_PROJECT_ID="$PROJECT_ID" \
    CI_PROJECT_PATH="$PROJECT_PATH" \
    CI_PROJECT_URL="$GL_HOST/$PROJECT_PATH" \
    "$@"
}

# The head of the source branch of a merge request, as GitLab knows it
# Usage: gl_mr_sha <iid>
gl_mr_sha() {
  curl -sS -H "PRIVATE-TOKEN: $GL_TOKEN" \
    "$GL_HOST/api/v4/projects/$PROJECT_ID/merge_requests/$1" |
    python -c "import json,sys; print(json.load(sys.stdin)['sha'])"
}

# Check out refs/merge-requests/<iid>/merge as a GitLab CI job would.
#
# GitLab writes that ref lazily: after a push to the source branch it still points at the previous
# merge, and asking for it hands back the stale commit_id while the new one is computed. A job run
# then validates a tree without the commit that was just pushed, which looks like a product bug and
# is not one. So the ref is fetched again until it holds the head of the source branch.
# Usage: gl_fetch_merge_ref <iid>
gl_fetch_merge_ref() {
  local mr="$1" sha
  sha=$(gl_mr_sha "$mr")
  for _ in $(seq 1 20); do
    curl -sS -H "PRIVATE-TOKEN: $GL_TOKEN" \
      "$GL_HOST/api/v4/projects/$PROJECT_ID/merge_requests/$mr/merge_ref" >/dev/null
    if git fetch -q origin "+refs/merge-requests/$mr/merge:refs/heads/mrmerge-$mr" 2>/dev/null &&
      git merge-base --is-ancestor "$sha" "mrmerge-$mr" 2>/dev/null; then
      return 0
    fi
    sleep 3
  done
  echo "merge ref of !$mr never caught up with $sha" >&2
  return 1
}

# Validation job: GitLab CI checks out refs/merge-requests/<iid>/merge
# Usage: gl_check <mr iid> <target branch> <log label>
gl_check() {
  local mr="$1" target="$2" label="$3" code
  cd "$WORK" || return 1
  git checkout -q -f --detach HEAD
  gl_fetch_merge_ref "$mr" || return 1
  git checkout -q -f "mrmerge-$mr" || return 1
  gl_ci_env \
    CI_MERGE_REQUEST_IID="$mr" \
    CI_COMMIT_REF_NAME="refs/merge-requests/$mr/merge" \
    CI_MERGE_REQUEST_TARGET_BRANCH_NAME="$target" \
    FORCE_TARGET_BRANCH="$target" \
    CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Deployment job: GitLab CI checks out the target branch at the merge commit
# Usage: gl_deploy <target branch> <log label>
gl_deploy() {
  local target="$1" label="$2" code
  cd "$WORK" || return 1
  git checkout -q -f "$target" && git pull -q origin "$target"
  gl_ci_env \
    CI_COMMIT_REF_NAME="$target" \
    CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --target-org "$ORG" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Assemble a promotion, agent mode so nothing prompts
# Usage: gl_promote <source branch> <comma separated MR iids> <log label> [extra flags...]
gl_promote() {
  local source="$1" mrs="$2" label="$3" code
  shift 3
  cd "$WORK" || return 1
  git checkout -q -f "$source" && git pull -q origin "$source"
  gl_ci_env \
    CI_COMMIT_REF_NAME="$source" \
    CONFIG_BRANCH="$source" \
    node "$DEV" hardis:project:promotion:create --agent \
    --source-branch "$source" --pull-requests "$mrs" "$@" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Release notes of the last go-live merged into main
# Usage: gl_release_notes <log label> [extra flags]
gl_release_notes() {
  local label="$1" code
  shift
  cd "$WORK" || return 1
  git checkout -q -f main && git pull -q origin main
  gl_ci_env \
    CI_COMMIT_REF_NAME=main \
    CONFIG_BRANCH=main \
    node "$DEV" hardis:doc:release-notes --mode post --target-branch main \
    --merge-commit "$(git log --merges -1 --format=%H)" --no-pdf --agent "$@" \
    >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# Open a merge request and echo its iid
# Usage: gl_mr_create <source branch> <target branch> <title> <description file>
gl_mr_create() {
  local source="$1" target="$2" title="$3" body_file="$4"
  local payload
  payload=$(python -c "
import io, json, sys
body = io.open(sys.argv[4], encoding='utf-8').read() if sys.argv[4] != '-' else ''
print(json.dumps({'source_branch': sys.argv[1], 'target_branch': sys.argv[2], 'title': sys.argv[3],
                  'description': body, 'squash': False, 'remove_source_branch': False}))
" "$source" "$target" "$title" "$body_file")
  curl -sS -X POST -H "PRIVATE-TOKEN: $GL_TOKEN" -H "Content-Type: application/json" \
    -d "$payload" "$GL_HOST/api/v4/projects/$PROJECT_ID/merge_requests" |
    python -c "import json,sys; print(json.load(sys.stdin)['iid'])"
}

# Merge a merge request, never squashing: the -x trailers of the cherry-picks must survive.
# GitLab computes mergeability asynchronously and refuses the merge while it is still checking.
# Usage: gl_mr_merge <iid>
gl_mr_merge() {
  local mr="$1" status
  local url="$GL_HOST/api/v4/projects/$PROJECT_ID/merge_requests/$mr"
  for _ in $(seq 1 30); do
    status=$(curl -sS -H "PRIVATE-TOKEN: $GL_TOKEN" "$url" |
      python -c "import json,sys; d=json.load(sys.stdin); print(d.get('detailed_merge_status') or d.get('merge_status'))")
    case "$status" in
    checking | unchecked | preparing) sleep 2 ;;
    *) break ;;
    esac
  done
  curl -sS -X PUT -H "PRIVATE-TOKEN: $GL_TOKEN" -H "Content-Type: application/json" \
    -d '{"squash": false, "should_remove_source_branch": false}' "$url/merge" |
    python -c "
import json, sys
answer = json.load(sys.stdin)
if answer.get('state') == 'merged':
    print('merged')
else:
    print('MERGE FAILED', json.dumps(answer)[:300]); sys.exit(1)
"
}

# Dump the merge requests and their notes in the provider agnostic shape audit-pr-comments.cjs
# reads. Usage: dump_pr_comments <out.json> [mr iid ...]   (all merge requests when none is given)
dump_pr_comments() {
  local out="$1"
  shift
  GL_HOST="$GL_HOST" GL_TOKEN="$GL_TOKEN" PROJECT_ID="$PROJECT_ID" python -c "
import json, os, subprocess, sys

HOST, TOKEN, PROJECT = os.environ['GL_HOST'], os.environ['GL_TOKEN'], os.environ['PROJECT_ID']

def get(path):
    values, page = [], 1
    while True:
        sep = '&' if '?' in path else '?'
        url = '%s/api/v4/%s%sper_page=100&page=%d' % (HOST, path, sep, page)
        chunk = json.loads(subprocess.check_output(['curl', '-sS', '-H', 'PRIVATE-TOKEN: ' + TOKEN, url]))
        if not chunk:
            break
        values.extend(chunk)
        if len(chunk) < 100:
            break
        page += 1
    return values

wanted = set(int(a) for a in sys.argv[2:])
prs = []
for raw in get('projects/%s/merge_requests?state=all&scope=all' % PROJECT):
    if wanted and raw['iid'] not in wanted:
        continue
    comments = [{'id': str(n['id']), 'body': n.get('body') or '',
                 'url': '%s#note_%s' % (raw.get('web_url', ''), n['id'])}
                for n in get('projects/%s/merge_requests/%s/notes' % (PROJECT, raw['iid']))
                if not n.get('system')]
    prs.append({'number': raw['iid'], 'title': raw.get('title') or '',
                'sourceBranch': raw.get('source_branch') or '', 'targetBranch': raw.get('target_branch') or '',
                'state': raw.get('state') or '',
                'description': raw.get('description') or '',
                'comments': comments})
json.dump({'provider': 'gitlab', 'prs': prs}, open(sys.argv[1], 'w', encoding='utf-8'), indent=1)
print('dumped %d merge requests to %s' % (len(prs), sys.argv[1]))
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
  env -u NODE_OPTIONS     EXT="${EXT:-C:/git/vscode-sfdx-hardis}"     WORK="$WORK"     PROVIDER_TOKEN="$GL_TOKEN"     node "$E2E_SCRIPTS_DIR/check-pipeline.cjs" ${expect:+"$expect"}     >"$LOGS/$label.log" 2>&1
  code=$?
  cat "$LOGS/$label.log"
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

#!/usr/bin/env bash
# Builds a throwaway GitLab project holding every way a User Story reaches the next major branch
# without a promotion branch, through real merge requests, for detectManualCherryPicks.
#
#   GL_HOST=https://gitlab.example.com GL_TOKEN=<api token> WORK=<new folder> \
#     NAME=<project name> bash build-repo.sh
#
# Writes $WORK/../e2e-state (PROJECT_ID, PROJECT_PATH, the merge request numbers and the commits of
# each story) for the run scripts. Phase B (uat merged into preprod) is phase-b.sh.
#
# Integration -> uat, one story per pattern:
#   S1  picked -x into release/1, squash-merged into uat (R1)            moved, provider listing
#   S2  picked -x into release/2, merged into uat with a merge commit (R2) moved
#   S3  picked -x straight onto uat, then uat is back-merged into integration
#                                                                         moved by the new code only
#   S4  picked WITHOUT -x straight onto uat, same title                   probable
#   S5  two commits, only the first picked -x straight onto uat           partial
#   S6  dragged by hotfix/h branched from integration, squashed into uat (HF), with a fix of its own
#                                                                         moved, HF stays a story
#   S7  promoted through a real promotion branch                          already promoted
#   S8  nothing                                                           candidate
#   S9  picked -x into release/9, a merge request opened BEFORE S9 was merged, squashed (R9)
#                                                                         moved
# Uat -> preprod:
#   R1  its squash commit picked -x straight onto preprod                 moved, S1 follows it
#   S10 merged into uat directly                                          candidate
set -euo pipefail

: "${GL_HOST:?}"
: "${GL_TOKEN:?}"
: "${WORK:?}"
: "${NAME:?}"
CLI="${CLI:-node /c/git/sfdx-hardis/bin/run.js}"

[ -e "$WORK" ] && { echo "ERROR: $WORK exists" >&2; exit 1; }

api() {
  local method="$1" path="$2"
  shift 2
  curl -sS -f -X "$method" -H "PRIVATE-TOKEN: $GL_TOKEN" "$GL_HOST/api/v4/$path" "$@"
}
json() { python -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
log() { echo "[build] $*"; }

# ------------------------------------------------------------------ project
PROJECT_JSON=$(api POST projects --data-urlencode "name=$NAME" -d visibility=private -d initialize_with_readme=false)
PROJECT_ID=$(echo "$PROJECT_JSON" | json "d['id']")
PROJECT_PATH=$(echo "$PROJECT_JSON" | json "d['path_with_namespace']")
log "project $PROJECT_PATH ($PROJECT_ID)"
HOST_NAME=${GL_HOST#https://}
REMOTE="https://oauth2:$GL_TOKEN@$HOST_NAME/$PROJECT_PATH.git"

mkdir -p "$WORK"
cd "$WORK"
git init -q -b main
git config user.email "e2e@example.invalid"
git config user.name "E2E"
git config commit.gpgsign false
git remote add origin "$REMOTE"

mkdir -p config/branches force-app/main/default/classes
cat >sfdx-project.json <<'JSON'
{ "packageDirectories": [{ "path": "force-app", "default": true }], "name": "mcp-e2e", "namespace": "", "sourceApiVersion": "67.0" }
JSON
cat >config/.sfdx-hardis.yml <<'YAML'
projectName: mcp-e2e
developmentBranch: integration
enablePromotionBranches: true
detectManualCherryPicks: false
allowedPromotionSteps:
  - source: integration
    target: uat
  - source: uat
    target: preprod
YAML
branch_config() {
  {
    echo "branchName: $1"
    echo "level: $2"
    if [ "$3" = "-" ]; then echo "mergeTargets: []"; else printf 'mergeTargets:\n  - %s\n' "$3"; fi
  } >"config/branches/.sfdx-hardis.$1.yml"
}
branch_config integration 10 uat
branch_config uat 20 preprod
branch_config preprod 90 main
branch_config main 100 -
printf 'config/user/\n.sf/\n.sfdx/\nhardis-report/\n' >.gitignore
echo "base" >force-app/main/default/classes/base.txt
git add -A
git commit -q -m "Base project"
for branch in preprod uat integration; do git branch "$branch"; done
git push -q origin main preprod uat integration

# ------------------------------------------------------------------ helpers
STATE="$WORK/../e2e-state"
: >"$STATE"
save() { echo "$1=$2" >>"$STATE"; }

# Opens a merge request and returns its iid. GitLab answers 400 for a branch pushed a moment ago:
# asked again until it knows the branch
mr_open() {
  local source="$1" target="$2" title="$3" answer
  for _ in $(seq 1 15); do
    if answer=$(api POST "projects/$PROJECT_ID/merge_requests" --data-urlencode "source_branch=$source" \
      --data-urlencode "target_branch=$target" --data-urlencode "title=$title" 2>/dev/null); then
      echo "$answer" | json "d['iid']"
      return 0
    fi
    sleep 2
  done
  echo "ERROR: cannot open a merge request $source -> $target" >&2
  exit 1
}

# Merges a merge request once GitLab says it can, with or without squash, and fetches
mr_merge() {
  local iid="$1" squash="$2"
  for _ in $(seq 1 60); do
    local status
    status=$(api GET "projects/$PROJECT_ID/merge_requests/$iid" | json "d.get('detailed_merge_status')")
    if [ "$status" = "mergeable" ]; then
      if api PUT "projects/$PROJECT_ID/merge_requests/$iid/merge" -d "squash=$squash" \
        -d should_remove_source_branch=false >/dev/null 2>&1; then
        break
      fi
    fi
    sleep 2
  done
  local state
  state=$(api GET "projects/$PROJECT_ID/merge_requests/$iid" | json "d['state']")
  [ "$state" = "merged" ] || { echo "ERROR: !$iid is $state" >&2; exit 1; }
  git fetch -q origin
}

# A story: one MR into integration with a merge commit. Writes S<n>_MR and S<n>_C1.. (its commits)
story() {
  local n="$1" commits="${2:-1}" target="${3:-integration}"
  git checkout -q -B "feature/s$n" "origin/$target"
  for i in $(seq 1 "$commits"); do
    echo "story $n part $i" >"force-app/main/default/classes/s$n-$i.txt"
    git add -A
    git commit -q -m "S$n change part $i"
    save "S${n}_C$i" "$(git rev-parse HEAD)"
  done
  git push -q origin "feature/s$n"
  local iid
  iid=$(mr_open "feature/s$n" "$target" "S$n story")
  mr_merge "$iid" false
  save "S${n}_MR" "$iid"
  log "S$n merged into $target as !$iid"
}

# shellcheck source=/dev/null
load() { source "$STATE"; }

# ------------------------------------------------------------------ S6 and the hotfix
story 6
git checkout -q -B hotfix/h origin/integration
echo "hotfix" >force-app/main/default/classes/hotfix.txt
git add -A
git commit -q -m "Hotfix of its own"
git push -q origin hotfix/h
HF=$(mr_open hotfix/h uat "Hotfix h")
mr_merge "$HF" true
save HF_MR "$HF"
log "hotfix/h squashed into uat as !$HF"

# ------------------------------------------------------------------ R9 opened before S9 exists
git checkout -q -B release/9 origin/uat
echo "release 9" >force-app/main/default/classes/release9.txt
git add -A
git commit -q -m "Prepare release 9"
git push -q origin release/9
R9=$(mr_open release/9 uat "Release 9")
save R9_MR "$R9"
log "release/9 opened as !$R9"

# ------------------------------------------------------------------ the stories
for n in 1 2 3 4 7 8 9; do story "$n"; done
story 5 2
load

# ------------------------------------------------------------------ S3 straight onto uat, then back-merge
git checkout -q -B uat origin/uat
git cherry-pick -x "$S3_C1" >/dev/null
git push -q origin uat
save S3_PICK "$(git rev-parse HEAD)"
BACK=$(mr_open uat integration "Back-merge uat into integration")
mr_merge "$BACK" false
save BACK_MR "$BACK"
log "uat back-merged into integration as !$BACK"

# ------------------------------------------------------------------ R1 squash, R2 merge commit
git checkout -q -B release/1 origin/uat
git cherry-pick -x "$S1_C1" >/dev/null
git push -q origin release/1
R1=$(mr_open release/1 uat "Release 1")
mr_merge "$R1" true
save R1_MR "$R1"
git checkout -q -B release/2 origin/uat
git cherry-pick -x "$S2_C1" >/dev/null
git push -q origin release/2
R2=$(mr_open release/2 uat "Release 2")
mr_merge "$R2" false
save R2_MR "$R2"
log "release/1 squashed as !$R1, release/2 merged as !$R2"

# ------------------------------------------------------------------ S4 without -x, S5 half
git checkout -q -B uat origin/uat
git cherry-pick "$S4_C1" >/dev/null
git cherry-pick -x "$S5_C1" >/dev/null
git push -q origin uat

# ------------------------------------------------------------------ S9 into the old release MR
git checkout -q -B release/9 origin/release/9
git merge -q --no-edit origin/uat
git cherry-pick -x "$S9_C1" >/dev/null
git push -q origin release/9
mr_merge "$R9" true
log "release/9 squashed as !$R9"

# ------------------------------------------------------------------ S7 through a promotion branch
story 10 1 uat
git checkout -q integration 2>/dev/null || git checkout -q -B integration origin/integration
git reset -q --hard origin/integration
load
export CI_SFDX_HARDIS_GITLAB_TOKEN="$GL_TOKEN" CI_SERVER_URL="$GL_HOST" CI_PROJECT_ID="$PROJECT_ID" \
  CI_PROJECT_PATH="$PROJECT_PATH" CI_PROJECT_URL="$GL_HOST/$PROJECT_PATH"
$CLI hardis:project:promotion:create --agent --source-branch integration --target-branch uat \
  --pull-requests "$S7_MR" --json >"$WORK/../promotion-create.json" 2>"$WORK/../promotion-create.err" || {
  echo "ERROR: promotion:create failed, see promotion-create.err" >&2
  exit 1
}
# The path goes as an argument: a Windows path inside the Python source breaks on its backslashes
PROMO=$(python -c "import json,re,sys; d=json.load(open(sys.argv[1])); u=(d.get('result') or {}).get('pullRequestUrl') or ''; m=re.search(r'/(\d+)/?$', u); print(m.group(1) if m else '')" "$WORK/../promotion-create.json")
[ -n "$PROMO" ] || { echo "ERROR: no promotion number in promotion-create.json" >&2; exit 1; }
mr_merge "$PROMO" false
save PROMO_MR "$PROMO"
log "S7 promoted through !$PROMO"

# ------------------------------------------------------------------ R1 picked onto preprod
load
git checkout -q -B preprod origin/preprod
R1_SQUASH=$(api GET "projects/$PROJECT_ID/merge_requests/$R1" | json "d.get('squash_commit_sha') or d['merge_commit_sha']")
save R1_SQUASH "$R1_SQUASH"
git cherry-pick -x "$R1_SQUASH" >/dev/null
git push -q origin preprod
save R1_PICK "$(git rev-parse HEAD)"

save PROJECT_ID "$PROJECT_ID"
save PROJECT_PATH "$PROJECT_PATH"
git checkout -q -B integration origin/integration
log "done: $GL_HOST/$PROJECT_PATH"

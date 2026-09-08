#!/usr/bin/env bash
# Regression check of the promotion branches feature on GitLab: run the same CI jobs with a given
# sfdx-hardis checkout and store their logs, so two runs (main vs the branch under test, feature
# off) can be compared line by line with ab-diff.py.
#
# Usage: ab-run-gitlab.sh <label> <off|on> <feature MR> <feature target> <major MR> <major target> <deploy branch>
#
# Needs the same environment as e2e-lib-gitlab.sh (ORG, PROJECT_ID, PROJECT_PATH, GL_HOST,
# GL_TOKEN, WORK, LOGS, DEV), and that library sourced for gl_fetch_merge_ref.
#
# Copy this script (and ab-diff.py) outside the sfdx-hardis working copy before running the pair:
# checking out origin/main takes .claude/skills away with it.
set -u
LABEL="$1"
MODE="$2"
FEATURE_MR="$3"
FEATURE_TARGET="$4"
MAJOR_MR="$5"
MAJOR_TARGET="$6"
DEPLOY_BRANCH="$7"
OUT="$LOGS/ab-$LABEL"
mkdir -p "$OUT"
cd "$WORK" || exit 1

set_flag() {
  if [ "$MODE" = "off" ]; then
    sed -i 's/^enablePromotionBranches: true$/enablePromotionBranches: false/' config/.sfdx-hardis.yml
  fi
}
restore_flag() { git checkout -q -- config/.sfdx-hardis.yml; }

run_check() {
  local mr="$1" target="$2" name="$3" code
  git checkout -q -f --detach HEAD
  gl_fetch_merge_ref "$mr" || return 1
  git checkout -q -f "mrmerge-$mr"
  set_flag
  gl_ci_env CI_MERGE_REQUEST_IID="$mr" CI_COMMIT_REF_NAME="refs/merge-requests/$mr/merge" \
    CI_MERGE_REQUEST_TARGET_BRANCH_NAME="$target" FORCE_TARGET_BRANCH="$target" CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" >"$OUT/$name.log" 2>&1
  code=$?
  echo "$name exit=$code"
  restore_flag
}
run_deploy() {
  local target="$1" name="$2" code
  git checkout -q -f "$target" && git pull -q origin "$target"
  set_flag
  gl_ci_env CI_COMMIT_REF_NAME="$target" CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --target-org "$ORG" >"$OUT/$name.log" 2>&1
  code=$?
  echo "$name exit=$code"
  restore_flag
}
run_release_notes() {
  local code
  git checkout -q -f main && git pull -q origin main
  set_flag
  gl_ci_env CI_COMMIT_REF_NAME=main CONFIG_BRANCH=main \
    node "$DEV" hardis:doc:release-notes --mode post --target-branch main \
    --merge-commit "$(git log --merges -1 --format=%H)" --no-pdf --agent >"$OUT/release-notes.log" 2>&1
  code=$?
  echo "release-notes exit=$code"
  cp hardis-report/release-notes/main-*/release-notes-main-*.md "$OUT/release-notes.md" 2>/dev/null
  restore_flag
}

run_check "$FEATURE_MR" "$FEATURE_TARGET" "check-feature-mr$FEATURE_MR"
run_check "$MAJOR_MR" "$MAJOR_TARGET" "check-major-mr$MAJOR_MR"
run_deploy "$DEPLOY_BRANCH" "deploy-$DEPLOY_BRANCH"
run_release_notes
echo "AB $LABEL ($MODE) DONE"

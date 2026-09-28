#!/usr/bin/env bash
# Regression check of the promotion branches feature: run the same CI jobs on the test repository
# with a given sfdx-hardis checkout and store their logs, so two runs (main vs the branch under
# test, feature off) can be compared line by line with ab-diff.py.
#
# Usage: ab-run.sh <label> <off|on> <feature PR> <feature PR target> <major PR> <major PR target> <deploy branch>
#   label      name of the output folder ($LOGS/ab-<label>)
#   off|on     "off" rewrites enablePromotionBranches to false in the checked-out tree before each job
#
# Needs ORG, REPO, WORK, LOGS and DEV in the environment (see the runbook, section 0).
# Run it once per CLI version, switching the CLI checkout in between:
#   (cd "$CLI" && git checkout feat/promotion-branches) && ./ab-run.sh branch off 15 uat 16 preprod uat
#   (cd "$CLI" && git checkout --detach origin/main)    && ./ab-run.sh main   off 15 uat 16 preprod uat
# Then: python ab-diff.py "$LOGS/ab-main" "$LOGS/ab-branch"
#
# Run each pair twice: the first pass of the pair creates the Pull Request comments and records the
# once-per-org deployment actions, so the second CLI of the pair "updates" and "skips" where the
# first one "added" and "ran". Only the second pass, in steady state, compares cleanly.
set -u
LABEL="$1"
MODE="$2"
FEATURE_PR="$3"
FEATURE_TARGET="$4"
MAJOR_PR="$5"
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
ci_env() {
  env -u NODE_OPTIONS CI=true GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY="$REPO" \
    GITHUB_REPOSITORY_OWNER="${REPO%%/*}" GITHUB_SERVER_URL="https://github.com" "$@"
}
run_check() {
  local pr="$1" target="$2" name="$3" code
  git checkout -q -f --detach HEAD
  git fetch -q origin "+refs/pull/$pr/merge:refs/heads/ab-$pr" || return 1
  git checkout -q -f "ab-$pr"
  set_flag
  ci_env GITHUB_REF_NAME="$pr/merge" GITHUB_REF="refs/pull/$pr/merge" FORCE_TARGET_BRANCH="$target" CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --check --target-org "$ORG" >"$OUT/$name.log" 2>&1
  code=$?
  echo "$name exit=$code"
  restore_flag
}
run_deploy() {
  local target="$1" name="$2" code
  git checkout -q -f "$target" && git pull -q origin "$target"
  set_flag
  ci_env GITHUB_REF_NAME="$target" GITHUB_REF="refs/heads/$target" CONFIG_BRANCH="$target" \
    node "$DEV" hardis:project:deploy:smart --target-org "$ORG" >"$OUT/$name.log" 2>&1
  code=$?
  echo "$name exit=$code"
  restore_flag
}
run_release_notes() {
  local code
  git checkout -q -f main && git pull -q origin main
  set_flag
  ci_env GITHUB_REF_NAME=main CONFIG_BRANCH=main \
    node "$DEV" hardis:doc:release-notes --mode post --target-branch main \
    --merge-commit "$(git log --merges -1 --format=%H)" --no-pdf --agent >"$OUT/release-notes.log" 2>&1
  code=$?
  echo "release-notes exit=$code"
  cp hardis-report/release-notes/main-*/release-notes-main-*.md "$OUT/release-notes.md" 2>/dev/null
  restore_flag
}

run_check "$FEATURE_PR" "$FEATURE_TARGET" "check-feature-pr$FEATURE_PR"
run_check "$MAJOR_PR" "$MAJOR_TARGET" "check-major-pr$MAJOR_PR"
run_deploy "$DEPLOY_BRANCH" "deploy-$DEPLOY_BRANCH"
run_release_notes
echo "AB $LABEL ($MODE) DONE"

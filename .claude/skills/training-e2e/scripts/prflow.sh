#!/usr/bin/env bash
# prflow.sh <pr> [check|merge|squash]
#   check   wait for the checks of the Pull Request and print them
#   merge   the same, then merge when green and watch the deployment job of the base branch
#   squash  the same with a squash merge, which is what a feature Pull Request gets
#
# Feature Pull Requests are squash merged; promotions, retrofits and config Pull
# Requests are merged. Do not change that: the release notes and the retrofit read
# the history.
set -e
# shellcheck source-path=SCRIPTDIR
# shellcheck source=env.sh
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
R=$FORK
PR=$1
MODE=${2:-merge}
[ -n "$PR" ] || {
  echo "usage: prflow.sh <pr> [check|merge|squash]"
  exit 1
}

# Right after a Pull Request is created its required checks are not registered
# yet, and `gh pr checks --watch` returns at once. Worse, the head commit often
# already carries finished runs from its previous branch (the deploy of the
# merge that produced it), so "some check exists and none is pending" is not
# proof of anything. Wait for the two checks every protected branch of this
# course requires to be present, on the head commit: after a push onto an open
# Pull Request (a teammate's fix, Lab 3.2) the checks of the previous commit still
# read pass, and a merge on them is refused as soon as the new ones register.
for _ in $(seq 1 30); do
  HEAD=$(gh pr view "$PR" -R "$R" --json headRefOid -q .headRefOid)
  L=$(gh api "repos/$R/commits/$HEAD/check-runs" --paginate -q '.check_runs[].name' 2>/dev/null)
  echo "$L" | grep -q "Simulate Deployment to Major Org" && echo "$L" | grep -q "Mega-Linter" && break
  sleep 10
done
# `gh pr checks --watch` returns when every check has finished, whatever their
# number. Counting lines instead meant guessing how many checks a Pull Request
# has, and a Pull Request into a major branch has fewer than a feature one: the
# wait never ended. A non-zero exit here only means a check failed.
# One watch is not enough either: the second workflow can register while the
# first is being watched, so watch again as long as anything reads pending.
for _ in $(seq 1 30); do
  gh pr checks "$PR" -R "$R" --watch --interval 10 >/dev/null 2>&1 || true
  PENDING=$(gh pr checks "$PR" -R "$R" 2>/dev/null | grep -v Socket | cut -f2 | grep -cxE "pending" || true)
  [ "${PENDING:-0}" -eq 0 ] && break
  sleep 10
done
# `|| true`: grep exits 1 when it filters every line out, and under `set -e` a bare
# pipeline ending in grep would kill the script here with nothing printed.
gh pr checks "$PR" -R "$R" 2>&1 | cut -f1,2 | grep -v Socket || true
[ "$MODE" = "check" ] && exit 0
# Match the state column only. Matching the whole row made any check whose name or
# URL contains "fail" block the merge.
if gh pr checks "$PR" -R "$R" 2>/dev/null | grep -v Socket | cut -f2 | grep -qxE "fail"; then
  echo "NOT MERGED: a check failed"
  exit 1
fi

BASE=$(gh pr view "$PR" -R "$R" --json baseRefName -q .baseRefName)
# The deployment run to watch is the one this merge starts. Remember the newest
# run before merging, so a run left by the previous merge into the same branch
# (Lab 3.4 merges three Pull Requests into integration back to back) is never
# mistaken for it.
WORKFLOW='Process Deployment (sfdx-hardis)'
BEFORE=$(gh run list -R "$R" --branch "$BASE" -w "$WORKFLOW" -L 1 --json databaseId -q '.[0].databaseId // ""')

METHOD=--merge
[ "$MODE" = "squash" ] && METHOD=--squash
# Keep the merge's own exit status: piping into `tail` would hand the pipeline tail's
# status, `set -e` would see nothing, and a merge refused by branch protection or a
# conflict would be reported ten minutes later as a missing deployment run.
MERGE_OUT=$(gh pr merge "$PR" -R "$R" $METHOD 2>&1) || {
  echo "$MERGE_OUT" | tail -3
  echo "NOT MERGED: gh pr merge refused it"
  exit 1
}
echo "$MERGE_OUT" | tail -1

ID=""
for _ in $(seq 1 120); do
  ID=$(gh run list -R "$R" --branch "$BASE" -w "$WORKFLOW" -L 1 --json databaseId -q '.[0].databaseId // ""')
  [ -n "$ID" ] && [ "$ID" != "$BEFORE" ] && break
  ID=""
  sleep 5
done
if [ -z "$ID" ]; then
  echo "MERGED, but no new deployment run appeared on $BASE within 10 minutes"
  exit 1
fi
gh run watch "$ID" -R "$R" --exit-status >/dev/null 2>&1 || true
gh run view "$ID" -R "$R" --json conclusion,displayTitle -q '"DEPLOY \(.displayTitle): \(.conclusion)"'

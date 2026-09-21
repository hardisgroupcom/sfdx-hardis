#!/usr/bin/env bash
# prflow.sh <pr> [check|merge|squash]
#   check   wait for the checks of the Pull Request and print them
#   merge   the same, then merge when green and watch the deployment job of the base branch
#   squash  the same with a squash merge, which is what a feature Pull Request gets
#
# Feature Pull Requests are squash merged; promotions, retrofits and config Pull
# Requests are merged. Do not change that: the release notes and the retrofit read
# the history.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
R=$FORK
PR=$1
MODE=${2:-merge}
until [ "$(gh pr checks "$PR" -R "$R" 2>/dev/null | wc -l)" -ge 4 ] && [ "$(gh pr checks "$PR" -R "$R" 2>/dev/null | grep -c pending)" = "0" ]; do sleep 10; done
gh pr checks "$PR" -R "$R" 2>&1 | cut -f1,2 | grep -v Socket
[ "$MODE" = "check" ] && exit 0
if gh pr checks "$PR" -R "$R" 2>/dev/null | grep -v Socket | grep -q fail; then echo "NOT MERGED: a check failed"; exit 1; fi
BASE=$(gh pr view "$PR" -R "$R" --json baseRefName -q .baseRefName)
METHOD=--merge; [ "$MODE" = "squash" ] && METHOD=--squash
gh pr merge "$PR" -R "$R" $METHOD 2>&1 | tail -1
until [ -n "$(gh run list -R "$R" --branch "$BASE" -w 'Process Deployment (sfdx-hardis)' -L 1 --json databaseId,createdAt -q ".[] | select(.createdAt > \"$(date -u -d '-3 minutes' +%Y-%m-%dT%H:%M:%SZ)\") | .databaseId")" ]; do sleep 5; done
ID=$(gh run list -R "$R" --branch "$BASE" -w 'Process Deployment (sfdx-hardis)' -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$ID" -R "$R" --exit-status >/dev/null 2>&1
gh run view "$ID" -R "$R" --json conclusion,displayTitle -q '"DEPLOY \(.displayTitle): \(.conclusion)"'

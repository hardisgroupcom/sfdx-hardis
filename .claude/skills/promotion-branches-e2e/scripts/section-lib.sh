#!/usr/bin/env bash
# Assertion helpers of the scripted sections that run on top of promotion-run.sh
# (deployment-actions-run.sh, identical-actions-run.sh). Source it after promotion-provider.sh and
# stories.sh, once RESULTS names the results file of the section.
#
#   record <id> <OK|FAIL|SKIP> <text>
#   assert_log <id> <label> <expected exit or -> <description> <pattern>...   (! = must not match)
#   job <p_check|p_deploy|p_promote> <args...>   runs a job, keeps its exit code next to its log
#   cli <label> <branch> <sf hardis args...>     a command run by a person (no CI)
#   status_check <id> <label> <description> "<action:list flags>" <expectation>...
#   promo_number <label>                         the promotion Pull Request a log created
#   open_story <branch> <target> <resource> <title> <body file> <actions kind>
SECTION_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${RESULTS:?set RESULTS to the results file of the section before sourcing section-lib.sh}"
CHECKER="$(cygpath -m "$SECTION_LIB_DIR/check-action-status.cjs" 2>/dev/null || echo "$SECTION_LIB_DIR/check-action-status.cjs")"

record() { echo "$1 | $2 | $3" | tee -a "$RESULTS"; }
# Usage: assert_log <id> <label> <expected exit or -> <description> <pattern>... ; a pattern
# starting with ! must NOT be in the log
assert_log() {
  local id="$1" label="$2" want="$3" desc="$4" problems="" pat code
  shift 4
  code=$(tail -1 "$LOGS/$label.code" 2>/dev/null || echo "?")
  if [ "$want" != "-" ] && [ "$code" != "$want" ]; then
    problems+=" exit=$code (expected $want);"
  fi
  for pat in "$@"; do
    if [ "${pat:0:1}" = "!" ]; then
      grep -aqE -- "${pat:1}" "$LOGS/$label.log" && problems+=" unexpected [${pat:1}];"
    else
      grep -aqE -- "$pat" "$LOGS/$label.log" || problems+=" missing [$pat];"
    fi
  done
  if [ -z "$problems" ]; then
    record "$id" OK "$label: $desc"
  else
    record "$id" FAIL "$label: $desc:$problems"
  fi
}
# A job of the provider library, its exit code kept next to its log
job() {
  local fn="$1" label
  shift
  case "$fn" in
  p_check) label="$3" ;;
  p_deploy) label="$2" ;;
  p_promote) label="$3" ;;
  esac
  "$fn" "$@"
  echo $? >"$LOGS/$label.code"
}
# An sfdx-hardis command run by a person (no CI), on a branch of the working copy
# Usage: cli <label> <branch to check out> <args...>
cli() {
  local label="$1" branch="$2"
  shift 2
  cd "$WORK" || return 1
  git checkout -q -f "$branch" && git pull -q origin "$branch"
  p_cli "$@" >"$LOGS/$label.log" 2>&1
  echo $? >"$LOGS/$label.code"
}
# action:list --with-status --json, then the expectations of check-action-status.cjs
# Usage: status_check <id> <label> <description> "<list flags>" <expectation>...
status_check() {
  local id="$1" label="$2" desc="$3" flags="$4" out
  shift 4
  cd "$WORK" || return 1
  git checkout -q -f integration && git pull -q origin integration
  # shellcheck disable=SC2086 # the flags are a list on purpose
  p_cli hardis:project:action:list --with-status $flags --json >"$LOGS/$label.json" 2>"$LOGS/$label.err"
  if out=$(node "$CHECKER" "$(cygpath -m "$LOGS/$label.json" 2>/dev/null || echo "$LOGS/$label.json")" "$@" 2>&1); then
    record "$id" OK "$label: $desc"
  else
    record "$id" FAIL "$label: $desc: $(echo "$out" | grep -E '^FAIL' | tr '\n' ';')"
  fi
  echo "$out" >"$LOGS/$label.check"
}
promo_number() { grep -aoE "Promotion Pull Request created: \S+" "$LOGS/$1.log" | grep -oE "[0-9]+$" | tail -1; }
# A story branch, its Pull Request, then its actions file. Prints the Pull Request number.
open_story() {
  local branch="$1" target="$2" resource="$3" title="$4" body="$5" kind="$6" number
  story_branch "$branch" "$target" "$resource" >/dev/null 2>&1 || return 1
  number=$(p_open "$branch" "$target" "$title" "$body") || return 1
  story_actions "$branch" "$number" "$kind" >/dev/null 2>&1 || return 1
  echo "$number"
}

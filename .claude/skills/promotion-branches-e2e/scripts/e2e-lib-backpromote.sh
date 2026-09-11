#!/usr/bin/env bash
# Backpromote (Beta) helpers of runbook section 6bis, shared by the GitHub, GitLab and Azure DevOps
# libraries. Do not source it directly: each provider library defines two hooks, then sources it.
#
#   bp_provider_env <command...>     runs a command with the git provider variables the CLI reads
#                                    outside CI (never CI=true: backpromote is a developer command).
#                                    Only used to complete the Pull Request titles: a backpromote
#                                    needs no git provider.
#   bp_open <branch> <title> <body>  opens a Pull Request into integration, prints its number
#   bp_merge <number>                merges it with a merge commit
#
# Needs WORK, LOGS, DEV, and DEVORG (the developer scratch org) exported.

BP_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BPX="${BPX:-$(cd "$BP_SCRIPTS_DIR/../reference/backpromote" && pwd)}"

# Open a Pull Request into integration and merge it. Usage: bp_open_and_merge <branch> <title> [body]
bp_open_and_merge() {
  local number
  number=$(bp_open "$1" "$2" "${3:-}") || return 1
  bp_merge "$number" >/dev/null || return 1
  echo "$number"
}

# Backpromote from the branch checked out in $WORK. DEVORG is the target unless --target-org is passed.
# Usage: e2e_backpromote <log label> [flags...]
e2e_backpromote() {
  local label="$1" code target=()
  shift
  cd "$WORK" || return 1
  case " $* " in
  *" --target-org "*) ;;
  *) target=(--target-org "${DEVORG:?set DEVORG to the developer scratch org}") ;;
  esac
  bp_provider_env node "$DEV" hardis:work:backpromote "${target[@]}" "$@" >"$LOGS/$label.log" 2>&1
  code=$?
  echo "$label exit=$code log=$LOGS/$label.log"
  return $code
}

# The same with --json: the document goes to $LOGS/<label>.json, stderr to $LOGS/<label>.log
e2e_backpromote_json() {
  local label="$1" code target=()
  shift
  cd "$WORK" || return 1
  case " $* " in
  *" --target-org "*) ;;
  *) target=(--target-org "${DEVORG:?set DEVORG to the developer scratch org}") ;;
  esac
  bp_provider_env node "$DEV" hardis:work:backpromote "${target[@]}" --json "$@" >"$LOGS/$label.json" 2>"$LOGS/$label.log"
  code=$?
  echo "$label exit=$code json=$LOGS/$label.json"
  return $code
}

# Assert a --plan JSON document. Usage: backpromote_check <label> <expectations.json>
backpromote_check() {
  env -u NODE_OPTIONS node "$BP_SCRIPTS_DIR/check-backpromote-plan.cjs" "$LOGS/$1.json" "$2"
}

# Put a developer scratch org back to the base project: the story static resources deleted, the
# Apex classes and the label of the base commit deployed again. A scratch org can then serve the next
# provider's run.
# Usage: backpromote_reset_org <org alias> <base commit>
backpromote_reset_org() {
  local org="$1" base="$2" dir="$LOGS/bp-reset-$1"
  rm -rf "$dir" "$LOGS/bp-reset-base-$1"
  mkdir -p "$dir"
  cat >"$dir/package.xml" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>${API:-67.0}</version>
</Package>
XML
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<Package xmlns="http://soap.sforce.com/2006/04/metadata">'
    echo '    <types>'
    for resource in E2E_S1 E2E_S2 E2E_S3 E2E_S4 E2E_S5 E2E_S6 E2E_S7; do
      echo "        <members>$resource</members>"
    done
    echo '        <name>StaticResource</name>'
    echo '    </types>'
    echo "    <version>${API:-67.0}</version>"
    echo '</Package>'
  } >"$dir/destructiveChanges.xml"
  (cd "$WORK" && env -u NODE_OPTIONS sf project deploy start --manifest "$dir/package.xml" \
    --post-destructive-changes "$dir/destructiveChanges.xml" --target-org "$org" --ignore-warnings --ignore-conflicts --wait 30) \
    >"$LOGS/bp-reset-$org.log" 2>&1
  git -C "$WORK" worktree add -f "$LOGS/bp-reset-base-$1" "$base" >/dev/null 2>&1 || return 1
  (cd "$LOGS/bp-reset-base-$1" && env -u NODE_OPTIONS sf project deploy start --source-dir force-app --target-org "$org" --ignore-conflicts --wait 30) \
    >>"$LOGS/bp-reset-$org.log" 2>&1
  local code=$?
  git -C "$WORK" worktree remove --force "$LOGS/bp-reset-base-$1" >/dev/null 2>&1
  # The org tracking must forget the reset, or the next plan lists the base project as pending
  (cd "$WORK" && env -u NODE_OPTIONS sf project reset tracking --target-org "$org" --no-prompt) >>"$LOGS/bp-reset-$org.log" 2>&1
  echo "reset $org to $base exit=$code log=$LOGS/bp-reset-$org.log"
  return $code
}

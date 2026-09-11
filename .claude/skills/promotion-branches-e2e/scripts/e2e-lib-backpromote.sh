#!/usr/bin/env bash
# Backpromote (Beta) helpers of runbook section 6bis, shared by the GitHub, GitLab and Azure DevOps
# libraries. Do not source it directly: each provider library defines three hooks, then sources it.
#
#   bp_provider_env <command...>     runs a command with the git provider variables the CLI reads
#                                    outside CI (never CI=true: backpromote is a developer command)
#   bp_open <branch> <title> <body>  opens a Pull Request into integration, prints its number
#   bp_merge <number>                merges it with a merge commit
#   dump_pr_comments <out> [prs...]  provider agnostic dump of Pull Requests and their comments
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

# Any command with no git provider credential at all
bp_no_git_env() {
  env -u NODE_OPTIONS -u CI -u GITLAB_CI -u GITHUB_TOKEN -u CI_SFDX_HARDIS_GITHUB_TOKEN -u GITHUB_REPOSITORY \
    -u CI_JOB_TOKEN -u CI_SFDX_HARDIS_GITLAB_TOKEN -u SYSTEM_ACCESSTOKEN -u CI_SFDX_HARDIS_AZURE_TOKEN \
    -u AZURE_DEVOPS_EXT_PAT -u CI_SFDX_HARDIS_BITBUCKET_TOKEN -u BITBUCKET_WORKSPACE "$@"
}

# --json backpromote without git provider credentials: must be refused
e2e_backpromote_nogit_json() {
  local label="$1" code
  shift
  cd "$WORK" || return 1
  bp_no_git_env node "$DEV" hardis:work:backpromote --target-org "${DEVORG:?set DEVORG}" --json "$@" >"$LOGS/$label.json" 2>"$LOGS/$label.log"
  code=$?
  echo "$label exit=$code json=$LOGS/$label.json"
  return $code
}

# Assert a --plan / --prepare-merge JSON document. Usage: backpromote_check <label> <expectations.json>
backpromote_check() {
  env -u NODE_OPTIONS node "$BP_SCRIPTS_DIR/check-backpromote-plan.cjs" "$LOGS/$1.json" "$2"
}

# The history comment bodies of one Pull Request. Usage: backpromote_comment <number>
backpromote_comment() {
  dump_pr_comments "$LOGS/.comments-$1.json" "$1" >/dev/null || return 1
  node -e "
const dump = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
for (const pr of dump.prs || []) for (const c of pr.comments || []) if ((c.body || '').includes('sfdx-hardis backpromote-state')) console.log(c.body);
" "$LOGS/.comments-$1.json"
}

# Consistency of the history comments of these Pull Requests (all of them when none is given)
# Usage: backpromote_comments_check <label> <expectations.json> [numbers...]
backpromote_comments_check() {
  local label="$1" expectations="$2"
  shift 2
  dump_pr_comments "$LOGS/$label.comments.json" "$@" >/dev/null || return 1
  env -u NODE_OPTIONS node "$BP_SCRIPTS_DIR/check-backpromote-comments.cjs" "$LOGS/$label.comments.json" "$expectations"
}

# Put a developer scratch org back to the base project: the story static resources deleted, the
# Apex classes and the label of the base commit deployed again. A scratch org can then serve the next
# provider's run: its history is per repository, and each run uses a new one.
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
    for resource in E2E_S1 E2E_S2 E2E_S3 E2E_S4 E2E_S5 E2E_S6; do
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
  echo "reset $org to $base exit=$code log=$LOGS/bp-reset-$org.log"
  return $code
}

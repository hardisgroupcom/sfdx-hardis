#!/usr/bin/env bash
# Replacement rules end to end test: a scratch org, a throwaway private GitHub repository running the
# sfdx-hardis CI workflows built from the branch under test, and every rule pattern proven in the org.
#
#   bash .claude/skills/replacement-rules-e2e/scripts/rr-e2e.sh            # the whole run
#   STEPS="assert-org local" bash rr-e2e.sh                                # some steps again
#
# Settings (environment, then the .env of the sfdx-hardis working copy):
#   DEVHUB              Dev Hub alias that creates the scratch org (default: DevHub, then E2E_ORG)
#   RR_ORG              alias of the scratch org (default: rr-e2e-int), created when missing
#   SFDX_HARDIS_BRANCH  branch of hardisgroupcom/sfdx-hardis the CI jobs build (default: current branch)
#   REPO                owner/name to create (default: <gh login>/sfdx-hardis-rr-e2e-<n+1>)
#   RUN                 run name (default: rr-e2e-<date>), WORK and LOGS go under the OS temp dir
#
# Steps, in order: org repo issue check deploy assert-org preview local report
# Results: $LOGS/results.tsv (id, OK|FAIL|SKIP, detail) and $LOGS/report.md
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMO_SCRIPTS="$SKILL_DIR/../promotion-branches-e2e/scripts"
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/env-lib.sh"
e2e_load_env DEVHUB E2E_ORG SFDX_HARDIS_BRANCH GH_E2E_OWNER

ROOT="$E2E_ROOT"
DEV_JS="$ROOT/bin/dev.js"
DEVHUB="${DEVHUB:-DevHub}"
RR_ORG="${RR_ORG:-rr-e2e-int}"
RUN="${RUN:-rr-e2e-$(date +%Y%m%d-%H%M)}"
WORK="${WORK:-$E2E_TMP/$RUN}"
LOGS="${LOGS:-$E2E_TMP/$RUN-logs}"
SFDX_HARDIS_BRANCH="${SFDX_HARDIS_BRANCH:-$(git -C "$ROOT" branch --show-current)}"
STEPS="${STEPS:-org repo issue check deploy assert-org preview local report}"
SECRET_VALUE="${SECRET_VALUE:-rr-e2e-secret-$(date +%s)-Zq9}"
mkdir -p "$LOGS"
# shellcheck source=/dev/null
[ -f "$LOGS/run.env" ] && source "$LOGS/run.env"
export LOGS

result() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$LOGS/results.tsv"; echo "[$2] $1 - $3"; }
assert_contains() { if grep -qF -- "$3" "$2"; then result "$1" OK "$4"; else result "$1" FAIL "$4 (missing: $3)"; fi; }
assert_absent() { if grep -qF -- "$3" "$2"; then result "$1" FAIL "$4 (found: $3)"; else result "$1" OK "$4"; fi; }
save() { printf 'export %s=%q\n' "$1" "$2" >>"$LOGS/run.env"; export "$1=$2"; }
step() { case " $STEPS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
sfj() { node "$DEV_JS" "$@" --json 2>/dev/null; }

echo "Run $RUN - work $WORK - logs $LOGS - branch under test $SFDX_HARDIS_BRANCH"

# --------------------------------------------------------------- org: the scratch org of integration
if step org; then
  if ! sf org display -o "$RR_ORG" --json 2>/dev/null | grep -q '"connectedStatus": "Connected"\|"status": "Active"'; then
    sf org logout -o "$RR_ORG" --no-prompt >/dev/null 2>&1
    sf org create scratch --target-dev-hub "$DEVHUB" --alias "$RR_ORG" --edition developer --duration-days 2 --wait 20 --json >"$LOGS/org-create.json" 2>&1 \
      || { result ORG FAIL "scratch org not created, see org-create.json"; exit 1; }
  fi
  # Recent sf CLI versions hide secrets in "sf org display": the auth URL has its own command
  AUTH_URL=$(sf org auth show-sfdx-auth-url -o "$RR_ORG" --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).result.sfdxAuthUrl||'')}catch{}})")
  if [[ "$AUTH_URL" != force://* ]]; then
    AUTH_URL=$(SF_TEMP_SHOW_SECRETS=true sf org display -o "$RR_ORG" --verbose --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).result.sfdxAuthUrl||''))")
  fi
  [[ "$AUTH_URL" == force://* ]] || { result ORG FAIL "no sfdxAuthUrl for $RR_ORG"; exit 1; }
  ORG_API=$(sf org display -o "$RR_ORG" --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).result.apiVersion||'')))")
  save ORG_API "$ORG_API"
  printf '%s' "$AUTH_URL" >"$LOGS/auth-url.txt"
  result ORG OK "scratch org $RR_ORG ready (API $ORG_API)"
fi

# --------------------------------------------------------------- repo: project, workflows, remote, secrets
if step repo; then
  WORK="$WORK" API=67.0 bash "$SKILL_DIR/scripts/rr-build-project.sh" >>"$LOGS/build.log" 2>&1 || { result REPO FAIL "project not built"; exit 1; }
  node "$PROMO_SCRIPTS/ci-workflows-prepare.cjs" --provider github "$ROOT" "$WORK" "$SFDX_HARDIS_BRANCH" >>"$LOGS/build.log" 2>&1 \
    || { result REPO FAIL "workflows not written, see build.log"; exit 1; }
  # The rule secret of integration reaches the sfdx-hardis steps, like a project maps its own secrets
  node -e "
    const fs=require('fs');
    for (const f of ['.github/workflows/check-deploy.yml','.github/workflows/process-deploy.yml']) {
      const p=require('path').join(process.argv[1],f); let s=fs.readFileSync(p,'utf8');
      s=s.replace(/^(\s*)SFDX_AUTH_URL_INTEGRATION:.*$/m, (m,i)=>m+'\n'+i+'RR_E2E_SECRET_INTEGRATION: \${{ secrets.RR_E2E_SECRET_INTEGRATION }}');
      if(!s.includes('RR_E2E_SECRET_INTEGRATION')) { console.error('no SFDX_AUTH_URL_INTEGRATION line in '+f); process.exit(1); }
      fs.writeFileSync(p,s);
    }" "$WORK" || { result REPO FAIL "secret not mapped in the workflows"; exit 1; }
  (cd "$WORK" && git add -A && git commit -q -m "CI workflows of the sfdx-hardis branch $SFDX_HARDIS_BRANCH")
  if [ -z "${REPO:-}" ]; then
    owner="${GH_E2E_OWNER:-$(gh api user --jq .login)}"
    highest=$(gh repo list "$owner" --limit 1000 --json name --jq '[.[].name | capture("^sfdx-hardis-rr-e2e-(?<n>[0-9]+)$").n | tonumber] | max // 0')
    REPO="$owner/sfdx-hardis-rr-e2e-$((${highest:-0} + 1))"
  fi
  save REPO "$REPO"
  (
    cd "$WORK" || exit 1
    gh repo create "$REPO" --private >>"$LOGS/build.log" 2>&1 || exit 1
    gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=false >/dev/null
    git remote add origin "https://github.com/$REPO.git"
    git push -q -u origin main
    for b in integration uat preprod; do git branch "$b" && git push -q origin "$b"; done
    for b in INTEGRATION UAT PREPROD MAIN; do gh secret set "SFDX_AUTH_URL_$b" -R "$REPO" <"$LOGS/auth-url.txt" >/dev/null; done
    printf '%s' "$SECRET_VALUE" | gh secret set RR_E2E_SECRET_INTEGRATION -R "$REPO" >/dev/null
    gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=true -f allowed_actions=all >/dev/null
  ) || { result REPO FAIL "repository $REPO not created"; exit 1; }
  save SECRET_VALUE "$SECRET_VALUE"
  result REPO OK "repository $REPO, branches main integration uat preprod, secrets set"
fi

# --------------------------------------------------------------- issue: an override without commit
if step issue; then
  (
    cd "$WORK" || exit 1
    GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY="$REPO" node "$DEV_JS" hardis:project:replacement:update --agent --layer issue \
      --id e2e-issue --value-for integration=from-issue --json >"$LOGS/issue-update.json" 2>&1
  )
  # The search index of GitHub lags behind a new issue: list the open issues and match the exact title
  issue_number=$(gh issue list -R "$REPO" --state open --limit 100 --json number,title --jq '[.[] | select(.title == "sfdx-hardis Replacement Rules")][0].number // empty')
  if [ -n "$issue_number" ]; then
    gh issue view "$issue_number" -R "$REPO" --json body --jq .body >"$LOGS/issue-body.md"
    assert_contains ISSUE "$LOGS/issue-body.md" "from-issue" "issue #$issue_number holds the override written by the CLI"
    save ISSUE_NUMBER "$issue_number"
  else
    result ISSUE FAIL "no replacement rules issue created (see issue-update.json)"
  fi
  # A rule of the issue can never read a secret
  (cd "$WORK" && GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY="$REPO" node "$DEV_JS" hardis:project:replacement:update --agent --layer issue \
    --id e2e-single --secret SFDX_AUTH_URL_INTEGRATION --json >"$LOGS/issue-secret.json" 2>&1)
  assert_contains ISSUE-NO-SECRET "$LOGS/issue-secret.json" '"status": 1' "a secret in the issue is refused"
fi

# --------------------------------------------------------------- check: Pull Request to integration
if step check; then
  (
    cd "$WORK" || exit 1
    git checkout -q -b feature/rr-e2e main
    sed -i 's#<shortDescription>E2E Single</shortDescription>#<shortDescription>E2E Single label</shortDescription>#' force-app/main/default/labels/CustomLabels.labels-meta.xml
    git commit -q -am "Change a label description" && git push -q -u origin feature/rr-e2e
  )
  printf 'Replacement rules end to end test\n' >"$LOGS/pr-body.md"
  pr=$(gh pr create -R "$REPO" --base integration --head feature/rr-e2e --title "Replacement rules e2e" --body-file "$LOGS/pr-body.md")
  PR_NUMBER="${pr##*/}"
  save PR_NUMBER "$PR_NUMBER"
  head_sha=$(gh pr view "$PR_NUMBER" -R "$REPO" --json headRefOid --jq .headRefOid)
  # shellcheck source=/dev/null
  source "$PROMO_SCRIPTS/ci-provider-github.sh"
  ci_wait_check "$PR_NUMBER" "$head_sha" check
  if [ "$(cat "$LOGS/check.code")" = "0" ]; then result CHECK OK "validation job succeeded"; else result CHECK FAIL "validation job failed, see check.log"; CHECK_FAILED=1; fi
  L="$LOGS/check.log"
  assert_contains CHECK-APPLY "$L" "Applying replacement rules for integration" "rules applied for the target branch of the Pull Request"
  for id in e2e-endpoint e2e-single e2e-secret e2e-issue e2e-apex-host e2e-remove-view-setup builtin-unknown-user-permissions builtin-flow-ends; do
    assert_contains "CHECK-$id" "$L" ": $id" "rule $id applied in the validation"
  done
  assert_contains CHECK-RESTORE "$L" "Restored" "files restored after the validation"
  assert_contains CHECK-MISSING "$L" "RR_E2E_MISSING" "missing secret reported"
  assert_absent CHECK-SECRET-LOG "$L" "$SECRET_VALUE" "secret value not in the job log"
  ci_pr_comments "$PR_NUMBER" check-comments
  C="$LOGS/check-comments.log"
  assert_contains CHECK-COMMENT "$C" "Replacement rules for \`integration\`" "replacement rules section in the validation comment"
  assert_contains CHECK-COMMENT-WARN "$C" "RR_E2E_MISSING" "missing secret warning in the validation comment"
  assert_contains CHECK-COMMENT-REQUIRED "$C" "e2e-required-no-match" "required rule without match warned in the comment"
  assert_contains CHECK-COMMENT-ISSUE "$C" "issue #" "issue origin shown in the comment"
  assert_absent CHECK-SECRET-COMMENT "$C" "$SECRET_VALUE" "secret value not in the Pull Request comments"
fi

# --------------------------------------------------------------- deploy: merge, deployment job
if step deploy && [ -n "${CHECK_FAILED:-}" ]; then
  result DEPLOY SKIP "validation failed: the Pull Request is not merged"
elif step deploy; then
  gh pr merge "$PR_NUMBER" -R "$REPO" --merge >>"$LOGS/build.log" 2>&1
  sleep 10
  merge_sha=$(gh pr view "$PR_NUMBER" -R "$REPO" --json mergeCommit --jq .mergeCommit.oid)
  # shellcheck source=/dev/null
  source "$PROMO_SCRIPTS/ci-provider-github.sh"
  ci_wait_deploy integration "$merge_sha" deploy
  if [ "$(cat "$LOGS/deploy.code")" = "0" ]; then result DEPLOY OK "deployment job succeeded"; else result DEPLOY FAIL "deployment job failed, see deploy.log"; fi
  assert_absent DEPLOY-SECRET-LOG "$LOGS/deploy.log" "$SECRET_VALUE" "secret value not in the deployment log"
  ci_pr_comments "$PR_NUMBER" deploy-comments
  assert_absent DEPLOY-SECRET-COMMENT "$LOGS/deploy-comments.log" "$SECRET_VALUE" "secret value not in the comments after the deployment"
fi

# --------------------------------------------------------------- assert-org: what the org holds now
check_org_values() {
  # viewsetup is kept in the signature but not asserted: a scratch org can keep ViewSetup off (see the local step)
  # shellcheck disable=SC2034
  local prefix="$1" endpoint="$2" single="$3" secret="$4" issue="$5" host="$6" viewsetup="$7"
  sf data query --use-tooling-api -o "$RR_ORG" --json -q "SELECT Name, Value FROM ExternalString WHERE Name LIKE 'E2E_%'" >"$LOGS/$prefix-labels.json" 2>&1
  local labels="$LOGS/$prefix-labels.json"
  for pair in "E2E_Endpoint=$endpoint" "E2E_Single=$single" "E2E_Secret=$secret" "E2E_Issue=$issue" "E2E_Missing_Secret=git-value"; do
    name="${pair%%=*}"; expected="${pair#*=}"
    # sf can print a warning (update available...) before the JSON: parse from the first brace
    got=$(node -e "const t=require('fs').readFileSync(process.argv[1],'utf8');const j=JSON.parse(t.slice(t.indexOf('{')));const r=(j.result.records||[]).find(x=>x.Name===process.argv[2]);process.stdout.write(r?String(r.Value):'<missing>')" "$labels" "$name")
    if [ "$got" = "$expected" ]; then result "$prefix-$name" OK "label $name = expected value"; else result "$prefix-$name" FAIL "label $name: got '$got'"; fi
  done
  sf data query --use-tooling-api -o "$RR_ORG" --json -q "SELECT Body FROM ApexClass WHERE Name = 'E2EEndpoints'" >"$LOGS/$prefix-apex.json" 2>&1
  assert_contains "$prefix-APEX" "$LOGS/$prefix-apex.json" "$host/api" "Apex host replaced by the regex rule"
  assert_contains "$prefix-APEX-2" "$LOGS/$prefix-apex.json" "$host/v2" "every regex match replaced"
  sf data query -o "$RR_ORG" --json -q "SELECT PermissionsApiEnabled, PermissionsViewSetup FROM PermissionSet WHERE Name = 'E2E_Perms'" >"$LOGS/$prefix-perms.json" 2>&1
  assert_contains "$prefix-PERMSET" "$LOGS/$prefix-perms.json" '"PermissionsApiEnabled": true' "Permission Set deployed despite its unknown user permission"
  sf data query --use-tooling-api -o "$RR_ORG" --json -q "SELECT DeveloperName FROM FlowDefinition WHERE DeveloperName = 'E2E_Ends'" >"$LOGS/$prefix-flow.json" 2>&1
  assert_contains "$prefix-FLOW" "$LOGS/$prefix-flow.json" "E2E_Ends" "Flow with Winter '27 End elements deployed at API 67.0"
}

if step assert-org; then
  check_org_values ORG-INT "https://int-branch.e2e.example.com" "single-value" "$SECRET_VALUE" "from-issue" "https://int.e2e.example.com" "false"
fi

# --------------------------------------------------------------- preview: the command the panel runs
if step preview; then
  (cd "$WORK" && git checkout -q integration && git pull -q origin integration)
  (cd "$WORK" && GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY="$REPO" node "$DEV_JS" hardis:project:replacement:preview --agent \
    --target-branch integration --target-org "$RR_ORG" --json >"$LOGS/preview.json" 2>/dev/null)
  assert_contains PREVIEW "$LOGS/preview.json" '"targetBranch": "integration"' "preview of integration"
  assert_contains PREVIEW-RESULTS "$LOGS/preview.json" '"ruleId": "e2e-endpoint"' "preview lists what each rule changes"
  (cd "$WORK" && git status --porcelain >"$LOGS/preview-status.txt")
  if [ -s "$LOGS/preview-status.txt" ]; then result PREVIEW-NO-WRITE FAIL "the preview changed files"; else result PREVIEW-NO-WRITE OK "the preview wrote nothing"; fi
  (cd "$WORK" && GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY="$REPO" node "$DEV_JS" hardis:project:replacement:list --agent --json >"$LOGS/list.json" 2>/dev/null)
  assert_contains LIST "$LOGS/list.json" '"from-issue"' "list shows the issue override"
  assert_absent LIST-SECRET "$LOGS/list.json" "$SECRET_VALUE" "list never holds a secret value"
fi

# --------------------------------------------------------------- local: a developer deployment, default values
if step local; then
  (
    cd "$WORK" || exit 1
    git checkout -q -b feature/local-dev integration
    # CI=true skips the interactive "use this org?" confirmation; the target stays a feature branch,
    # so the rules use their default values (--agent would only validate)
    CI=true GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY="$REPO" node "$DEV_JS" hardis:project:deploy:smart --target-org "$RR_ORG" >"$LOGS/local-deploy.log" 2>&1
  )
  assert_contains LOCAL-APPLY "$LOGS/local-deploy.log" "Applying replacement rules for" "local deployment applies the rules"
  # A Permission Set deployed with ViewSetup can still read false in a scratch org (Salesforce keeps it off
  # even with a plain sf project deploy): the include filter of e2e-remove-view-setup is proven by the logs
  assert_absent LOCAL-VIEWSETUP-FILTER "$LOGS/local-deploy.log" ": e2e-remove-view-setup" "rule limited to integration not applied to a dev org"
  (cd "$WORK" && git status --porcelain >"$LOGS/local-status.txt")
  if [ -s "$LOGS/local-status.txt" ]; then result LOCAL-RESTORE FAIL "files left changed after the local deployment"; else result LOCAL-RESTORE OK "files restored after the local deployment"; fi
  check_org_values ORG-DEV "https://sandbox.e2e.example.com" "single-value" "git-value" "project-value" "https://sandbox.e2e.example.com" "true"
fi

# --------------------------------------------------------------- report
if step report; then
  ok=$(grep -c $'\tOK\t' "$LOGS/results.tsv"); fail=$(grep -c $'\tFAIL\t' "$LOGS/results.tsv")
  {
    echo "# Replacement rules e2e - $RUN"
    echo
    echo "- sfdx-hardis branch: $SFDX_HARDIS_BRANCH ($(git -C "$ROOT" rev-parse --short HEAD))"
    echo "- repository: https://github.com/${REPO:-?} (Pull Request #${PR_NUMBER:-?}, issue #${ISSUE_NUMBER:-?})"
    echo "- scratch org: $RR_ORG (API ${ORG_API:-?}), project sourceApiVersion 67.0"
    echo "- result: $ok OK, $fail FAIL"
    echo
    echo "| Check | Result | Detail |"
    echo "|-------|--------|--------|"
    awk -F'\t' '{gsub(/\|/,"\\|",$3); printf "| %s | %s | %s |\n", $1, $2, $3}' "$LOGS/results.tsv"
  } >"$LOGS/report.md"
  echo "Report: $LOGS/report.md ($ok OK, $fail FAIL)"
fi

#!/usr/bin/env bash
# Agentforce agents end to end test: a throwaway private GitHub repository running the sfdx-hardis CI
# workflows, an agent built in a developer scratch org, retrieved with hardis:org:retrieve:agent, its
# deployment actions written by the cleaning autoAddAgentsDeploymentActions, then two Pull Requests to
# integration: the first one brings the agent (running user created by the check, version published
# and activated by the deployment, nothing published again by a rerun), the second one changes its
# Agent Script (a second version published and activated, the first one deactivated, agent-activate
# finding it already active). Checked in the logs, in the Pull Request comments and in the org.
#
#   bash .claude/skills/e2e/scenarios/agentforce-agents/scripts/ag-e2e.sh            # the whole run
#   RUN=ag-e2e-1 STEPS="check1 deploy1 assert-deploy1" bash .claude/skills/e2e/scenarios/agentforce-agents/scripts/ag-e2e.sh
#
# Steps: org repo pr1 check1 deploy1 assert-deploy1 rerun1 pr2 check2 deploy2 assert-deploy2 report
#
# Settings, from the environment, else the .env of the working copy:
#   AG_DEV_ORG          org the agent is built in, like a developer sandbox (default ag-e2e-dev)
#   AG_INT_ORG          org of the integration branch, without the agent (default ag-e2e-int)
#                       Both are scratch orgs created when missing, or orgs you logged in to
#   AG_SCRATCH_RELEASE  release of the scratch orgs created (preview or previous), when the Dev Hub
#                       is not on API 68.0 yet
#   DEVHUB              Dev Hub that creates them (default DevHub)
#   SFDX_HARDIS_BRANCH  branch the CI jobs build (default: current branch, must be pushed), or - with
#   SFDX_HARDIS_IMAGE   the image the CI jobs run in, ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:beta
#                       for a beta: the jobs run the release the image holds (then the branch defaults to -)
#   SFDX_HARDIS_VERSION with SFDX_HARDIS_IMAGE, the version the jobs must print (npm view sfdx-hardis@beta version)
#   AG_CLI              the sfdx-hardis the run calls on this computer (default: node bin/dev.js of
#                       this working copy; "sf" for the plugin installed with sf plugins install)
#   AG_REPO             owner/name to create (default <gh login>/sfdx-hardis-ag-e2e-<n+1>)
#   RUN                 run name; AG_WORK and AG_LOGS default to <OS temp>/<run> and <run>-logs
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The CI harness of the promotion-branches scenario, shared by every scenario
PROMO_SCRIPTS="$HERE/../../promotion-branches/scripts"
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/env-lib.sh"
e2e_load_env GH_E2E_OWNER DEVHUB SFDX_HARDIS_BRANCH SFDX_HARDIS_IMAGE SFDX_HARDIS_VERSION AG_DEV_ORG AG_INT_ORG AG_SCRATCH_RELEASE AG_CLI AG_REPO
ROOT="$E2E_ROOT"

AGENT="AG_E2E_Agent"
DEV_ORG="${AG_DEV_ORG:-ag-e2e-dev}"
ORG="${AG_INT_ORG:-ag-e2e-int}"
DEVHUB="${DEVHUB:-DevHub}"
CLI="${AG_CLI:-node $ROOT/bin/dev.js}"
RUN="${RUN:-ag-e2e-$(date +%Y%m%d-%H%M)}"
WORK="${AG_WORK:-$E2E_TMP/$RUN}"
LOGS="${AG_LOGS:-$E2E_TMP/$RUN-logs}"
REPO="${AG_REPO:-}"
if [ -n "${SFDX_HARDIS_IMAGE:-}" ]; then
  SFDX_HARDIS_BRANCH="${SFDX_HARDIS_BRANCH:--}"
else
  SFDX_HARDIS_BRANCH="${SFDX_HARDIS_BRANCH:-$(git -C "$ROOT" branch --show-current)}"
fi
export SFDX_HARDIS_IMAGE
STEPS="${STEPS:-org repo pr1 check1 deploy1 assert-deploy1 rerun1 pr2 check2 deploy2 assert-deploy2 report}"
PUBLISH_LABEL="Publish agent $AGENT and activate the new version"
RUNNING_USER_LABEL="Create the running user of agent $AGENT when the org has none"
mkdir -p "$LOGS"
# shellcheck source=/dev/null
[ -f "$LOGS/run.env" ] && source "$LOGS/run.env"
export LOGS REPO

# One row per check: a replayed check replaces the row of the previous attempt
result() {
  if [ -f "$LOGS/results.tsv" ]; then
    awk -F'\t' -v id="$1" '$1 != id' "$LOGS/results.tsv" >"$LOGS/results.tsv.tmp" && mv "$LOGS/results.tsv.tmp" "$LOGS/results.tsv"
  fi
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$LOGS/results.tsv"
  echo "[$2] $1 - $3"
}
assert_contains() { if grep -qF -- "$3" "$2"; then result "$1" OK "$4"; else result "$1" FAIL "$4 (missing: $3)"; fi; }
assert_absent() { if grep -qF -- "$3" "$2"; then result "$1" FAIL "$4 (found: $3)"; else result "$1" OK "$4"; fi; }
assert_matches() { if grep -qE -- "$3" "$2"; then result "$1" OK "$4"; else result "$1" FAIL "$4 (no line matching: $3)"; fi; }
save() {
  printf 'export %s=%q\n' "$1" "$2" >>"$LOGS/run.env"
  export "$1=$2"
}
step() { case " $STEPS " in *" $1 "*) return 0 ;; *) return 1 ;; esac }
# sf can print a warning before its JSON: parse from the first brace
json_field() { node -e "const t=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(t.slice(t.indexOf('{')));const v=($1);process.stdout.write(v===undefined||v===null?'':String(v))}catch(e){}"; }
# A query the sf CLI answers with nothing (busy machine, network) is tried again before it counts
soql() {
  local org="$1" out
  for _ in 1 2 3; do
    out=$(sf data query -o "$org" --json -q "$2" 2>/dev/null)
    if printf '%s' "$out" | grep -q '"status": 0'; then
      printf '%s' "$out"
      return 0
    fi
    sleep 5
  done
  printf '%s' "$out"
}
# A value of the first record, or "<query failed>": a failed query never reads as an empty org
soql_value() { soql "$1" "$2" | json_field "j.status === 0 ? (($3) ?? '') : '<query failed>'"; }
# The number of records, or nothing when the query failed
soql_count() { soql "$1" "$2" | json_field "j.status === 0 ? j.result.totalSize : undefined"; }
# id, org, query, eq|ge, value, message: a query that fails is a FAIL, never a count of 0
assert_count() {
  local n
  n=$(soql_count "$2" "$3")
  if [ -z "$n" ]; then
    result "$1" FAIL "$6 (query failed: $3)"
  elif { [ "$4" = eq ] && [ "$n" -eq "$5" ]; } || { [ "$4" = ge ] && [ "$n" -ge "$5" ]; }; then
    result "$1" OK "$6 ($n)"
  else
    result "$1" FAIL "$6 (got $n, expected $4 $5)"
  fi
}
# The agent users of an org: "sf org create agent-user" names them <agent>.<unique id>@<org id>.ext,
# with the agent name as last name
AGENT_USERS_QUERY="SELECT COUNT() FROM User WHERE LastName = '$AGENT' AND Username LIKE '%.ext' AND IsActive = true"
VERSIONS_QUERY="SELECT COUNT() FROM BotVersion WHERE BotDefinition.DeveloperName = '$AGENT'"
ACTIVE_VERSION_QUERY="SELECT VersionNumber FROM BotVersion WHERE BotDefinition.DeveloperName = '$AGENT' AND Status = 'Active'"
# A field of the action of the given type in an actions file
action_field() {
  node -e "
    const yaml = require(process.argv[1] + '/node_modules/js-yaml');
    const doc = yaml.load(require('fs').readFileSync(process.argv[2], 'utf8')) || {};
    const all = [...(doc.commandsPreDeploy || []), ...(doc.commandsPostDeploy || [])];
    const action = all.find((a) => a.type === process.argv[3]);
    const value = action ? action[process.argv[4]] : undefined;
    process.stdout.write(value === undefined ? '<none>' : String(value));
  " "$ROOT" "$1" "$2" "$3"
}
expect_field() {
  local value
  value=$(action_field "$2" "$3" "$4")
  if [ "$value" = "$5" ]; then result "$1" OK "$6"; else result "$1" FAIL "$6 ($4 of the $3 action: $value)"; fi
}
# The sfdx-hardis of this computer, in the project, logged in to GitHub like a developer
hardis() { (cd "$WORK" && GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY="$REPO" $CLI "$@"); }
# shellcheck source=/dev/null
source "$PROMO_SCRIPTS/ci-provider-github.sh"

echo "Run $RUN - work $WORK - logs $LOGS - sfdx-hardis ${SFDX_HARDIS_IMAGE:-branch $SFDX_HARDIS_BRANCH} - orgs $DEV_ORG (dev) and $ORG (integration)"

# --------------------------------------------------------------- org: a developer org with the agent, an integration org without it
# Agentforce in a scratch org: the Einstein 1 AI platform and the agent platform settings
write_scratch_def() {
  local release=""
  [ -n "${AG_SCRATCH_RELEASE:-}" ] && release="\"release\":\"$AG_SCRATCH_RELEASE\","
  printf '{"orgName":"sfdx-hardis agents e2e","edition":"Developer",%s"features":["Einstein1AIPlatform"],"settings":{"lightningExperienceSettings":{"enableS1DesktopEnabled":true},"einsteinGptSettings":{"enableEinsteinGptPlatform":true},"agentPlatformSettings":{"enableAgentPlatform":true}}}\n' "$release" >"$1"
}

# alias, label: the org, created as a scratch org when it is not connected; fails below API 68.0
ensure_org() {
  local alias="$1" label="$2" boot="$LOGS/bootstrap-$2"
  if ! sf org display -o "$alias" --json 2>/dev/null | grep -q '"connectedStatus": "Connected"\|"status": "Active"'; then
    sf org logout -o "$alias" --no-prompt >/dev/null 2>&1
    rm -rf "$boot" && mkdir -p "$boot/config"
    printf '{"packageDirectories":[{"path":"force-app","default":true}],"sourceApiVersion":"68.0"}\n' >"$boot/sfdx-project.json"
    write_scratch_def "$boot/config/project-scratch-def.json"
    (cd "$boot" && sf org create scratch --target-dev-hub "$DEVHUB" --alias "$alias" --definition-file config/project-scratch-def.json --duration-days 2 --wait 30 --json >"$LOGS/org-create-$label.json" 2>&1) || {
      result "ORG-$label" FAIL "scratch org $alias not created, see org-create-$label.json"
      return 1
    }
  fi
  local api
  api=$(sf org display -o "$alias" --json 2>/dev/null | json_field "j.result.apiVersion")
  if [ -z "$api" ] || awk -v v="$api" 'BEGIN { exit !(v + 0 < 68) }'; then
    result "ORG-$label" FAIL "$alias is on API ${api:-unknown}, agents need 68.0 (AG_SCRATCH_RELEASE=preview for a scratch org)"
    return 1
  fi
  result "ORG-$label" OK "$alias connected, API $api"
}

# The agent in the developer org, as Agentforce Builder leaves it once a version is committed: its
# running user, its authoring bundle deployed, a version published
write_agent_bundle() {
  local folder="$1/force-app/main/default/aiAuthoringBundles/$AGENT"
  mkdir -p "$folder"
  cat >"$folder/$AGENT.bundle-meta.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <bundleType>AGENT</bundleType>
</AiAuthoringBundle>
XML
  cat >"$folder/$AGENT.agent" <<AGENT_SCRIPT
system:
    instructions: "You answer questions about the sfdx-hardis end to end test. Keep answers short."
    messages:
        welcome: "Hello from the sfdx-hardis agents end to end test, version 1."
        error: "Sorry, something went wrong."

access:
    default_agent_user: "$2"

config:
    developer_name: "$AGENT"
    agent_label: "AG E2E Agent"
    description: "Agent of the sfdx-hardis end to end test"
    agent_type: "AgentforceServiceAgent"

language:
    default_locale: "en_US"
    additional_locales: ""
    all_additional_locales: False

start_agent main:
    label: "Main"
    description: "Answers the questions of the end to end test"

    reasoning:
        instructions: ->
            | Answer the latest request of the user helpfully and concisely.
AGENT_SCRIPT
}

bootstrap_dev_agent() {
  local existing user org_id boot="$LOGS/bootstrap-agent"
  existing=$(soql_count "$DEV_ORG" "SELECT COUNT() FROM BotDefinition WHERE DeveloperName = '$AGENT'")
  [ -n "$existing" ] || return 1
  user=$(soql_value "$DEV_ORG" "SELECT Username FROM User WHERE LastName = '$AGENT' AND Username LIKE '%.ext' AND IsActive = true LIMIT 1" "j.result.records[0]?.Username")
  if [ -z "$user" ]; then
    org_id=$(sf org display -o "$DEV_ORG" --json 2>/dev/null | json_field "j.result.id")
    sf org create agent-user --base-username "ag_e2e_agent@${org_id}.ext" --first-name Agent --last-name "$AGENT" --target-org "$DEV_ORG" --json >"$LOGS/dev-agent-user.json" 2>&1
    user=$(json_field "j.result?.username || j.result?.user?.username || j.result?.Username" <"$LOGS/dev-agent-user.json")
    [ -n "$user" ] || return 1
  fi
  save DEV_AGENT_USER "$user"
  if [ "$existing" = "0" ]; then
    rm -rf "$boot" && mkdir -p "$boot"
    printf '{"packageDirectories":[{"path":"force-app","default":true}],"sourceApiVersion":"68.0"}\n' >"$boot/sfdx-project.json"
    write_agent_bundle "$boot" "$user"
    (cd "$boot" && sf project deploy start -d force-app -o "$DEV_ORG" -w 20 --json >"$LOGS/dev-agent-deploy.json" 2>&1) || return 1
    (cd "$boot" && sf agent publish authoring-bundle --api-name "$AGENT" --target-org "$DEV_ORG" --json >"$LOGS/dev-agent-publish.json" 2>&1) || return 1
  fi
}

if step org; then
  ensure_org "$DEV_ORG" DEV || exit 1
  ensure_org "$ORG" INT || exit 1
  if bootstrap_dev_agent; then
    result ORG-DEV-AGENT OK "agent $AGENT published in $DEV_ORG, running as $DEV_AGENT_USER"
  else
    result ORG-DEV-AGENT FAIL "agent $AGENT not built in $DEV_ORG, see dev-agent-user.json, dev-agent-deploy.json, dev-agent-publish.json"
    exit 1
  fi
  # The integration org must not know the agent: the run proves its first delivery
  assert_count ORG-INT-NO-AGENT "$ORG" "SELECT COUNT() FROM BotDefinition WHERE DeveloperName = '$AGENT'" eq 0 "no agent $AGENT in $ORG yet"
  assert_count ORG-INT-NO-USER "$ORG" "$AGENT_USERS_QUERY" eq 0 "no running user of $AGENT in $ORG yet"
  if grep -q $'^ORG-INT-NO-[A-Z]*\tFAIL' "$LOGS/results.tsv"; then
    echo "Use a new integration org (AG_INT_ORG) or delete the agent and its user from $ORG"
    exit 1
  fi
  AUTH_URL=$(sf org auth show-sfdx-auth-url -o "$ORG" --json 2>/dev/null | json_field "j.result.sfdxAuthUrl")
  [[ "$AUTH_URL" == force://* ]] || {
    result ORG FAIL "no sfdxAuthUrl for $ORG"
    exit 1
  }
  printf '%s' "$AUTH_URL" >"$LOGS/auth-url.txt"
fi

# --------------------------------------------------------------- repo: project, workflows, remote
if step repo; then
  WORK="$WORK" bash "$HERE/ag-build-project.sh" >>"$LOGS/build.log" 2>&1 || {
    result REPO FAIL "project not built"
    exit 1
  }
  node "$PROMO_SCRIPTS/ci-workflows-prepare.cjs" --provider github "$ROOT" "$WORK" "$SFDX_HARDIS_BRANCH" >>"$LOGS/build.log" 2>&1 || {
    result REPO FAIL "workflows not written, see build.log"
    exit 1
  }
  (cd "$WORK" && git add -A && git commit -q -m "CI workflows of sfdx-hardis ${SFDX_HARDIS_IMAGE:-$SFDX_HARDIS_BRANCH}")
  if [ -z "${REPO:-}" ]; then
    owner="${GH_E2E_OWNER:-$(gh api user --jq .login)}"
    highest=$(gh repo list "$owner" --limit 1000 --json name --jq '[.[].name | capture("^sfdx-hardis-ag-e2e-(?<n>[0-9]+)$").n | tonumber] | max // 0')
    REPO="$owner/sfdx-hardis-ag-e2e-$((${highest:-0} + 1))"
  fi
  save REPO "$REPO"
  # The remote of the shared harness: private repository, major branches, logins, Actions on
  (cd "$WORK" && ci_create_remote "$(cat "$LOGS/auth-url.txt")") || {
    result REPO FAIL "repository $REPO not created, see build.log"
    exit 1
  }
  branches=$(gh api "repos/$REPO/branches" --jq '[.[].name] | sort | join(" ")' 2>/dev/null)
  secrets=$(gh secret list -R "$REPO" --json name --jq '[.[].name | select(startswith("SFDX_AUTH_URL_"))] | length' 2>/dev/null)
  actions=$(gh api "repos/$REPO/actions/permissions" --jq .enabled 2>/dev/null)
  if [ "$branches" = "integration main preprod uat" ] && [ "$secrets" = "4" ] && [ "$actions" = "true" ]; then
    result REPO OK "repository $REPO, branches $branches, 4 logins, Actions on"
  else
    result REPO FAIL "repository $REPO incomplete: branches '$branches', logins ${secrets:-?}, Actions ${actions:-?}"
    exit 1
  fi
fi

# --------------------------------------------------------------- the cleaning of hardis:work:save, on a Pull Request
# label, Pull Request number: runs the cleaning twice (the second run adds nothing), checks the actions
run_cleaning() {
  local label="$1" pr="$2" F="$WORK/scripts/actions/.sfdx-hardis.$2.yml"
  hardis hardis:project:clean:agents-deployment-actions --agent --delta-from origin/integration --json >"$LOGS/clean-$label.json" 2>&1
  if grep -q '"status": 0' "$LOGS/clean-$label.json"; then result "CLEAN-$label" OK "the cleaning ran"; else result "CLEAN-$label" FAIL "the cleaning failed, see clean-$label.json"; fi
  if [ ! -f "$F" ]; then
    result "CLEAN-$label-FILE" FAIL "no actions file of Pull Request #$pr"
    return
  fi
  cp "$F" "$LOGS/pr-actions-$label.yml"
  expect_field "CLEAN-$label-PUBLISH" "$F" agent-publish label "$PUBLISH_LABEL" "an agent-publish action for $AGENT"
  expect_field "CLEAN-$label-PUBLISH-CONTEXT" "$F" agent-publish context process-deployment-only "the publication runs in deployments only"
  expect_field "CLEAN-$label-PUBLISH-ONCE" "$F" agent-publish runOnlyOnceByOrg true "the publication runs once by org"
  expect_field "CLEAN-$label-USER" "$F" agent-running-user label "$RUNNING_USER_LABEL" "an agent-running-user action for the service agent"
  expect_field "CLEAN-$label-USER-CONTEXT" "$F" agent-running-user context all "the running user is created in checks too"
  hardis hardis:project:clean:agents-deployment-actions --agent --delta-from origin/integration --json >"$LOGS/clean-$label-again.json" 2>&1
  assert_contains "CLEAN-$label-AGAIN" "$LOGS/clean-$label-again.json" "already there" "a second save adds nothing"
}

# --------------------------------------------------------------- pr1: the agent retrieved from the developer org
if step pr1; then
  (
    cd "$WORK" || exit 1
    git checkout -q integration && git pull -q origin integration
    git checkout -q -b feature/ag-e2e-1
  )
  hardis hardis:org:retrieve:agent --agent --name "$AGENT" --target-org "$DEV_ORG" --json >"$LOGS/retrieve.json" 2>&1
  if grep -q '"status": 0' "$LOGS/retrieve.json"; then result RETRIEVE OK "hardis:org:retrieve:agent --agent"; else result RETRIEVE FAIL "hardis:org:retrieve:agent failed, see retrieve.json"; fi
  SCRIPT_FILE="$WORK/force-app/main/default/aiAuthoringBundles/$AGENT/$AGENT.agent"
  if [ -f "$SCRIPT_FILE" ]; then
    cp "$SCRIPT_FILE" "$LOGS/agent-script-retrieved.agent"
    result RETRIEVE-SCRIPT OK "the Agent Script is in the project"
    assert_contains RETRIEVE-USER "$SCRIPT_FILE" "${DEV_AGENT_USER:-<no dev user>}" "the Agent Script runs as the user of the developer org"
  else
    result RETRIEVE-SCRIPT FAIL "no $AGENT.agent in force-app/main/default/aiAuthoringBundles"
  fi
  versions=$(cd "$WORK" && git ls-files --others --exclude-standard | grep -c -E "aiAgentDefinitionVersions/|aiAgents/")
  if [ "$versions" = "0" ]; then result RETRIEVE-NO-VERSION OK "no version nor definition file left in the project"; else result RETRIEVE-NO-VERSION FAIL "$versions version or definition files left in the project"; fi
  assert_contains RETRIEVE-PACKAGE "$WORK/manifest/package.xml" "<name>AiAuthoringBundle</name>" "the bundle is in manifest/package.xml"
  assert_absent RETRIEVE-PACKAGE-NO-VERSION "$WORK/manifest/package.xml" "AiAgentDefinitionVersion" "no version in manifest/package.xml"
  (cd "$WORK" && git add -A && git commit -q -m "Agent $AGENT" && git push -q -u origin feature/ag-e2e-1)
  printf 'Agentforce agents end to end test: first delivery of the agent\n' >"$LOGS/pr1-body.md"
  pr=$(gh pr create -R "$REPO" --base integration --head feature/ag-e2e-1 --title "Agent $AGENT" --body-file "$LOGS/pr1-body.md")
  save PR1 "${pr##*/}"
  run_cleaning PR1 "$PR1"
  (cd "$WORK" && git add -A && git commit -q -m "Deployment actions of the agent" && git push -q)
fi

# label, Pull Request: the validation job of the head pushed last
wait_check() {
  local head_sha
  head_sha=$(git -C "$WORK" rev-parse HEAD)
  ci_wait_check "$2" "$head_sha" "$1"
  if [ "$(cat "$LOGS/$1.code")" = "0" ]; then result "$1" OK "validation job succeeded"; else
    result "$1" FAIL "validation job failed, see $1.log"
    save "FAILED_$1" 1
  fi
}

# --------------------------------------------------------------- check1: the running user is created, nothing is published
if step check1; then
  wait_check check1 "$PR1"
  L="$LOGS/check1.log"
  if [ -n "${SFDX_HARDIS_IMAGE:-}" ] && [ -n "${SFDX_HARDIS_VERSION:-}" ]; then
    assert_contains CHECK1-VERSION "$L" "$SFDX_HARDIS_VERSION" "the job runs sfdx-hardis $SFDX_HARDIS_VERSION of $SFDX_HARDIS_IMAGE"
  fi
  assert_matches CHECK1-USER-CREATED "$L" "Running user [^ ]+ of agent $AGENT created in the target org" "the check created the running user in integration"
  assert_matches CHECK1-USER-REPLACED "$L" "[0-9]+ running user\(s\) replaced by the user of the target org" "the deployed bundle runs as the user of integration"
  assert_absent CHECK1-NO-PUBLISH "$L" "Publishing agent $AGENT" "a check publishes nothing"
  assert_count CHECK1-ORG-USER "$ORG" "$AGENT_USERS_QUERY" eq 1 "one running user in integration"
  assert_count CHECK1-ORG-NO-AGENT "$ORG" "SELECT COUNT() FROM BotDefinition WHERE DeveloperName = '$AGENT'" eq 0 "a check deploys no agent"
  ci_pr_comments "$PR1" check1-comments
  assert_contains CHECK1-COMMENT "$LOGS/check1-comments.log" "$PUBLISH_LABEL" "the publication is listed in the Pull Request comments"
fi

# label, Pull Request, label of its validation: merge and wait for the deployment job
merge_and_deploy() {
  local failed="FAILED_$3"
  if [ -n "${!failed:-}" ]; then
    result "$1" SKIP "validation failed: the Pull Request is not merged"
    return
  fi
  gh pr merge "$2" -R "$REPO" --merge >>"$LOGS/build.log" 2>&1
  sleep 10
  local merge_sha
  merge_sha=$(ci_merge_sha "$2")
  ci_wait_deploy integration "$merge_sha" "$1"
  if [ "$(cat "$LOGS/$1.code")" = "0" ]; then result "$1" OK "deployment job succeeded"; else result "$1" FAIL "deployment job failed, see $1.log"; fi
}

# label, log: the version the publication created, read from the log
published_version() { sed -n -E "s/.*Agent $AGENT published: version ([0-9]+) created.*/\1/p" "$1" | tail -1; }

# --------------------------------------------------------------- deploy1, assert-deploy1: published and activated
if step deploy1; then
  merge_and_deploy deploy1 "$PR1" check1
fi
if step assert-deploy1; then
  L="$LOGS/deploy1.log"
  assert_matches DEP1-USER-THERE "$L" "Agent $AGENT already has its running user [^ ]+ in the target org" "the deployment found the user the check created"
  V1=$(published_version "$L")
  if [ -n "$V1" ]; then
    save V1 "$V1"
    result DEP1-PUBLISHED OK "version $V1 of $AGENT published in integration"
    assert_contains DEP1-ACTIVATED "$L" "Version $V1 of agent $AGENT is active." "the new version is activated"
  else
    result DEP1-PUBLISHED FAIL "no published version of $AGENT in deploy1.log"
  fi
  assert_count DEP1-ORG-VERSIONS "$ORG" "$VERSIONS_QUERY" eq 1 "one version of $AGENT in integration"
  active=$(soql_value "$ORG" "$ACTIVE_VERSION_QUERY" "j.result.records[0]?.VersionNumber")
  if [ -n "${V1:-}" ] && [ "$active" = "$V1" ]; then result DEP1-ORG-ACTIVE OK "version $V1 is the active one"; else result DEP1-ORG-ACTIVE FAIL "active version: ${active:-none}, published: ${V1:-none}"; fi
  assert_count DEP1-ORG-USER "$ORG" "$AGENT_USERS_QUERY" eq 1 "still one running user"
  ci_pr_comments "$PR1" deploy1-comments
  assert_absent DEP1-COMMENT-FAILED "$LOGS/deploy1-comments.log" "❌" "no failed action in the comments"
fi

# --------------------------------------------------------------- rerun1: a deployment job run again publishes nothing
if step rerun1; then
  ci_rerun rerun1 deploy1
  if [ "$(cat "$LOGS/rerun1.code")" = "0" ]; then result RERUN1 OK "deployment job rerun succeeded"; else result RERUN1 FAIL "deployment job rerun failed, see rerun1.log"; fi
  L="$LOGS/rerun1.log"
  assert_contains RERUN1-PUBLISH-ONCE "$L" "$PUBLISH_LABEL (from PR #$PR1): already run" "the publication is not run twice in an org"
  assert_matches RERUN1-USER-THERE "$L" "Agent $AGENT already has its running user [^ ]+ in the target org" "the running user is found again"
  assert_count RERUN1-ORG-VERSIONS "$ORG" "$VERSIONS_QUERY" eq 1 "no new version"
  assert_count RERUN1-ORG-USER "$ORG" "$AGENT_USERS_QUERY" eq 1 "no new user"
fi

# --------------------------------------------------------------- pr2: a change of the Agent Script, and an agent-activate action
if step pr2; then
  (
    cd "$WORK" || exit 1
    git checkout -q integration && git pull -q origin integration
    git checkout -q -b feature/ag-e2e-2
    sed -i 's/end to end test, version 1\./end to end test, version 2./' "force-app/main/default/aiAuthoringBundles/$AGENT/$AGENT.agent"
  )
  assert_contains PR2-SCRIPT-CHANGED "$WORK/force-app/main/default/aiAuthoringBundles/$AGENT/$AGENT.agent" "version 2." "the welcome message of the Agent Script changed"
  (cd "$WORK" && git commit -q -am "Agent $AGENT: new welcome message" && git push -q -u origin feature/ag-e2e-2)
  printf 'Agentforce agents end to end test: a new version of the agent\n' >"$LOGS/pr2-body.md"
  pr=$(gh pr create -R "$REPO" --base integration --head feature/ag-e2e-2 --title "Agent $AGENT version 2" --body-file "$LOGS/pr2-body.md")
  save PR2 "${pr##*/}"
  run_cleaning PR2 "$PR2"
  hardis hardis:project:action:create --agent --scope pr --pr-id "$PR2" --when post-deploy --type agent-activate --label "AG E2E activate the latest version" --agent-name "$AGENT" --context process-deployment-only --json >"$LOGS/create-activate.json" 2>&1
  if grep -q '"status": 0' "$LOGS/create-activate.json"; then result PR2-CREATE-ACTIVATE OK "action:create --agent agent-activate"; else result PR2-CREATE-ACTIVATE FAIL "action:create agent-activate failed, see create-activate.json"; fi
  assert_absent PR2-NO-VERSION-PARAMETER "$WORK/scripts/actions/.sfdx-hardis.$PR2.yml" "agentVersion" "the activation has no version parameter"
  (cd "$WORK" && git add -A && git commit -q -m "Deployment actions of the agent" && git push -q)
fi

if step check2; then
  wait_check check2 "$PR2"
  L="$LOGS/check2.log"
  assert_matches CHECK2-USER-THERE "$L" "Agent $AGENT already has its running user [^ ]+ in the target org" "the check creates no second user"
  assert_absent CHECK2-NO-PUBLISH "$L" "Publishing agent $AGENT" "a check publishes nothing"
  assert_count CHECK2-ORG-VERSIONS "$ORG" "$VERSIONS_QUERY" eq 1 "still one version after the check"
fi

# --------------------------------------------------------------- deploy2, assert-deploy2: a second version replaces the first one
if step deploy2; then
  merge_and_deploy deploy2 "$PR2" check2
fi
if step assert-deploy2; then
  L="$LOGS/deploy2.log"
  V2=$(published_version "$L")
  if [ -n "$V2" ] && [ -n "${V1:-}" ] && [ "$V2" -gt "$V1" ]; then
    save V2 "$V2"
    result DEP2-PUBLISHED OK "version $V2 of $AGENT published, after version $V1"
    assert_contains DEP2-ACTIVATED "$L" "Version $V2 of agent $AGENT is active." "the new version is activated"
    assert_contains DEP2-ACTIVATE-NOOP "$L" "Version $V2 of agent $AGENT is already active." "agent-activate finds the latest version already active"
  else
    result DEP2-PUBLISHED FAIL "published version '${V2:-none}' after version '${V1:-none}', see deploy2.log"
  fi
  assert_count DEP2-ORG-VERSIONS "$ORG" "$VERSIONS_QUERY" eq 2 "two versions of $AGENT in integration"
  assert_count DEP2-ORG-ONE-ACTIVE "$ORG" "SELECT COUNT() FROM BotVersion WHERE BotDefinition.DeveloperName = '$AGENT' AND Status = 'Active'" eq 1 "one active version"
  active=$(soql_value "$ORG" "$ACTIVE_VERSION_QUERY" "j.result.records[0]?.VersionNumber")
  if [ -n "${V2:-}" ] && [ "$active" = "$V2" ]; then result DEP2-ORG-ACTIVE OK "version $V2 is the active one"; else result DEP2-ORG-ACTIVE FAIL "active version: ${active:-none}, published: ${V2:-none}"; fi
  assert_count DEP2-ORG-USER "$ORG" "$AGENT_USERS_QUERY" eq 1 "still one running user"
  ci_pr_comments "$PR2" deploy2-comments
  assert_absent DEP2-COMMENT-FAILED "$LOGS/deploy2-comments.log" "❌" "no failed action in the comments"
fi

# --------------------------------------------------------------- report
if step report; then
  ok=$(grep -c $'\tOK\t' "$LOGS/results.tsv")
  fail=$(grep -c $'\tFAIL\t' "$LOGS/results.tsv")
  {
    echo "# Agentforce agents e2e - $RUN"
    echo
    if [ -n "${SFDX_HARDIS_IMAGE:-}" ]; then
      echo "- sfdx-hardis: image $SFDX_HARDIS_IMAGE ${SFDX_HARDIS_VERSION:-}"
    else
      echo "- sfdx-hardis branch: $SFDX_HARDIS_BRANCH ($(git -C "$ROOT" rev-parse --short HEAD))"
    fi
    echo "- repository: https://github.com/${REPO:-?} (Pull Requests #${PR1:-?} and #${PR2:-?})"
    echo "- orgs: $DEV_ORG (developer), $ORG (integration)"
    echo "- result: $ok OK, $fail FAIL"
    echo
    echo "| Check | Result | Detail |"
    echo "|-------|--------|--------|"
    awk -F'\t' '{gsub(/\|/,"\\|",$3); printf "| %s | %s | %s |\n", $1, $2, $3}' "$LOGS/results.tsv"
  } >"$LOGS/report.md"
  echo "Report: $LOGS/report.md ($ok OK, $fail FAIL)"
fi

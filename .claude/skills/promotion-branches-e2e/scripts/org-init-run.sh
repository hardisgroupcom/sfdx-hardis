#!/usr/bin/env bash
# Runbook section 6septies on GitHub, GitLab, Azure DevOps or Bitbucket Cloud: the org
# initialization steps (orgInitSteps, hardis:org:init, hardis:config:org-init) and the scratch org
# pool stored in the git provider. Run it after promotion-run.sh, on the same repository: it works
# in a clone of its own ($WORK-oi), on a branch e2e/org-init created from integration, and leaves
# the other sections' working copy untouched.
#
#   export PROVIDER=github|gitlab|azure|bitbucket ORG WORK LOGS DEV API <the provider library variables>
#   export DEVHUB=<a Dev Hub alias or username>   # default ORG: needs 2 free active scratch orgs
#   bash org-init-run.sh
#
#   O0  the steps built from the older keys (hardis:config:org-init --json)
#   O1  the org initialization types are refused as deployment actions
#   O2  a step that cannot run stops scratch:create before any org is requested
#   O3  a scratch org definition the Salesforce CLI schema refuses stops scratch:create the same way
#   O4  scratch:create runs EVERY step type in order (install-packages, deploy-sources,
#       assign-permission-sets, apex, data, command, run-batch, schedule-batch, publish-community and
#       a custom function), skips the disabled and the sandbox-only steps; each one checked in the org
#   O5  hardis:org:init --steps reruns one step on that org
#   O6  a failure allowed goes on, a failure not allowed stops and skips what follows
#   O7  hardis:org:init refuses a production org
#   O8  the scratch org of O4 is deleted
#   O9  the pool is created in the git provider (hardis:scratch:pool:create --agent)
#   O10 the pool is filled: every step with runAtPoolFill runs, the fetch-only step does not
#   O11 a developer takes the org from a fresh clone: the fetch-only step runs there, the source
#       tracking is reset (pull and push previews empty), and a later org change shows in a pull
#   O12 the pool dashboard says the org was taken; the taken org is deleted
#
# Prints one line per assertion and writes $LOGS/results-section6septies.txt.
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${PROVIDER:?set PROVIDER to github, gitlab, azure or bitbucket}"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/env-lib.sh"
e2e_defaults "promo-e2e-$PROVIDER"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/promotion-provider.sh"
DEVHUB="${DEVHUB:-$ORG}"
OI="${OI_WORK:-$WORK-oi}"
OI_DEV="${OI_DEV_WORK:-$WORK-oi-dev}"
OI_LOGS="$LOGS/org-init"
mkdir -p "$OI_LOGS"
RESULTS="$LOGS/results-section6septies.txt"
: >"$RESULTS"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/section-lib.sh"
# A public managed package that installs on a Developer Edition scratch org (installOnScratchOrgs)
OI_PACKAGE_ID="${OI_PACKAGE_ID:-04t0o000003nRWAAA2}"
OI_PACKAGE_NAME="${OI_PACKAGE_NAME:-Files Attachment Notes}"
OI_PACKAGE_NAMESPACE="${OI_PACKAGE_NAMESPACE:-fan_astrea}"
# The pool key: a developer gets it from the password manager, here it is made for the run
SFDX_HARDIS_POOL_ENCRYPTION_KEY="${SFDX_HARDIS_POOL_ENCRYPTION_KEY:-$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")}"
export SFDX_HARDIS_POOL_ENCRYPTION_KEY
# A local run opens the org in the browser: container mode prints the link instead
export SF_CONTAINER_MODE=true

if [ -e "$OI" ] || [ -e "$OI_DEV" ]; then
  echo "ERROR: $OI or $OI_DEV already exists: remove them, a rerun on a previous tree is not a test" >&2
  exit 1
fi

# ------------------------------------------------------------------ helpers
# An sfdx-hardis command run by a person (no CI) in a folder: <label> <folder> <args...>
oi_cli() {
  local label="$1" dir="$2"
  shift 2
  (cd "$dir" && p_cli "$@") >"$LOGS/$label.log" 2>&1
  echo $? >"$LOGS/$label.code"
}
# Number of records of a SOQL query: <org> <query> [tooling]
soql_count() {
  local flags=""
  [ "${3:-}" = "tooling" ] && flags="--use-tooling-api"
  # shellcheck disable=SC2086 # optional flag
  env -u NODE_OPTIONS sf data query --target-org "$1" --query "$2" $flags --json 2>/dev/null |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).result.totalSize)}catch(e){console.log(-1)}})"
}
# <id> <org> <description> <query> <expected count> [tooling]
assert_count() {
  local id="$1" org="$2" desc="$3" query="$4" want="$5" got
  got=$(soql_count "$org" "$query" "${6:-}")
  if [ "$got" = "$want" ]; then
    record "$id" OK "$desc ($query: $got)"
  else
    record "$id" FAIL "$desc ($query: $got, expected $want)"
  fi
}
# Accounts named <name> in <org>
accounts() { soql_count "$1" "SELECT Id FROM Account WHERE Name = '$2'"; }
# The username of the scratch org a scratch:create wrote in the local user config of <folder>
scratch_username_of() {
  grep -h "^scratchOrgUsername:" "$1"/config/user/*.yml 2>/dev/null | tail -1 | sed -E "s/^scratchOrgUsername: *//; s/['\"]//g"
}
active_scratch_orgs() {
  soql_count "$DEVHUB" "SELECT Id FROM ActiveScratchOrg"
}
# Writes the orgInitSteps config of the project: <variant> (all | legacy | broken-step | failures)
write_config() {
  local variant="$1" file="$OI/config/.sfdx-hardis.yml"
  # The base config of the run, minus what this section writes
  git -C "$OI" show "origin/integration:config/.sfdx-hardis.yml" >"$file"
  cat >>"$file" <<YAML
userEmail: promo-e2e@example.com
installedPackages:
  - SubscriberPackageName: $OI_PACKAGE_NAME
    SubscriberPackageNamespace: $OI_PACKAGE_NAMESPACE
    SubscriberPackageVersionId: $OI_PACKAGE_ID
    installOnScratchOrgs: true
    installDuringDeployments: false
customFunctions:
  - id: e2eMarker
    label: E2E marker record
    runtime: node
    script: scripts/functions/e2e-marker.cjs
    inputs:
      - name: accountName
        type: string
        required: true
YAML
  case "$variant" in
  legacy)
    cat >>"$file" <<'YAML'
initPermissionSets:
  - PromoE2EOrgInit
scratchOrgInitApexScripts:
  - scripts/apex/org-init-apex.apex
YAML
    ;;
  broken-step)
    cat >>"$file" <<'YAML'
orgInitSteps:
  - id: missing-apex
    label: An Apex script that does not exist
    type: apex
    parameters:
      apexScript: scripts/apex/does-not-exist.apex
YAML
    ;;
  all | failures)
    cat >>"$file" <<'YAML'
orgInitSteps:
  - id: install-packages
    label: Install packages
    type: install-packages
    orgTypes: [scratch]
  - id: deploy-sources
    label: Deploy project sources
    type: deploy-sources
  - id: assign-permsets
    label: Assign permission sets
    type: assign-permission-sets
    parameters:
      permissionSets: [PromoE2EOrgInit]
  - id: apex-marker
    label: Apex marker record
    type: apex
    parameters:
      apexScript: scripts/apex/org-init-apex.apex
  - id: data-accounts
    label: Load accounts
    type: data
    parameters:
      sfdmuProject: OrgInitAccounts
  - id: command-marker
    label: Command marker record
    type: command
    command: sf data create record --sobject Account --values "Name=OrgInitCommand" --json
  - id: run-batch
    label: Run the marker batch
    type: run-batch
    parameters:
      className: OrgInitBatch
      runMode: wait
  - id: schedule-batch
    label: Schedule the nightly job
    type: schedule-batch
    parameters:
      className: OrgInitSchedulable
      cronExpression: 0 0 3 * * ?
      jobName: OrgInitE2ESchedule
  - id: custom-function
    label: Custom function marker record
    type: e2eMarker
    parameters:
      accountName: OrgInitFunction
  - id: create-site
    label: Create the experience site
    type: command
    command: sf community create --name OrgInitSite --template-name "Build Your Own (LWR)" --url-path-prefix orginit --description "org init e2e" --json
  - id: wait-site
    label: Wait for the experience site
    type: command
    command: node scripts/e2e/wait-site.cjs OrgInitSite
  - id: publish-site
    label: Publish the experience site
    type: publish-community
    parameters:
      communityName: OrgInitSite
  - id: apex-fetch-only
    label: Apex marker run when the org is taken
    type: apex
    runAtPoolFill: false
    parameters:
      apexScript: scripts/apex/org-init-fetch.apex
  - id: apex-disabled
    label: Disabled step
    type: apex
    enabled: false
    parameters:
      apexScript: scripts/apex/org-init-disabled.apex
  - id: apex-sandbox-only
    label: Sandbox only step
    type: apex
    orgTypes: [sandbox]
    parameters:
      apexScript: scripts/apex/org-init-sandbox.apex
YAML
    if [ "$variant" = "failures" ]; then
      cat >>"$file" <<'YAML'
  - id: fail-allowed
    label: A failure that is allowed
    type: command
    command: sf data query --query "SELECT NotAField__z FROM Account" --json
    allowFailure: true
  - id: fail-stop
    label: A failure that stops the run
    type: command
    command: sf data query --query "SELECT NotAField__z FROM Account" --json
  - id: after-stop
    label: A step after the failure
    type: apex
    parameters:
      apexScript: scripts/apex/org-init-after-stop.apex
YAML
    fi
    ;;
  esac
}
apex_marker() {
  echo "insert new Account(Name = '$2');" >"$OI/scripts/apex/$1.apex"
}
apex_class_file() {
  local name="$1" body="$2"
  printf '%s\n' "$body" >"$OI/force-app/main/default/classes/$name.cls"
  cat >"$OI/force-app/main/default/classes/$name.cls-meta.xml" <<META
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>$API</apiVersion>
    <status>Active</status>
</ApexClass>
META
}

# ------------------------------------------------------------------ the project
echo "=== section 6septies: the org initialization project ==="
ORIGIN_URL=$(git -C "$WORK" remote get-url origin)
git clone -q "$ORIGIN_URL" "$OI" || exit 1
cd "$OI" || exit 1
git checkout -q -b e2e/org-init origin/integration
mkdir -p scripts/apex scripts/functions scripts/e2e scripts/data/OrgInitAccounts \
  force-app/main/default/permissionsets force-app/main/default/classes
apex_marker org-init-apex OrgInitApex
apex_marker org-init-fetch OrgInitFetch
apex_marker org-init-disabled OrgInitDisabled
apex_marker org-init-sandbox OrgInitSandboxOnly
apex_marker org-init-after-stop OrgInitAfterStop
apex_class_file OrgInitBatch "public class OrgInitBatch implements Database.Batchable<SObject> {
  public Database.QueryLocator start(Database.BatchableContext context) {
    return Database.getQueryLocator('SELECT Id FROM Organization');
  }
  public void execute(Database.BatchableContext context, List<SObject> scope) {
    insert new Account(Name = 'OrgInitBatch');
  }
  public void finish(Database.BatchableContext context) {
  }
}"
apex_class_file OrgInitSchedulable "public class OrgInitSchedulable implements Schedulable {
  public void execute(SchedulableContext context) {
  }
}"
cat >force-app/main/default/permissionsets/PromoE2EOrgInit.permissionset-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Org initialization end to end test</description>
    <hasActivationRequired>false</hasActivationRequired>
    <label>PromoE2EOrgInit</label>
</PermissionSet>
XML
cat >scripts/data/OrgInitAccounts/export.json <<'JSON'
{
  "objects": [
    { "query": "SELECT Name FROM Account", "operation": "Insert", "externalId": "Name" }
  ]
}
JSON
printf 'Name\nOrgInitData1\nOrgInitData2\n' >scripts/data/OrgInitAccounts/Account.csv
# The custom function: SFDX_HARDIS_ORG_USERNAME is the org being initialized
cat >scripts/functions/e2e-marker.cjs <<'JS'
const { execSync } = require("child_process");
const name = process.env.SFDX_HARDIS_IN_ACCOUNTNAME;
const username = process.env.SFDX_HARDIS_ORG_USERNAME;
if (!name || !username) {
  console.error(`Missing input (${name}) or org (${username})`);
  process.exit(1);
}
execSync(`sf data create record --sobject Account --values "Name=${name}" --target-org ${username} --json`, { stdio: "inherit" });
console.log(JSON.stringify({ accountName: name }));
JS
# The site is created asynchronously: publishing it needs the Network record
cat >scripts/e2e/wait-site.cjs <<'JS'
const { execSync } = require("child_process");
const siteName = process.argv[2];
const deadline = Date.now() + 15 * 60 * 1000;
while (Date.now() < deadline) {
  const out = execSync(`sf data query --query "SELECT Id, Status FROM Network WHERE Name = '${siteName}'" --json`, { encoding: "utf8" });
  const records = JSON.parse(out).result.records || [];
  if (records.length > 0) {
    console.log(`Site ${siteName} exists (${records[0].Status})`);
    // The site keeps building for a short while after its Network record appears
    execSync(process.platform === "win32" ? "ping -n 31 127.0.0.1 >NUL" : "sleep 30");
    process.exit(0);
  }
  execSync(process.platform === "win32" ? "ping -n 16 127.0.0.1 >NUL" : "sleep 15");
}
console.error(`Site ${siteName} not created after 15 minutes`);
process.exit(1);
JS
# Experience Cloud in the scratch orgs, for the publish-community step
cat >config/project-scratch-def.json <<'JSON'
{
  "orgName": "promo e2e org init",
  "edition": "Developer",
  "features": ["EnableSetPasswordInApi", "Communities"],
  "settings": {
    "lightningExperienceSettings": { "enableS1DesktopEnabled": true },
    "communitiesSettings": { "enableNetworksEnabled": true },
    "experienceBundleSettings": { "enableExperienceBundleMetadata": true }
  }
}
JSON
# The pool commands spawn sf: the Dev Hub of the folder is its default one
env -u NODE_OPTIONS sf config set target-dev-hub="$DEVHUB" >/dev/null 2>&1
write_config legacy
git add -A && git commit -qm "chore: org initialization end to end project" && git push -q -u origin e2e/org-init
echo "OI_BRANCH=e2e/org-init" >"$LOGS/oi-vars.sh"

# ------------------------------------------------------------------ O0 legacy keys
echo "=== O0: the steps built from the older keys ==="
(cd "$OI" && p_cli hardis:config:org-init --json) >"$OI_LOGS/config-legacy.json" 2>"$LOGS/oi-config-legacy.err"
if node -e "
const r = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).result;
const ids = r.steps.map((s) => s.id).join(',');
const want = 'legacy-install-packages,legacy-deploy-sources,legacy-permission-sets,legacy-scratch-apex-1';
const errors = [];
if (r.source !== 'legacy') errors.push('source ' + r.source);
if (ids !== want) errors.push('steps ' + ids);
if (!r.steps.every((s) => s.runAtPoolFill === true)) errors.push('runAtPoolFill not true everywhere');
if (r.legacyKeys.join(',') !== 'initPermissionSets,scratchOrgInitApexScripts') errors.push('legacyKeys ' + r.legacyKeys);
if (r.definitionErrors.length) errors.push('definitionErrors ' + JSON.stringify(r.definitionErrors));
if (r.scratchDef.issues.length) errors.push('scratch def issues ' + r.scratchDef.issues);
if (errors.length) { console.log(errors.join('; ')); process.exit(1); }
" "$(e2e_native_path "$OI_LOGS/config-legacy.json")" >"$OI_LOGS/config-legacy.check" 2>&1; then
  record O0 OK "config:org-init builds the four steps of the older keys, all run at pool fill"
else
  record O0 FAIL "config:org-init legacy: $(cat "$OI_LOGS/config-legacy.check")"
fi

# ------------------------------------------------------------------ O1 deployment action guard
echo "=== O1: org init types refused as deployment actions ==="
oi_cli oi-action-create-refused "$OI" hardis:project:action:create --agent --scope project --when post-deploy \
  --type deploy-sources --label "Deploy sources from a deployment action"
assert_log O1 oi-action-create-refused 1 "action:create refuses an org initialization type" \
  "deploy-sources" "!Action created"

# ------------------------------------------------------------------ O2 / O3 checks before any org
echo "=== O2: a step that cannot run stops scratch:create before any org ==="
ACTIVE_BEFORE=$(active_scratch_orgs)
write_config broken-step
oi_cli oi-create-broken-step "$OI" hardis:scratch:create --agent --forcenew --target-dev-hub "$DEVHUB"
assert_log O2 oi-create-broken-step 1 "scratch:create refuses a step that cannot run, before requesting an org" \
  "missing-apex" "does-not-exist.apex" "!sf org create scratch"
echo "=== O3: a scratch org definition the schema refuses ==="
write_config all
cp config/project-scratch-def.json "$OI_LOGS/project-scratch-def.json.bak"
node -e "
const f = 'config/project-scratch-def.json';
const d = JSON.parse(require('fs').readFileSync(f, 'utf8'));
d.hasSampleData = 'yes';
require('fs').writeFileSync(f, JSON.stringify(d, null, 2));
"
oi_cli oi-create-bad-def "$OI" hardis:scratch:create --agent --forcenew --target-dev-hub "$DEVHUB"
assert_log O3 oi-create-bad-def 1 "scratch:create refuses a definition the schema refuses, before requesting an org" \
  "hasSampleData" "!sf org create scratch"
cp "$OI_LOGS/project-scratch-def.json.bak" config/project-scratch-def.json
ACTIVE_AFTER=$(active_scratch_orgs)
if [ "$ACTIVE_BEFORE" = "$ACTIVE_AFTER" ]; then
  record O2-O3 OK "no scratch org was requested by the refused creations ($ACTIVE_AFTER active)"
else
  record O2-O3 FAIL "active scratch orgs went from $ACTIVE_BEFORE to $ACTIVE_AFTER"
fi

# ------------------------------------------------------------------ O4 every step type
echo "=== O4: scratch:create runs every step type ==="
git add -A && git commit -qm "chore: every org initialization step type" && git push -q origin e2e/org-init
oi_cli oi-create-all "$OI" hardis:scratch:create --agent --forcenew --target-dev-hub "$DEVHUB"
SCRATCH1=$(scratch_username_of "$OI")
echo "SCRATCH1=$SCRATCH1" >>"$LOGS/oi-vars.sh"
assert_log O4 oi-create-all 0 "scratch:create initializes the org with every step type, in order" \
  "Step 1/13: Install packages" "Step 2/13: Deploy project sources" "Step 3/13: Assign permission sets" \
  "Step 4/13: Apex marker record" "Step 5/13: Load accounts" "Step 6/13: Command marker record" \
  "Step 7/13: Run the marker batch" "Step 8/13: Schedule the nightly job" \
  "Step 9/13: Custom function marker record" "Step 10/13: Create the experience site" \
  "Step 11/13: Wait for the experience site" "Step 12/13: Publish the experience site" \
  "Step 13/13: Apex marker run when the org is taken" \
  "13 succeeded, 0 failed, 0 skipped" "!Disabled step" "!Sandbox only step"
if [ -n "$SCRATCH1" ]; then
  assert_count O4a "$SCRATCH1" "install-packages: the package is installed" \
    "SELECT Id FROM InstalledSubscriberPackage WHERE SubscriberPackage.NamespacePrefix = '$OI_PACKAGE_NAMESPACE'" 1 tooling
  assert_count O4b "$SCRATCH1" "deploy-sources: the project classes are in the org" \
    "SELECT Id FROM ApexClass WHERE Name IN ('OrgInitBatch', 'OrgInitSchedulable', 'PromoE2EAlphaTest')" 3
  assert_count O4c "$SCRATCH1" "assign-permission-sets: the permission set is assigned" \
    "SELECT Id FROM PermissionSetAssignment WHERE PermissionSet.Name = 'PromoE2EOrgInit'" 1
  assert_count O4d "$SCRATCH1" "apex: the script ran once" "SELECT Id FROM Account WHERE Name = 'OrgInitApex'" 1
  assert_count O4e "$SCRATCH1" "data: the SFDMU workspace was imported" \
    "SELECT Id FROM Account WHERE Name IN ('OrgInitData1', 'OrgInitData2')" 2
  assert_count O4f "$SCRATCH1" "command: the sf command targeted the org without --target-org" \
    "SELECT Id FROM Account WHERE Name = 'OrgInitCommand'" 1
  assert_count O4g "$SCRATCH1" "run-batch: the batch ran" "SELECT Id FROM Account WHERE Name = 'OrgInitBatch'" 1
  assert_count O4h "$SCRATCH1" "schedule-batch: the job is scheduled" \
    "SELECT Id FROM CronTrigger WHERE CronJobDetail.Name = 'OrgInitE2ESchedule'" 1
  assert_count O4i "$SCRATCH1" "custom function: the script ran with its input and the org" \
    "SELECT Id FROM Account WHERE Name = 'OrgInitFunction'" 1
  assert_count O4j "$SCRATCH1" "publish-community: the site exists" "SELECT Id FROM Network WHERE Name = 'OrgInitSite'" 1
  assert_count O4k "$SCRATCH1" "the fetch-only step runs on a new scratch org too (phase all)" \
    "SELECT Id FROM Account WHERE Name = 'OrgInitFetch'" 1
  assert_count O4l "$SCRATCH1" "the disabled and the sandbox-only steps did not run" \
    "SELECT Id FROM Account WHERE Name IN ('OrgInitDisabled', 'OrgInitSandboxOnly')" 0
else
  record O4a FAIL "no scratch org username in config/user: the org checks of O4 did not run"
fi

# ------------------------------------------------------------------ O5 / O6 / O7 hardis:org:init
echo "=== O5: hardis:org:init reruns one step ==="
oi_cli oi-init-one "$OI" hardis:org:init --agent --target-org "$SCRATCH1" --steps apex-marker
assert_log O5 oi-init-one 0 "org:init --steps runs only the step asked for" \
  "Step 1/1: Apex marker record" "1 succeeded, 0 failed, 0 skipped" "!Load accounts"
assert_count O5a "$SCRATCH1" "the Apex marker ran a second time" "SELECT Id FROM Account WHERE Name = 'OrgInitApex'" 2
echo "=== O6: failures, allowed and not ==="
write_config failures
oi_cli oi-init-failures "$OI" hardis:org:init --agent --target-org "$SCRATCH1" --steps fail-allowed,fail-stop,after-stop
assert_log O6 oi-init-failures 1 "an allowed failure goes on, a failure stops and skips the next steps" \
  "A failure that is allowed failed and allows failure" "the remaining steps are not run" \
  "Not run: step A failure that stops the run failed before it"
assert_count O6a "$SCRATCH1" "the step after the failure did not run" "SELECT Id FROM Account WHERE Name = 'OrgInitAfterStop'" 0
git checkout -q -- config/.sfdx-hardis.yml
echo "=== O7: production refused ==="
oi_cli oi-init-production "$OI" hardis:org:init --agent --target-org "$ORG"
assert_log O7 oi-init-production 1 "org:init refuses a production org" "is a production org" "!Step 1/"

# ------------------------------------------------------------------ O8 free the slot
echo "=== O8: delete the scratch org of O4 ==="
if [ -n "$SCRATCH1" ] && env -u NODE_OPTIONS sf org delete scratch --target-org "$SCRATCH1" --no-prompt --json >"$OI_LOGS/delete-scratch1.json" 2>&1; then
  record O8 OK "scratch org of O4 deleted"
else
  record O8 FAIL "scratch org of O4 not deleted: $(head -c 300 "$OI_LOGS/delete-scratch1.json" 2>/dev/null)"
fi

# ------------------------------------------------------------------ O9 / O10 the pool
echo "=== O9: the pool in the git provider ==="
oi_cli oi-pool-create "$OI" hardis:scratch:pool:create --agent --storage-service gitProvider --max-scratch-orgs 1
assert_log O9 oi-pool-create 0 "pool:create creates the dashboard in the git provider" "!rror"
git add -A && git commit -qm "chore: scratch org pool" && git push -q origin e2e/org-init
echo "=== O10: the pool is filled ==="
oi_cli oi-pool-refresh "$OI" hardis:scratch:pool:refresh
assert_log O10 oi-pool-refresh 0 "pool:refresh creates the scratch org of the pool" "exited with code 0" "!exited with code 1"
(cd "$OI" && p_cli hardis:scratch:pool:view --json) >"$OI_LOGS/pool-view-filled.json" 2>"$LOGS/oi-pool-view.err"
POOL_ORG=$(node -e "
const r = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).result;
const orgs = (r.pool && r.pool.orgs) || [];
console.log(orgs.length === 1 ? (orgs[0].username || '') : '');
" "$(e2e_native_path "$OI_LOGS/pool-view-filled.json")" 2>/dev/null)
echo "POOL_ORG=$POOL_ORG" >>"$LOGS/oi-vars.sh"
if [ -n "$POOL_ORG" ]; then
  record O10a OK "the pool holds one scratch org ($POOL_ORG)"
  assert_count O10b "$POOL_ORG" "the steps ran at pool fill (Apex, data, command, batch, function)" \
    "SELECT Id FROM Account WHERE Name IN ('OrgInitApex', 'OrgInitData1', 'OrgInitData2', 'OrgInitCommand', 'OrgInitBatch', 'OrgInitFunction')" 6
  assert_count O10c "$POOL_ORG" "the permission set was assigned at pool fill" \
    "SELECT Id FROM PermissionSetAssignment WHERE PermissionSet.Name = 'PromoE2EOrgInit'" 1
  assert_count O10d "$POOL_ORG" "the fetch-only step did not run at pool fill" "SELECT Id FROM Account WHERE Name = 'OrgInitFetch'" 0
  assert_count O10e "$POOL_ORG" "the site was created at pool fill" "SELECT Id FROM Network WHERE Name = 'OrgInitSite'" 1
else
  record O10a FAIL "the pool does not hold exactly one scratch org: see $OI_LOGS/pool-view-filled.json"
fi

# ------------------------------------------------------------------ O11 a developer takes the org
echo "=== O11: a developer takes the org from a fresh clone ==="
git clone -q "$ORIGIN_URL" "$OI_DEV" && git -C "$OI_DEV" checkout -q e2e/org-init
(cd "$OI_DEV" && env -u NODE_OPTIONS sf config set target-dev-hub="$DEVHUB" >/dev/null 2>&1)
oi_cli oi-pool-fetch "$OI_DEV" hardis:scratch:create --agent --target-dev-hub "$DEVHUB"
FETCHED=$(scratch_username_of "$OI_DEV")
echo "FETCHED=$FETCHED" >>"$LOGS/oi-vars.sh"
assert_log O11 oi-pool-fetch 0 "scratch:create takes the org from the pool, runs the fetch-only step and resets the tracking" \
  "from pool" "Step 1/1: Apex marker run when the org is taken" "Resetting the source tracking" "!sf org create scratch"
if [ -n "$FETCHED" ]; then
  [ "$FETCHED" = "$POOL_ORG" ] && record O11a OK "the org taken is the one of the pool" ||
    record O11a FAIL "the org taken ($FETCHED) is not the one of the pool ($POOL_ORG)"
  assert_count O11b "$FETCHED" "the fetch-only step ran when the org was taken" "SELECT Id FROM Account WHERE Name = 'OrgInitFetch'" 1
  (cd "$OI_DEV" && env -u NODE_OPTIONS sf project retrieve preview --target-org "$FETCHED" --json) >"$OI_LOGS/retrieve-preview.json" 2>/dev/null
  (cd "$OI_DEV" && env -u NODE_OPTIONS sf project deploy preview --target-org "$FETCHED" --json) >"$OI_LOGS/deploy-preview.json" 2>/dev/null
  PREVIEWS=$(node -e "
const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).result;
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).result;
console.log((r.toRetrieve || []).length + ',' + (r.conflicts || []).length + ',' + (d.toDeploy || []).length);
" "$(e2e_native_path "$OI_LOGS/retrieve-preview.json")" "$(e2e_native_path "$OI_LOGS/deploy-preview.json")" 2>/dev/null)
  [ "$PREVIEWS" = "0,0,0" ] && record O11c OK "pull and push previews are empty after the reset" ||
    record O11c FAIL "previews (to retrieve, conflicts, to deploy) = $PREVIEWS, expected 0,0,0"
  # A change made in the org afterwards: deployed from the other clone, which tracks nothing there
  sed -i 's#<value>base</value>#<value>changed in the org</value>#' "$OI/force-app/main/default/labels/CustomLabels.labels-meta.xml"
  (cd "$OI" && env -u NODE_OPTIONS sf project deploy start --metadata CustomLabels --target-org "$FETCHED" --ignore-conflicts --json) >"$OI_LOGS/org-change.json" 2>&1
  git -C "$OI" checkout -q -- force-app/main/default/labels/CustomLabels.labels-meta.xml
  (cd "$OI_DEV" && env -u NODE_OPTIONS sf project retrieve preview --target-org "$FETCHED" --json) >"$OI_LOGS/retrieve-preview-after.json" 2>/dev/null
  if node -e "
const r = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).result;
process.exit((r.toRetrieve || []).some((c) => c.fullName === 'PromoE2EShared') ? 0 : 1);
" "$(e2e_native_path "$OI_LOGS/retrieve-preview-after.json")"; then
    record O11d OK "a change made in the org after it was taken shows in the pull preview"
  else
    record O11d FAIL "the org change is missing from the pull preview: see $OI_LOGS/retrieve-preview-after.json"
  fi
else
  record O11a FAIL "no scratch org username in the developer clone: the fetch checks did not run"
fi

# ------------------------------------------------------------------ O12 the dashboard, cleanup
echo "=== O12: the pool after the org was taken ==="
(cd "$OI" && p_cli hardis:scratch:pool:view --json) >"$OI_LOGS/pool-view-taken.json" 2>/dev/null
if node -e "
const r = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).result.pool;
process.exit((r.orgs || []).length === 0 && (r.history || []).length >= 1 ? 0 : 1);
" "$(e2e_native_path "$OI_LOGS/pool-view-taken.json")"; then
  record O12 OK "the pool is empty and its history holds the org taken"
else
  record O12 FAIL "unexpected pool after the fetch: see $OI_LOGS/pool-view-taken.json"
fi
for org in "$FETCHED" "$POOL_ORG"; do
  [ -n "$org" ] && env -u NODE_OPTIONS sf org delete scratch --target-org "$org" --no-prompt --json >/dev/null 2>&1
done

echo
echo "=== section 6septies summary ==="
echo "$(grep -c '| OK |' "$RESULTS") OK"
echo "$(grep -c '| FAIL |' "$RESULTS") FAIL"
grep "| FAIL |" "$RESULTS" || true
echo "SECTION 6SEPTIES DONE"

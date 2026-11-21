#!/usr/bin/env bash
# Writes the sample project of the deploy-cancel end to end test in a new folder $WORK, a git
# repository with one branch, main:
#
#   - DC_TEST_CLASSES Apex test classes of DC_TEST_METHODS methods each, every method burning about
#     7 seconds of CPU. Salesforce runs the tests of a deployment one after the other: with the
#     default 8 x 8, a deployment simulation of the project lasts about 7 minutes, long enough to be
#     cancelled while it runs
#   - testLevel RunLocalTests, no delta: every simulation and deployment runs all those tests
#   - a pre-deployment and a post-deployment command printing a marker, runOnlyOnceByOrg false, so
#     every deployment prints them
#   - the branch files of integration -> uat -> main
#
#   WORK=<new folder> API=67.0 bash dc-build-project.sh
#
# The stories (one small Apex class each) are added by dc-e2e.sh, on branches of integration.
set -euo pipefail

: "${WORK:?set WORK to a new folder}"
API="${API:-67.0}"
DC_TEST_CLASSES="${DC_TEST_CLASSES:-8}"
DC_TEST_METHODS="${DC_TEST_METHODS:-8}"
if [ -e "$WORK" ]; then
  echo "ERROR: $WORK already exists" >&2
  exit 1
fi
mkdir -p "$WORK"
cd "$WORK"
git init -q -b main
# LF in the clone whatever the git settings of the computer: the run edits files with sed
git config core.autocrlf false

mkdir -p config/branches manifest force-app/main/default/classes force-app/main/default/labels

cat >sfdx-project.json <<JSON
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "name": "sfdx-hardis-dc-e2e",
  "namespace": "",
  "sfdcLoginUrl": "https://login.salesforce.com",
  "sourceApiVersion": "$API"
}
JSON

cat >.forceignore <<'TXT'
**/jsconfig.json
**/.eslintrc.json
TXT

cat >.gitignore <<'TXT'
.sf/
.sfdx/
.cache/
hardis-report/
config/user/
node_modules/
TXT

# No Renovate onboarding Pull Request: its check job would start a simulation in the same org
cat >renovate.json <<'JSON'
{
  "enabled": false
}
JSON

cat >force-app/main/default/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>DC_Label</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>DC Label</shortDescription>
        <value>deploy cancel</value>
    </labels>
</CustomLabels>
XML

# The slow tests: each method burns about 7 seconds of CPU (the limit of a test is 10)
for c in $(seq 1 "$DC_TEST_CLASSES"); do
  {
    echo "@IsTest"
    echo "private class DCSlowTest$c {"
    echo "    // Burns about 7 seconds of CPU: the deployment simulation lasts long enough to be cancelled"
    echo "    private static void burn() {"
    echo "        Long x = 0;"
    echo "        while (Limits.getCpuTime() < 7000) {"
    echo "            for (Integer i = 0; i < 1000; i++) {"
    echo "                x += Math.mod(i * 7 + x, 1000003);"
    echo "            }"
    echo "        }"
    echo "        System.assert(x >= 0, 'never negative');"
    echo "    }"
    for m in $(seq 1 "$DC_TEST_METHODS"); do
      echo "    @IsTest"
      echo "    static void slow$m() {"
      echo "        burn();"
      echo "    }"
    done
    echo "}"
  } >"force-app/main/default/classes/DCSlowTest$c.cls"
  cat >"force-app/main/default/classes/DCSlowTest$c.cls-meta.xml" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>$API</apiVersion>
    <status>Active</status>
</ApexClass>
XML
done

cat >manifest/package.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>*</members>
        <name>ApexClass</name>
    </types>
    <types>
        <members>*</members>
        <name>CustomLabel</name>
    </types>
    <version>$API</version>
</Package>
XML
cat >manifest/destructiveChanges.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>$API</version>
</Package>
XML

# The markers are built at run time (DC_PRE""_DEPLOY_MARKER prints DC_PRE_DEPLOY_MARKER): the text of
# the command, if a log ever shows it, never matches the assertion. runOnlyOnceByOrg false: they run
# at every simulation and deployment
cat >config/.sfdx-hardis.yml <<'YAML'
projectName: sfdx-hardis-dc-e2e
developmentBranch: integration
testLevel: RunLocalTests
useDeltaDeployment: false
commandsPreDeploy:
  - id: dc-pre-deploy-marker
    label: DC pre-deploy marker
    type: command
    command: echo DC_PRE""_DEPLOY_MARKER
    context: all
    runOnlyOnceByOrg: false
commandsPostDeploy:
  - id: dc-post-deploy-marker
    label: DC post-deploy marker
    type: command
    command: echo DC_POST""_DEPLOY_MARKER
    context: all
    runOnlyOnceByOrg: false
YAML

printf 'mergeTargets:\n  - uat\n' >config/branches/.sfdx-hardis.integration.yml
printf 'mergeTargets:\n  - main\n' >config/branches/.sfdx-hardis.uat.yml
printf 'mergeTargets: []\n' >config/branches/.sfdx-hardis.main.yml

git add -A
git commit -q -m "Sample project of the deploy-cancel end to end test"
echo "Project written in $WORK ($DC_TEST_CLASSES test classes of $DC_TEST_METHODS slow methods)"

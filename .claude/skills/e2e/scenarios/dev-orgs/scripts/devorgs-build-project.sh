#!/usr/bin/env bash
# Writes the sample project of the development orgs list end to end test in a new folder $WORK, a
# git repository with main only: one custom label, the branch files of integration -> uat -> main,
# integration and uat offered as target branches (a backpromote takes its parent branch among
# them), delta deployments on. The User Story branches are made during the run by hardis:work:new.
#
#   WORK=<new folder> API=67.0 bash devorgs-build-project.sh
#
# The CI files and the remote are added by devorgs-e2e.sh.
set -euo pipefail

: "${WORK:?set WORK to a new folder}"
API="${API:-67.0}"
if [ -e "$WORK" ]; then
  echo "ERROR: $WORK already exists" >&2
  exit 1
fi
mkdir -p "$WORK"
cd "$WORK"
git init -q -b main
# LF in the clone whatever the git settings of the computer: the run edits files with sed
git config core.autocrlf false

mkdir -p config/branches manifest force-app/main/default/labels

cat >sfdx-project.json <<JSON
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "name": "sfdx-hardis-devorgs-e2e",
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
hardis-report/
config/user/
node_modules/
TXT

cat >force-app/main/default/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>DEVORGS_Label</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>DEVORGS Label</shortDescription>
        <value>base</value>
    </labels>
</CustomLabels>
XML

cat >manifest/package.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
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

cat >config/.sfdx-hardis.yml <<'YAML'
projectName: sfdx-hardis-devorgs-e2e
developmentBranch: integration
availableTargetBranches:
  - integration
  - uat
testLevel: NoTestRun
useDeltaDeployment: true
YAML

printf 'mergeTargets:\n  - uat\n' >config/branches/.sfdx-hardis.integration.yml
printf 'mergeTargets:\n  - main\n' >config/branches/.sfdx-hardis.uat.yml
printf 'mergeTargets: []\n' >config/branches/.sfdx-hardis.main.yml

git add -A
git commit -q -m "Sample project of the development orgs list end to end test"
echo "Project written in $WORK (main)"

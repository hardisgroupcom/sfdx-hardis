#!/usr/bin/env bash
# Sample project of the Agentforce agents end to end test, written in a new folder $WORK: API 68.0, a
# custom label so the first deployment has something besides the agent, the cleaning
# autoAddAgentsDeploymentActions in autoCleanTypes, and the four major branches. No agent: the first
# Pull Request brings it with hardis:org:retrieve:agent, as a developer would.
#
#   WORK=<new folder> bash ag-build-project.sh
set -euo pipefail

: "${WORK:?set WORK to a new folder}"
API="${API:-68.0}"
if [ -e "$WORK" ]; then
  echo "ERROR: $WORK already exists" >&2
  exit 1
fi
mkdir -p "$WORK"
cd "$WORK"
git init -q -b main

mkdir -p config/branches manifest force-app/main/default/labels

cat >sfdx-project.json <<JSON
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "name": "sfdx-hardis-ag-e2e",
  "namespace": "",
  "sfdcLoginUrl": "https://login.salesforce.com",
  "sourceApiVersion": "$API"
}
JSON

printf '**/jsconfig.json\n**/.eslintrc.json\n' >.forceignore
printf '.sf/\n.sfdx/\nhardis-report/\nconfig/user/\nnode_modules/\n' >.gitignore

cat >force-app/main/default/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>AG_E2E_Label</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>AG E2E Label</shortDescription>
        <value>version 1</value>
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

cat >config/.sfdx-hardis.yml <<'YAML'
projectName: sfdx-hardis-ag-e2e
developmentBranch: integration
useDeltaDeployment: false
testLevel: NoTestRun
autoCleanTypes:
  - autoAddAgentsDeploymentActions
YAML

printf 'mergeTargets:\n  - uat\n' >config/branches/.sfdx-hardis.integration.yml
printf 'mergeTargets:\n  - preprod\n' >config/branches/.sfdx-hardis.uat.yml
printf 'mergeTargets:\n  - main\n' >config/branches/.sfdx-hardis.preprod.yml
printf 'mergeTargets: []\n' >config/branches/.sfdx-hardis.main.yml

git add -A
git commit -q -m "Sample project of the Agentforce agents end to end test"
echo "Project written in $WORK"

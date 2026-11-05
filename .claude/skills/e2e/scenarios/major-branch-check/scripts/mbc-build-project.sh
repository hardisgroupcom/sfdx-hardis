#!/usr/bin/env bash
# Writes the sample project of the major branch deployment check end to end test in a new folder
# $WORK, a git repository with two branches:
#
#   main               the base project: one custom label, the three major branch files
#                      (integration -> uat -> main), the check on, delta deployments on (also
#                      between major branches), a pre-deployment command printing a marker
#   feature/mbc-drift  from main: the Apex class MBCDrift, which reads Account.MBC_Drift__c, added
#                      to manifest/package.xml. The run merges it into integration only, so
#                      integration holds the class and uat / main do not
#
# Account.MBC_Drift__c is in no branch, on purpose: mbc-e2e.sh creates it in the org directly. A
# deleted custom field is renamed MBC_Drift_del__c, so a full deployment carrying the field would
# create it again and the check of integration would pass. Kept out of git, once deleted from the
# org it exists nowhere, and the class cannot compile.
#
#   WORK=<new folder> API=67.0 bash mbc-build-project.sh
#
# The script ends with main checked out: the CI files and the remote are added by mbc-e2e.sh.
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
  "name": "sfdx-hardis-mbc-e2e",
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

# ------------------------------------------------------------------ base metadata (every branch)
cat >force-app/main/default/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>MBC_Label</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>MBC Label</shortDescription>
        <value>major branch check</value>
    </labels>
</CustomLabels>
XML

write_package_xml() {
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<Package xmlns="http://soap.sforce.com/2006/04/metadata">'
    printf '%s' "$1"
    echo '    <types>'
    echo '        <members>*</members>'
    echo '        <name>CustomLabel</name>'
    echo '    </types>'
    echo "    <version>$API</version>"
    echo '</Package>'
  } >manifest/package.xml
}
write_package_xml ""
cat >manifest/destructiveChanges.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>$API</version>
</Package>
XML

# ------------------------------------------------------------------ config
# The marker is built at run time (MBC_PRE""_DEPLOY_MARKER prints MBC_PRE_DEPLOY_MARKER): the text
# of the command, if a log ever shows it, never matches the assertion. runOnlyOnceByOrg false: it
# runs at every validation and deployment, so its absence from a check log means it was skipped
cat >config/.sfdx-hardis.yml <<'YAML'
projectName: sfdx-hardis-mbc-e2e
developmentBranch: integration
testLevel: NoTestRun
useDeltaDeployment: true
enableDeltaDeploymentBetweenMajorBranches: true
enableMajorBranchDeploymentCheck: true
majorBranchDeploymentCheckValidityHours: 24
commandsPreDeploy:
  - id: mbc-pre-deploy-marker
    label: MBC pre-deploy marker
    type: command
    command: echo MBC_PRE""_DEPLOY_MARKER
    context: all
    runOnlyOnceByOrg: false
YAML

printf 'mergeTargets:\n  - uat\n' >config/branches/.sfdx-hardis.integration.yml
printf 'mergeTargets:\n  - main\n' >config/branches/.sfdx-hardis.uat.yml
printf 'mergeTargets: []\n' >config/branches/.sfdx-hardis.main.yml

git add -A
git commit -q -m "Sample project of the major branch deployment check end to end test"

# ------------------------------------------------------------------ feature/mbc-drift
git checkout -q -b feature/mbc-drift
mkdir -p force-app/main/default/classes
cat >force-app/main/default/classes/MBCDrift.cls <<'APEX'
public with sharing class MBCDrift {
    // Does not compile in an org without Account.MBC_Drift__c
    public static String readDrift(Id accountId) {
        Account record = [SELECT Id, MBC_Drift__c FROM Account WHERE Id = :accountId];
        return record.MBC_Drift__c;
    }
}
APEX
cat >force-app/main/default/classes/MBCDrift.cls-meta.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>$API</apiVersion>
    <status>Active</status>
</ApexClass>
XML
write_package_xml "$(printf '    <types>\n        <members>MBCDrift</members>\n        <name>ApexClass</name>\n    </types>\n')
"
git add -A
git commit -q -m "feat: MBCDrift, the class reading MBC_Drift__c"
git checkout -q main
echo "Project written in $WORK (main, feature/mbc-drift)"

#!/usr/bin/env bash
# Sample project of the deployment action types end to end test, written in a new folder $WORK:
# an Apex batch (Batchable + Schedulable), a class a pre-deployment action removes from package.xml,
# a custom label the Pull Request changes, the User Access Policy of the org and its permission set,
# an anonymous Apex script, and two project actions written by hand (no runOnlyOnceByOrg key).
#
#   WORK=<new folder> bash da-build-project.sh
set -euo pipefail

: "${WORK:?set WORK to a new folder}"
API="${API:-66.0}"
if [ -e "$WORK" ]; then
  echo "ERROR: $WORK already exists" >&2
  exit 1
fi
mkdir -p "$WORK"
cd "$WORK"
git init -q -b main

mkdir -p config/branches manifest scripts/apex force-app/main/default/{labels,classes,permissionsets,useraccesspolicies}

cat >sfdx-project.json <<JSON
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "name": "sfdx-hardis-da-e2e",
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
        <fullName>DA_E2E_Label</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>DA E2E Label</shortDescription>
        <value>version 1</value>
    </labels>
</CustomLabels>
XML

cat >force-app/main/default/classes/E2EBatch.cls <<'APEX'
public with sharing class E2EBatch implements Database.Batchable<SObject>, Schedulable {
    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator([SELECT Id FROM Account WHERE Name LIKE 'DA_E2E%']);
    }
    public void execute(Database.BatchableContext bc, List<Account> scope) {
        for (Account acc : scope) {
            acc.Description = 'batched-by-da-e2e';
        }
        update scope;
    }
    public void finish(Database.BatchableContext bc) {
    }
    public void execute(SchedulableContext sc) {
        Database.executeBatch(new E2EBatch());
    }
}
APEX
cat >force-app/main/default/classes/E2ESkipped.cls <<'APEX'
public with sharing class E2ESkipped {
    public static String name() {
        return 'removed from package.xml by a pre-deployment action';
    }
}
APEX
for cls in E2EBatch E2ESkipped; do
  cat >"force-app/main/default/classes/$cls.cls-meta.xml" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>$API</apiVersion>
    <status>Active</status>
</ApexClass>
XML
done

cat >force-app/main/default/permissionsets/UAP_Spike_PS.permissionset-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>UAP Spike PS</label>
    <hasActivationRequired>false</hasActivationRequired>
</PermissionSet>
XML

cat >force-app/main/default/useraccesspolicies/UAP_Spike_Policy.useraccesspolicy-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<UserAccessPolicy xmlns="http://soap.sforce.com/2006/04/metadata">
    <booleanFilter>1</booleanFilter>
    <description>Deployment actions e2e policy</description>
    <masterLabel>UAP Spike Policy</masterLabel>
    <order>1</order>
    <status>Active</status>
    <triggerType>CreateAndUpdate</triggerType>
    <userAccessPolicyActions>
        <action>Grant</action>
        <target>UAP_Spike_PS</target>
        <type>PermissionSet</type>
    </userAccessPolicyActions>
    <userAccessPolicyFilters>
        <columnName>IsActive</columnName>
        <operation>equals</operation>
        <sortOrder>1</sortOrder>
        <target>User</target>
        <type>User</type>
        <value>true</value>
    </userAccessPolicyFilters>
</UserAccessPolicy>
XML

cat >scripts/apex/da-e2e-account.apex <<'APEX'
insert new Account(Name = 'DA_E2E_APEX');
APEX

cat >manifest/package.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>E2EBatch</members>
        <members>E2ESkipped</members>
        <name>ApexClass</name>
    </types>
    <types>
        <members>*</members>
        <name>CustomLabel</name>
    </types>
    <types>
        <members>UAP_Spike_PS</members>
        <name>PermissionSet</name>
    </types>
    <types>
        <members>UAP_Spike_Policy</members>
        <name>UserAccessPolicy</name>
    </types>
    <version>$API</version>
</Package>
XML

# Two project actions written by hand, without runOnlyOnceByOrg: the command keeps the default
# (once per org), the User Access Policy action gets the default of its type (every deployment)
cat >config/.sfdx-hardis.yml <<'YAML'
projectName: sfdx-hardis-da-e2e
developmentBranch: integration
useDeltaDeployment: false
testLevel: NoTestRun
commandsPostDeploy:
  - id: da-e2e-project-once
    label: DA E2E project command once
    type: command
    command: echo DA_E2E_PROJECT_ONCE_MARKER
    context: process-deployment-only
  - id: da-e2e-project-uap
    label: DA E2E project policy every time
    type: user-access-policy
    parameters:
      policies:
        - UAP_Spike_Policy
    context: process-deployment-only
YAML

printf 'mergeTargets:\n  - uat\n' >config/branches/.sfdx-hardis.integration.yml
printf 'mergeTargets:\n  - preprod\n' >config/branches/.sfdx-hardis.uat.yml
printf 'mergeTargets:\n  - main\n' >config/branches/.sfdx-hardis.preprod.yml
printf 'mergeTargets: []\n' >config/branches/.sfdx-hardis.main.yml

git add -A
git commit -q -m "Sample project of the deployment action types end to end test"
echo "Project written in $WORK"

#!/usr/bin/env bash
# Writes the sample project of the replacement rules end to end test in a new folder $WORK:
# metadata that each rule pattern changes, the rules in the project file, a branch file override,
# and the four major branch files (the sfdx-hardis CI templates log in to the four).
#
#   WORK=<new folder> API=67.0 bash rr-build-project.sh
#
# API is the sourceApiVersion: below 68.0, the built-in rule builtin-flow-ends must remove the
# Winter '27 <ends> elements of the Flow, or the deployment fails.
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

mkdir -p config/branches manifest force-app/main/default/{labels,classes,permissionsets,flows}

cat >sfdx-project.json <<JSON
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "name": "sfdx-hardis-rr-e2e",
  "namespace": "",
  "sfdcLoginUrl": "https://login.salesforce.com",
  "sourceApiVersion": "$API"
}
JSON

cat >.forceignore <<'TXT'
**/jsconfig.json
**/.eslintrc.json
TXT

# ------------------------------------------------------------------ metadata, with the values of git
cat >force-app/main/default/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>E2E_Endpoint</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>E2E Endpoint</shortDescription>
        <value>https://git.e2e.example.com</value>
    </labels>
    <labels>
        <fullName>E2E_Issue</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>E2E Issue</shortDescription>
        <value>git-value</value>
    </labels>
    <labels>
        <fullName>E2E_Missing_Secret</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>E2E Missing Secret</shortDescription>
        <value>git-value</value>
    </labels>
    <labels>
        <fullName>E2E_Secret</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>E2E Secret</shortDescription>
        <value>git-value</value>
    </labels>
    <labels>
        <fullName>E2E_Single</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>E2E Single</shortDescription>
        <value>git-value</value>
    </labels>
</CustomLabels>
XML

cat >force-app/main/default/classes/E2EEndpoints.cls <<'APEX'
public with sharing class E2EEndpoints {
    public static final String HOST = 'https://dev.e2e.example.com/api';
    public static final String OTHER = 'https://dev.e2e.example.com/v2';
}
APEX
cat >force-app/main/default/classes/E2EEndpoints.cls-meta.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>$API</apiVersion>
    <status>Active</status>
</ApexClass>
XML

# A user permission no org has: without builtin-unknown-user-permissions the deployment fails
cat >force-app/main/default/permissionsets/E2E_Perms.permissionset-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <hasActivationRequired>false</hasActivationRequired>
    <label>E2E Perms</label>
    <userPermissions>
        <enabled>true</enabled>
        <name>ApiEnabled</name>
    </userPermissions>
    <userPermissions>
        <enabled>true</enabled>
        <name>NotARealPermissionE2e</name>
    </userPermissions>
    <userPermissions>
        <enabled>true</enabled>
        <name>ViewSetup</name>
    </userPermissions>
</PermissionSet>
XML

# A Winter '27 Flow: <ends> and a start connector pointing to it. Deployed at API 67.0, the
# built-in rule must remove both
cat >force-app/main/default/flows/E2E_Ends.flow-meta.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>$API</apiVersion>
    <areMetricsLoggedToDataCloud>false</areMetricsLoggedToDataCloud>
    <ends>
        <name>Finish</name>
        <label>Finish</label>
        <locationX>176</locationX>
        <locationY>250</locationY>
    </ends>
    <interviewLabel>E2E Ends {!\$Flow.CurrentDateTime}</interviewLabel>
    <label>E2E Ends</label>
    <processMetadataValues>
        <name>BuilderType</name>
        <value>
            <stringValue>LightningFlowBuilder</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>CanvasMode</name>
        <value>
            <stringValue>AUTO_LAYOUT_CANVAS</stringValue>
        </value>
    </processMetadataValues>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <locationX>50</locationX>
        <locationY>0</locationY>
        <connector>
            <targetReference>Finish</targetReference>
        </connector>
    </start>
    <status>Draft</status>
</Flow>
XML

cat >manifest/package.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>E2EEndpoints</members>
        <name>ApexClass</name>
    </types>
    <types>
        <members>*</members>
        <name>CustomLabel</name>
    </types>
    <types>
        <members>E2E_Ends</members>
        <name>Flow</name>
    </types>
    <types>
        <members>E2E_Perms</members>
        <name>PermissionSet</name>
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

# ------------------------------------------------------------------ rules (one per pattern)
cat >config/.sfdx-hardis.yml <<'YAML'
projectName: sfdx-hardis-rr-e2e
developmentBranch: integration
useDeltaDeployment: false
testLevel: NoTestRun
replacementRules:
  # P1: one value per org, the integration value changed by the branch file
  - id: e2e-endpoint
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=E2E_Endpoint]/value
    values:
      integration: https://int-project.e2e.example.com
      default: https://sandbox.e2e.example.com
    required: true
  # P2: the same value for every org
  - id: e2e-single
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=E2E_Single]/value
    value: single-value
  # P3: a secret read from the CI/CD variable RR_E2E_SECRET_INTEGRATION
  - id: e2e-secret
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=E2E_Secret]/value
    secret: RR_E2E_SECRET
  # P4: a secret no CI variable holds: warning, the value of git is deployed
  - id: e2e-missing-secret
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=E2E_Missing_Secret]/value
    secret: RR_E2E_MISSING
  # P5: changed for integration by the git provider issue, no commit
  - id: e2e-issue
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=E2E_Issue]/value
    values:
      default: project-value
  # P6: regex find and replace in Apex
  - id: e2e-apex-host
    type: text
    files: "**/classes/E2EEndpoints.cls"
    find: 'https://dev\.e2e\.example\.com'
    regex: true
    values:
      integration: https://int.e2e.example.com
      default: https://sandbox.e2e.example.com
  # P7: remove one user permission, for integration only
  - id: e2e-remove-view-setup
    type: xml-remove
    files: "**/permissionsets/*.permissionset-meta.xml"
    xmlPath: PermissionSet/userPermissions[name=ViewSetup]
    includeTargetBranches:
      - integration
  # P8: a rule matching nothing, with required: warning in the Pull Request comment
  - id: e2e-required-no-match
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=Does_Not_Exist]/value
    value: x
    required: true
YAML

# Branch files: integration overrides the value of e2e-endpoint for its org
cat >config/branches/.sfdx-hardis.integration.yml <<'YAML'
mergeTargets:
  - uat
replacementRules:
  - id: e2e-endpoint
    values:
      integration: https://int-branch.e2e.example.com
YAML
printf 'mergeTargets:\n  - preprod\n' >config/branches/.sfdx-hardis.uat.yml
printf 'mergeTargets:\n  - main\n' >config/branches/.sfdx-hardis.preprod.yml
printf 'mergeTargets: []\n' >config/branches/.sfdx-hardis.main.yml

cat >.gitignore <<'TXT'
.sf/
.sfdx/
hardis-report/
config/user/
node_modules/
TXT

git add -A
git commit -q -m "Sample project of the replacement rules end to end test"
echo "Project written in $WORK"

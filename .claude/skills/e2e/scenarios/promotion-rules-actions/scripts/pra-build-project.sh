#!/usr/bin/env bash
# Sample project of the promotion + replacement rules + deployment actions end to end test, written
# in a new folder $WORK: promotion branches on, delta deployments (between major branches too), one
# replacement rule per way a value can depend on the target branch, and the metadata they change.
#
#   WORK=<new folder> API=67.0 [PRA_TEST_LEVEL=RunLocalTests] bash pra-build-project.sh
#
# Values the rules give, per target branch (git holds "git-value", the git endpoint and the dev host):
#
#   rule            integration          uat                       preprod              main
#   pra-endpoint    int                  uat-branch (branch file)  preprod              prod
#   pra-secret      PRA_SECRET_<BRANCH> of the CI variables, one value per branch
#   pra-uat-only    git-value            uat-only                  git-value            git-value
#   pra-not-main    not-main             not-main                  not-main             git-value
#   pra-issue       project-value (s3-value once S3 is merged)  from-issue (issue)  project-value
#   pra-apex-host   int-api              uat-api                   preprod-api          (class removed)
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
# LF in the clone whatever the git settings of the computer: the story edits match lines
git config core.autocrlf false

mkdir -p config/branches manifest scripts/apex scripts/actions force-app/main/default/{labels,classes}

cat >sfdx-project.json <<JSON
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "name": "sfdx-hardis-pra-e2e",
  "namespace": "",
  "sfdcLoginUrl": "https://login.salesforce.com",
  "sourceApiVersion": "$API"
}
JSON

printf '**/jsconfig.json\n**/.eslintrc.json\n' >.forceignore
# config/user: a dirty tree makes promotion:create refuse to run
printf 'config/user/\n.sf/\n.sfdx/\nnode_modules/\nhardis-report/\n' >.gitignore

label() {
  cat <<XML
    <labels>
        <fullName>$1</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>$1</shortDescription>
        <value>$2</value>
    </labels>
XML
}
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">'
  label PRA_Endpoint https://git.pra.example.com
  label PRA_Issue git-value
  label PRA_Not_Main git-value
  label PRA_Secret git-value
  label PRA_Uat_Only git-value
  echo '</CustomLabels>'
} >force-app/main/default/labels/CustomLabels.labels-meta.xml

cat >force-app/main/default/classes/PRAEndpoints.cls <<'APEX'
public with sharing class PRAEndpoints {
    public static final String HOST = 'https://dev.pra.example.com/api';
}
APEX
cat >force-app/main/default/classes/PRAEndpoints.cls-meta.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>$API</apiVersion>
    <status>Active</status>
</ApexClass>
XML

# The post-deployment apex action of S1: what the org holds once the replaced label is deployed
cat >scripts/apex/pra-account.apex <<'APEX'
insert new Account(Name = 'PRA_E2E_APEX', Site = System.Label.PRA_Endpoint);
APEX

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

cat >config/.sfdx-hardis.yml <<'YAML'
projectName: sfdx-hardis-pra-e2e
developmentBranch: integration
useDeltaDeployment: true
enableDeltaDeploymentBetweenMajorBranches: true
testLevel: NoTestRun
enablePromotionBranches: true
allowedPromotionSteps:
  - source: integration
    target: uat
  - source: uat
    target: preprod
  - source: preprod
    target: main
replacementRules:
  # One value per org; uat is changed by the uat branch file
  - id: pra-endpoint
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=PRA_Endpoint]/value
    values:
      integration: https://int.pra.example.com
      uat: https://uat-project.pra.example.com
      preprod: https://preprod.pra.example.com
      main: https://prod.pra.example.com
    required: true
  # A secret: PRA_SECRET_<BRANCH> of the CI variables, one per target branch
  - id: pra-secret
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=PRA_Secret]/value
    secret: PRA_SECRET
  # Only when the target is uat
  - id: pra-uat-only
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=PRA_Uat_Only]/value
    value: uat-only
    includeTargetBranches:
      - uat
  # Every target but main
  - id: pra-not-main
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=PRA_Not_Main]/value
    value: not-main
    excludeTargetBranches:
      - main
  # A default here, the preprod value in the git provider issue
  - id: pra-issue
    type: xml-value
    files: "**/labels/CustomLabels.labels-meta.xml"
    xmlPath: CustomLabels/labels[fullName=PRA_Issue]/value
    values:
      default: project-value
  # Regex find and replace in Apex, one host per org
  - id: pra-apex-host
    type: text
    files: "**/classes/PRAEndpoints.cls"
    find: 'https://dev\.pra\.example\.com'
    regex: true
    values:
      integration: https://int-api.pra.example.com
      uat: https://uat-api.pra.example.com
      preprod: https://preprod-api.pra.example.com
      main: https://prod-api.pra.example.com
YAML

# RunLocalTests makes each validation quick-deployable: the deployment jobs then deploy what the
# validation of the same target validated (PRA_TEST_LEVEL, default NoTestRun: always a full deployment)
sed -i "s/^testLevel: NoTestRun$/testLevel: ${PRA_TEST_LEVEL:-NoTestRun}/" config/.sfdx-hardis.yml

branch_file() {
  local branch="$1" level="$2" target="$3"
  {
    echo "branchName: $branch"
    echo "level: $level"
    if [ "$target" = "-" ]; then echo "mergeTargets: []"; else printf 'mergeTargets:\n  - %s\n' "$target"; fi
  } >"config/branches/.sfdx-hardis.$branch.yml"
}
branch_file integration 10 uat
branch_file uat 20 preprod
branch_file preprod 90 main
branch_file main 100 -
cat >>config/branches/.sfdx-hardis.uat.yml <<'YAML'
replacementRules:
  - id: pra-endpoint
    values:
      uat: https://uat-branch.pra.example.com
YAML

git add -A
git commit -q -m "chore: base project"
echo "Project written in $WORK"

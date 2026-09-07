#!/usr/bin/env bash
# Build the local content of a throwaway promotion-branches end to end repository: the base
# project, the four major branches and the six User Story branches. Provider agnostic: the caller
# creates the remote repository and opens the Pull Requests.
#
#   WORK=/c/tmp/promo-e2e API=67.0 bash build-repo.sh
#
# Idempotent only on a fresh $WORK: it refuses to run on an existing directory, because a rerun on
# a previous tree is exactly the artefact this test must not have.
set -euo pipefail

: "${WORK:?set WORK to the local clone directory}"
API="${API:-67.0}"

if [ -e "$WORK" ]; then
  echo "ERROR: $WORK already exists. Remove it or pick another WORK." >&2
  exit 1
fi

mkdir -p "$WORK"
cd "$WORK"
git init -q -b main

# ------------------------------------------------------------------ base project
cat >sfdx-project.json <<JSON
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "name": "sfdx-hardis-promo-e2e",
  "namespace": "",
  "sfdcLoginUrl": "https://login.salesforce.com",
  "sourceApiVersion": "$API"
}
JSON

mkdir -p config/branches manifest force-app/main/default/classes \
  force-app/main/default/labels force-app/main/default/staticresources scripts/actions

cat >config/.sfdx-hardis.yml <<'YAML'
projectName: sfdx-hardis-promo-e2e
developmentBranch: integration
useDeltaDeployment: true
testLevel: NoTestRun
enablePromotionBranches: true
enableDeploymentApexTestClasses: true
enableDeltaDeploymentBetweenMajorBranches: true
YAML

write_branch_config() {
  local branch="$1" level="$2" targets="$3"
  {
    echo "branchName: $branch"
    echo "level: $level"
    if [ "$targets" = "-" ]; then
      echo "mergeTargets: []"
    else
      echo "mergeTargets:"
      echo "  - $targets"
    fi
  } >"config/branches/.sfdx-hardis.$branch.yml"
}
write_branch_config integration 10 uat
write_branch_config uat 20 preprod
write_branch_config preprod 90 main
write_branch_config main 100 -

# config/user holds the local user config sfdx-hardis writes; a dirty tree makes promotion:create
# refuse to run. hardis-report/ is deliberately NOT ignored, see the runbook.
cat >.gitignore <<'IGN'
config/user/
.sf/
.sfdx/
node_modules/
IGN

apex_class() {
  local name="$1"
  cat >"force-app/main/default/classes/$name.cls" <<CLS
@isTest
private class $name {
  @isTest
  static void itWorks() {
    System.assert(true, 'promotion branches end to end test');
  }
}
CLS
  cat >"force-app/main/default/classes/$name.cls-meta.xml" <<META
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>$API</apiVersion>
    <status>Active</status>
</ApexClass>
META
}
apex_class PromoE2EAlphaTest
apex_class PromoE2EBetaTest

# The shared file: two stories editing it is how a real cherry-pick conflict is produced.
cat >force-app/main/default/labels/CustomLabels.labels-meta.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>PromoE2EShared</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>PromoE2EShared</shortDescription>
        <value>base</value>
    </labels>
</CustomLabels>
XML

# A file outside force-app and manifest: the conflict the marker gate must still catch.
cat >NOTES.md <<'MD'
# Promotion branches end to end test

Shared notes, base version.
MD

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
    <types>
        <members>*</members>
        <name>StaticResource</name>
    </types>
    <version>$API</version>
</Package>
XML

git add -A
git commit -qm "chore: base project"
echo "built base project in $WORK"

#!/usr/bin/env bash
# Writes the sample project of the release versioning end to end test in a new folder $WORK, a git
# repository with one branch, main. The run (rv-e2e.sh) creates integration, uat and preprod from
# it, adds the CI files and the remote.
#
#   integration -> uat -> preprod -> main      uat, preprod and main declare releaseVersioning: true
#
# The stories change the custom label RV_Label, the hotfixes the Apex class RVHotfix: a promotion
# never conflicts with a hotfix merged into preprod before it.
#
# PART=default  the tags of every versioned branch keep the default format (v1.4.0-rc.2), and main
#               starts with a tag made by hand, v1.3.0
# PART=custom   uat names its tags v{MAJ}.{MIN}.{PATCH}-pi{PI}-it{IT}-{BRANCH}-rc{RC}, preprod
#               v{MAJ}.{MIN}.{PATCH}-{BRANCH}-rc{RC}, and main declares a format too, which must be
#               ignored with a warning. The project config gives PI 2 and IT 4
#
#   WORK=<new folder> PART=custom API=67.0 bash rv-build-project.sh
set -euo pipefail

: "${WORK:?set WORK to a new folder}"
PART="${PART:-default}"
API="${API:-67.0}"
case "$PART" in
default | custom) ;;
*)
  echo "PART=$PART: default or custom" >&2
  exit 2
  ;;
esac
if [ -e "$WORK" ]; then
  echo "ERROR: $WORK already exists" >&2
  exit 1
fi
mkdir -p "$WORK"
cd "$WORK"
git init -q -b main
# LF in the clone whatever the git settings of the computer: the run edits files with sed
git config core.autocrlf false

mkdir -p config/branches manifest force-app/main/default/labels force-app/main/default/classes

cat >sfdx-project.json <<JSON
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "name": "sfdx-hardis-rv-e2e-$PART",
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

# ------------------------------------------------------------------ metadata
# RV_Label: the value is the last story that changed it (rv-e2e.sh rewrites the <value> line)
cat >force-app/main/default/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>RV_Label</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>RV Label</shortDescription>
        <value>base</value>
    </labels>
</CustomLabels>
XML

# RVHotfix: the hotfixes rewrite the HOTFIX line
cat >force-app/main/default/classes/RVHotfix.cls <<'APEX'
public with sharing class RVHotfix {
    // HOTFIX: none
    public static String level() {
        return 'base';
    }
}
APEX
cat >force-app/main/default/classes/RVHotfix.cls-meta.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>$API</apiVersion>
    <status>Active</status>
</ApexClass>
XML

cat >manifest/package.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>RVHotfix</members>
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

# ------------------------------------------------------------------ config
{
  echo "projectName: sfdx-hardis-rv-e2e-$PART"
  echo "developmentBranch: integration"
  echo "testLevel: NoTestRun"
  if [ "$PART" = "custom" ]; then
    echo "releaseVersioningMinimumVariables:"
    echo "  PI: 2"
    echo "  IT: 4"
  fi
} >config/.sfdx-hardis.yml

printf 'mergeTargets:\n  - uat\n' >config/branches/.sfdx-hardis.integration.yml
printf 'mergeTargets:\n  - preprod\nreleaseVersioning: true\n' >config/branches/.sfdx-hardis.uat.yml
printf 'mergeTargets:\n  - main\nreleaseVersioning: true\n' >config/branches/.sfdx-hardis.preprod.yml
printf 'mergeTargets: []\nreleaseVersioning: true\n' >config/branches/.sfdx-hardis.main.yml
if [ "$PART" = "custom" ]; then
  echo 'releaseVersioningTagFormat: v{MAJ}.{MIN}.{PATCH}-pi{PI}-it{IT}-{BRANCH}-rc{RC}' >>config/branches/.sfdx-hardis.uat.yml
  echo 'releaseVersioningTagFormat: v{MAJ}.{MIN}.{PATCH}-{BRANCH}-rc{RC}' >>config/branches/.sfdx-hardis.preprod.yml
  # Ignored: the highest versioned branch always gets plain versions, with a warning
  echo 'releaseVersioningTagFormat: v{MAJ}.{MIN}.{PATCH}-{BRANCH}-rc{RC}' >>config/branches/.sfdx-hardis.main.yml
fi

git add -A
git commit -q -m "Sample project of the release versioning end to end test ($PART)"
echo "Project written in $WORK (PART=$PART)"

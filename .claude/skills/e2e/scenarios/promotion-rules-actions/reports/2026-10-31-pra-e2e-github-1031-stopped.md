# Promotion + rules + actions, GitHub, 2026-10-31 (stopped)

Run stopped after S1: GitHub Actions refused every later job (account spending limit / failed payment), so S2 to main never ran. 22 checks OK before the stop, 0 FAIL. Repository nvuillam/sfdx-hardis-pra-e2e-10310329 (archived), scratch org deleted.

```
ORG | OK | scratch org pra-e2e-github ready (test-lfgxapr8ajoz@example.com)
REPO-ISSUE | OK | replacement rules issue holds pra-issue preprod=from-issue
REPO | OK | repository nvuillam/sfdx-hardis-pra-e2e-10310329 with main integration uat preprod, 4 logins, 4 PRA_SECRET_<BRANCH>
CREATE-s1-pre | OK | action:create --agent s1-pre on #3
CREATE-s1-post | OK | action:create --agent s1-post on #3
CREATE-s1-apex | OK | action:create --agent s1-apex on #3
CREATE-s1-manual | OK | action:create --agent s1-manual on #3
s1-check-NOSECRET | OK | s1-check: no secret value in it
s1-check-comments-NOSECRET | OK | s1-check-comments: no secret value in it
S1-CHECK | OK | s1-check: the validation applies the integration value of every rule but pra-uat-only, the pre command sees the git files [real CI]
S1-CHECK-COMMENT | OK | s1-check-comments: the validation comment has the rules of integration and the actions of S1
s1-deploy-NOSECRET | OK | s1-deploy: no secret value in it
s1-deploy-comments-NOSECRET | OK | s1-deploy-comments: no secret value in it
S1-DEPLOY | OK | s1-deploy: the deployment applies the rules of integration, the post command sees the files of git again, the apex action runs [real CI]
S1-ORG-PRA_Endpoint | OK | label PRA_Endpoint = https://int.pra.example.com
S1-ORG-PRA_Secret | OK | label PRA_Secret holds PRA_SECRET_INTEGRATION
S1-ORG-PRA_Uat_Only | OK | label PRA_Uat_Only = git-value
S1-ORG-PRA_Not_Main | OK | label PRA_Not_Main = not-main
S1-ORG-PRA_Issue | OK | label PRA_Issue = project-value
S1-ORG-APEX | OK | PRAEndpoints.HOST = https://int-api.pra.example.com/api
S1-ORG-APEX-ACTION | OK | the apex action of S1 read https://int.pra.example.com in the org right after the deployment (1)
CREATE-s2-remove | OK | action:create --agent s2-remove on #4
```

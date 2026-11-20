# Promotion + replacement rules + deployment actions e2e - pra-e2e-github-3

- provider: github, repository: nvuillam/sfdx-hardis-pra-e2e-10200220
- sfdx-hardis branch: main (a89d8b339)
- org: scratch org pra-e2e-github
- stories: S1 #2, S2 #4, S3 #5; promotions: uat #6, preprod #7, main #8
- result: 102 OK, 0 FAIL, 0 SKIP

| Check                            | Result | Detail                                                                                                                                                                     |
|----------------------------------|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ORG                              | OK     | scratch org pra-e2e-github ready (test-xsbd5bh8mevb@example.com)                                                                                                           |
| REPO-ISSUE                       | OK     | replacement rules issue holds pra-issue preprod=from-issue                                                                                                                 |
| REPO                             | OK     | repository nvuillam/sfdx-hardis-pra-e2e-10200220 with main integration uat preprod, 4 logins, 4 PRA_SECRET_<BRANCH>                                                        |
| CREATE-s1-pre                    | OK     | action:create --agent s1-pre on #2                                                                                                                                         |
| CREATE-s1-post                   | OK     | action:create --agent s1-post on #2                                                                                                                                        |
| CREATE-s1-apex                   | OK     | action:create --agent s1-apex on #2                                                                                                                                        |
| CREATE-s1-manual                 | OK     | action:create --agent s1-manual on #2                                                                                                                                      |
| s1-check-NOSECRET                | OK     | s1-check: no secret value in it                                                                                                                                            |
| s1-check-comments-NOSECRET       | OK     | s1-check-comments: no secret value in it                                                                                                                                   |
| S1-CHECK                         | OK     | s1-check: the validation applies the integration value of every rule but pra-uat-only, the pre command sees the git files [real CI]                                        |
| S1-CHECK-COMMENT                 | OK     | s1-check-comments: the validation comment has the rules of integration and the actions of S1                                                                               |
| s1-deploy-NOSECRET               | OK     | s1-deploy: no secret value in it                                                                                                                                           |
| s1-deploy-comments-NOSECRET      | OK     | s1-deploy-comments: no secret value in it                                                                                                                                  |
| S1-DEPLOY                        | OK     | s1-deploy: the deployment applies the rules of integration, the post command sees the files of git again, the apex action runs [real CI]                                   |
| S1-ORG-PRA_Endpoint              | OK     | label PRA_Endpoint = https://int.pra.example.com                                                                                                                           |
| S1-ORG-PRA_Secret                | OK     | label PRA_Secret holds PRA_SECRET_INTEGRATION                                                                                                                              |
| S1-ORG-PRA_Uat_Only              | OK     | label PRA_Uat_Only = git-value                                                                                                                                             |
| S1-ORG-PRA_Not_Main              | OK     | label PRA_Not_Main = not-main                                                                                                                                              |
| S1-ORG-PRA_Issue                 | OK     | label PRA_Issue = project-value                                                                                                                                            |
| S1-ORG-APEX                      | OK     | PRAEndpoints.HOST = https://int-api.pra.example.com/api                                                                                                                    |
| S1-ORG-APEX-ACTION               | OK     | the apex action of S1 read https://int.pra.example.com in the org right after the deployment (1)                                                                           |
| CREATE-s2-remove                 | OK     | action:create --agent s2-remove on #4                                                                                                                                      |
| s2-check-NOSECRET                | OK     | s2-check: no secret value in it                                                                                                                                            |
| s2-check-comments-NOSECRET       | OK     | s2-check-comments: no secret value in it                                                                                                                                   |
| S2-CHECK                         | OK     | s2-check: the rule added by the story applies in its own validation; the main-only removal does not run [real CI]                                                          |
| s2-deploy-NOSECRET               | OK     | s2-deploy: no secret value in it                                                                                                                                           |
| s2-deploy-comments-NOSECRET      | OK     | s2-deploy-comments: no secret value in it                                                                                                                                  |
| S2-DEPLOY                        | OK     | s2-deploy: the deployment applies the rule of the story [real CI]                                                                                                          |
| S2-ORG-PRA_Endpoint              | OK     | label PRA_Endpoint = https://int.pra.example.com                                                                                                                           |
| S2-ORG-PRA_Secret                | OK     | label PRA_Secret holds PRA_SECRET_INTEGRATION                                                                                                                              |
| S2-ORG-PRA_Uat_Only              | OK     | label PRA_Uat_Only = git-value                                                                                                                                             |
| S2-ORG-PRA_Not_Main              | OK     | label PRA_Not_Main = not-main                                                                                                                                              |
| S2-ORG-PRA_Issue                 | OK     | label PRA_Issue = project-value                                                                                                                                            |
| S2-ORG-PRA_Story                 | OK     | label PRA_Story = story-default                                                                                                                                            |
| S2-ORG-APEX                      | OK     | PRAEndpoints.HOST = https://int-api.pra.example.com/api                                                                                                                    |
| s3-check-NOSECRET                | OK     | s3-check: no secret value in it                                                                                                                                            |
| s3-check-comments-NOSECRET       | OK     | s3-check-comments: no secret value in it                                                                                                                                   |
| S3-CHECK                         | OK     | s3-check: the validation of S3 applies its own value [real CI]                                                                                                             |
| s3-deploy-NOSECRET               | OK     | s3-deploy: no secret value in it                                                                                                                                           |
| s3-deploy-comments-NOSECRET      | OK     | s3-deploy-comments: no secret value in it                                                                                                                                  |
| S3-DEPLOY                        | OK     | s3-deploy: the deployment of S3 [real CI]                                                                                                                                  |
| S3-ORG-PRA_Endpoint              | OK     | label PRA_Endpoint = https://int.pra.example.com                                                                                                                           |
| S3-ORG-PRA_Secret                | OK     | label PRA_Secret holds PRA_SECRET_INTEGRATION                                                                                                                              |
| S3-ORG-PRA_Uat_Only              | OK     | label PRA_Uat_Only = git-value                                                                                                                                             |
| S3-ORG-PRA_Not_Main              | OK     | label PRA_Not_Main = not-main                                                                                                                                              |
| S3-ORG-PRA_Issue                 | OK     | label PRA_Issue = s3-value                                                                                                                                                 |
| S3-ORG-PRA_Story                 | OK     | label PRA_Story = story-default                                                                                                                                            |
| S3-ORG-APEX                      | OK     | PRAEndpoints.HOST = https://int-api.pra.example.com/api                                                                                                                    |
| UAT-PROMOTE                      | OK     | promotion #6 integration -> uat carries #2 and #4                                                                                                                          |
| UAT-CONFIG                       | OK     | the promotion carries the rule of S2 and not the value of S3                                                                                                               |
| UAT-check-NOSECRET               | OK     | UAT-check: no secret value in it                                                                                                                                           |
| UAT-check-comments-NOSECRET      | OK     | UAT-check-comments: no secret value in it                                                                                                                                  |
| UAT-CHECK                        | OK     | uat-check: the validation of the promotion applies the rules of uat: the branch file value, the uat-only rule; the pre command of S1 runs for uat [real CI]                |
| UAT-CHECK-COMMENT                | OK     | uat-check-comments: the validation comment has the rules of uat and the actions the promotion carries                                                                      |
| uat-deploy-NOSECRET              | OK     | uat-deploy: no secret value in it                                                                                                                                          |
| uat-deploy-comments-NOSECRET     | OK     | uat-deploy-comments: no secret value in it                                                                                                                                 |
| UAT-DEPLOY                       | OK     | uat-deploy: the deployment of the promotion applies the rules of uat and runs the actions of S1 in uat [real CI]                                                           |
| UAT-ORG-PRA_Endpoint             | OK     | label PRA_Endpoint = https://uat-branch.pra.example.com                                                                                                                    |
| UAT-ORG-PRA_Secret               | OK     | label PRA_Secret holds PRA_SECRET_UAT                                                                                                                                      |
| UAT-ORG-PRA_Uat_Only             | OK     | label PRA_Uat_Only = uat-only                                                                                                                                              |
| UAT-ORG-PRA_Not_Main             | OK     | label PRA_Not_Main = not-main                                                                                                                                              |
| UAT-ORG-PRA_Issue                | OK     | label PRA_Issue = project-value                                                                                                                                            |
| UAT-ORG-PRA_Story                | OK     | label PRA_Story = story-default                                                                                                                                            |
| UAT-ORG-APEX                     | OK     | PRAEndpoints.HOST = https://uat-api.pra.example.com/api                                                                                                                    |
| UAT-ORG-APEX-ACTION              | OK     | the apex action of S1 read https://uat-branch.pra.example.com in the org right after the deployment (1)                                                                    |
| UAT-STATUS                       | OK     | uat-status: statuses of the actions of S1 in uat                                                                                                                           |
| PREPROD-PROMOTE                  | OK     | promotion #7 uat -> preprod carries #2 and #4                                                                                                                              |
| PREPROD-CONFIG                   | OK     | the promotion carries the rule of S2 and not the value of S3                                                                                                               |
| PREPROD-check-NOSECRET           | OK     | PREPROD-check: no secret value in it                                                                                                                                       |
| PREPROD-check-comments-NOSECRET  | OK     | PREPROD-check-comments: no secret value in it                                                                                                                              |
| PREPROD-CHECK                    | OK     | preprod-check: the validation applies the rules of preprod: the issue value, the story value, not the uat-only rule [real CI]                                              |
| PREPROD-CHECK-COMMENT            | OK     | preprod-check-comments: the validation comment has the rules of preprod and says the issue changed one                                                                     |
| preprod-deploy-NOSECRET          | OK     | preprod-deploy: no secret value in it                                                                                                                                      |
| preprod-deploy-comments-NOSECRET | OK     | preprod-deploy-comments: no secret value in it                                                                                                                             |
| PREPROD-DEPLOY                   | OK     | preprod-deploy: the deployment applies the rules of preprod and runs the actions of S1 in preprod [real CI]                                                                |
| PREPROD-ORG-PRA_Endpoint         | OK     | label PRA_Endpoint = https://preprod.pra.example.com                                                                                                                       |
| PREPROD-ORG-PRA_Secret           | OK     | label PRA_Secret holds PRA_SECRET_PREPROD                                                                                                                                  |
| PREPROD-ORG-PRA_Uat_Only         | OK     | label PRA_Uat_Only = git-value                                                                                                                                             |
| PREPROD-ORG-PRA_Not_Main         | OK     | label PRA_Not_Main = not-main                                                                                                                                              |
| PREPROD-ORG-PRA_Issue            | OK     | label PRA_Issue = from-issue                                                                                                                                               |
| PREPROD-ORG-PRA_Story            | OK     | label PRA_Story = story-preprod                                                                                                                                            |
| PREPROD-ORG-APEX                 | OK     | PRAEndpoints.HOST = https://preprod-api.pra.example.com/api                                                                                                                |
| PREPROD-ORG-APEX-ACTION          | OK     | the apex action of S1 read https://preprod.pra.example.com in the org right after the deployment (1)                                                                       |
| MAIN-PROMOTE                     | OK     | promotion #8 preprod -> main carries #2 and #4                                                                                                                             |
| MAIN-CONFIG                      | OK     | the promotion carries the rule of S2 and not the value of S3                                                                                                               |
| MAIN-check-NOSECRET              | OK     | MAIN-check: no secret value in it                                                                                                                                          |
| MAIN-check-comments-NOSECRET     | OK     | MAIN-check-comments: no secret value in it                                                                                                                                 |
| MAIN-CHECK                       | OK     | main-check: the validation applies the rules of main: no pra-not-main; the main-only action of S2 removes the Apex class, so pra-apex-host has nothing to change [real CI] |
| main-deploy-NOSECRET             | OK     | main-deploy: no secret value in it                                                                                                                                         |
| main-deploy-comments-NOSECRET    | OK     | main-deploy-comments: no secret value in it                                                                                                                                |
| MAIN-DEPLOY                      | OK     | main-deploy: the deployment to main: rules of main, the Apex class left out by the action of S2, the actions of S1 run [real CI]                                           |
| MAIN-ORG-PRA_Endpoint            | OK     | label PRA_Endpoint = https://prod.pra.example.com                                                                                                                          |
| MAIN-ORG-PRA_Secret              | OK     | label PRA_Secret holds PRA_SECRET_MAIN                                                                                                                                     |
| MAIN-ORG-PRA_Uat_Only            | OK     | label PRA_Uat_Only = git-value                                                                                                                                             |
| MAIN-ORG-PRA_Not_Main            | OK     | label PRA_Not_Main = git-value                                                                                                                                             |
| MAIN-ORG-PRA_Issue               | OK     | label PRA_Issue = project-value                                                                                                                                            |
| MAIN-ORG-PRA_Story               | OK     | label PRA_Story = story-default                                                                                                                                            |
| MAIN-ORG-APEX                    | OK     | PRAEndpoints.HOST = https://preprod-api.pra.example.com/api                                                                                                                |
| MAIN-ORG-APEX-ACTION             | OK     | the apex action of S1 read https://prod.pra.example.com in the org right after the deployment (1)                                                                          |
| MAIN-STATUS                      | OK     | main-status: statuses of the actions in main                                                                                                                               |
| X1                               | OK     | pr-modal: the Pull Request modal tabs show what the provider holds                                                                                                         |
| X2                               | OK     | pipeline: the DevOps Pipeline shows S3 alone in integration, no open promotion                                                                                             |

## CI jobs

```
label           provider  mode     run          result   queued_s  ran_s  build_minutes
s1-check        github    real CI  39347313508  success  0         290    
s1-deploy       github    real CI  39347826120  success  0         285    
s2-check        github    real CI  39348430622  success  0         339    
s2-deploy       github    real CI  39348997539  success  0         274    
s3-check        github    real CI  39349530374  success  0         302    
s3-deploy       github    real CI  39350066386  success  0         270    
UAT-check       github    real CI  39350602079  success  0         288    
uat-deploy      github    real CI  39351092559  success  0         305    
PREPROD-check   github    real CI  39351720342  success  0         250    
preprod-deploy  github    real CI  39352149611  success  0         311    
MAIN-check      github    real CI  39352742784  success  0         298    
main-deploy     github    real CI  39353233289  success  0         309    
```

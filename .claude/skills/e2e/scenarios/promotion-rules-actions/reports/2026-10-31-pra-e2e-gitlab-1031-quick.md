# Promotion + replacement rules + deployment actions e2e - pra-e2e-gitlab-1031-quick

- provider: gitlab, repository: https://gitlab.hardis-group.com/busalesforce/playground/sfdx-hardis-pra-e2e-gl-10310522
- sfdx-hardis branch: main (da92636cb)
- org: scratch org pra-e2e-gitlab, testLevel RunLocalTests
- stories: S1 #1, S2 #2, S3 #3; promotions: uat #4, preprod #5, main #6
- result: 108 OK, 0 FAIL, 0 SKIP

| Check                            | Result | Detail                                                                                                                                                                     |
|----------------------------------|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ORG                              | OK     | scratch org pra-e2e-gitlab ready (test-alzqja4icviy@example.com)                                                                                                           |
| REPO-ISSUE                       | OK     | replacement rules issue holds pra-issue preprod=from-issue                                                                                                                 |
| REPO                             | OK     | repository busalesforce/playground/sfdx-hardis-pra-e2e-gl-10310522 with main integration uat preprod, 4 logins, 4 PRA_SECRET_<BRANCH>                                      |
| CREATE-s1-pre                    | OK     | action:create --agent s1-pre on #1                                                                                                                                         |
| CREATE-s1-post                   | OK     | action:create --agent s1-post on #1                                                                                                                                        |
| CREATE-s1-apex                   | OK     | action:create --agent s1-apex on #1                                                                                                                                        |
| CREATE-s1-manual                 | OK     | action:create --agent s1-manual on #1                                                                                                                                      |
| s1-check-NOSECRET                | OK     | s1-check: no secret value in it                                                                                                                                            |
| s1-check-comments-NOSECRET       | OK     | s1-check-comments: no secret value in it                                                                                                                                   |
| S1-CHECK                         | OK     | s1-check: the validation applies the integration value of every rule but pra-uat-only, the pre command sees the git files [real CI]                                        |
| S1-CHECK-COMMENT                 | OK     | s1-check-comments: the validation comment has the rules of integration and the actions of S1                                                                               |
| s1-deploy-QUICK                  | OK     | s1-deploy: the deployment job quick deploys the validation of its target [real CI]                                                                                         |
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
| CREATE-s2-remove                 | OK     | action:create --agent s2-remove on #2                                                                                                                                      |
| s2-check-NOSECRET                | OK     | s2-check: no secret value in it                                                                                                                                            |
| s2-check-comments-NOSECRET       | OK     | s2-check-comments: no secret value in it                                                                                                                                   |
| S2-CHECK                         | OK     | s2-check: the rule added by the story applies in its own validation; the main-only removal does not run [real CI]                                                          |
| s2-deploy-QUICK                  | OK     | s2-deploy: the deployment job quick deploys the validation of its target [real CI]                                                                                         |
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
| s3-deploy-QUICK                  | OK     | s3-deploy: the deployment job quick deploys the validation of its target [real CI]                                                                                         |
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
| UAT-PROMOTE                      | OK     | promotion #4 integration -> uat carries #1 and #2                                                                                                                          |
| UAT-CONFIG                       | OK     | the promotion carries the rule of S2 and not the value of S3                                                                                                               |
| uat-check-NOSECRET               | OK     | uat-check: no secret value in it                                                                                                                                           |
| uat-check-comments-NOSECRET      | OK     | uat-check-comments: no secret value in it                                                                                                                                  |
| UAT-CHECK                        | OK     | uat-check: the validation of the promotion applies the rules of uat: the branch file value, the uat-only rule; the pre command of S1 runs for uat [real CI]                |
| UAT-CHECK-COMMENT                | OK     | uat-check-comments: the validation comment has the rules of uat and the actions the promotion carries                                                                      |
| uat-deploy-QUICK                 | OK     | uat-deploy: the deployment job quick deploys the validation of its target [real CI]                                                                                        |
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
| PREPROD-PROMOTE                  | OK     | promotion #5 uat -> preprod carries #1 and #2                                                                                                                              |
| PREPROD-CONFIG                   | OK     | the promotion carries the rule of S2 and not the value of S3                                                                                                               |
| preprod-check-NOSECRET           | OK     | preprod-check: no secret value in it                                                                                                                                       |
| preprod-check-comments-NOSECRET  | OK     | preprod-check-comments: no secret value in it                                                                                                                              |
| PREPROD-CHECK                    | OK     | preprod-check: the validation applies the rules of preprod: the issue value, the story value, not the uat-only rule [real CI]                                              |
| PREPROD-CHECK-COMMENT            | OK     | preprod-check-comments: the validation comment has the rules of preprod and says the issue changed one                                                                     |
| preprod-deploy-QUICK             | OK     | preprod-deploy: the deployment job quick deploys the validation of its target [real CI]                                                                                    |
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
| MAIN-PROMOTE                     | OK     | promotion #6 preprod -> main carries #1 and #2                                                                                                                             |
| MAIN-CONFIG                      | OK     | the promotion carries the rule of S2 and not the value of S3                                                                                                               |
| main-check-NOSECRET              | OK     | main-check: no secret value in it                                                                                                                                          |
| main-check-comments-NOSECRET     | OK     | main-check-comments: no secret value in it                                                                                                                                 |
| MAIN-CHECK                       | OK     | main-check: the validation applies the rules of main: no pra-not-main; the main-only action of S2 removes the Apex class, so pra-apex-host has nothing to change [real CI] |
| main-deploy-QUICK                | OK     | main-deploy: the deployment job quick deploys the validation of its target [real CI]                                                                                       |
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
label           provider  mode     run      result   queued_s  ran_s  build_minutes
s1-check        gitlab    real CI  1024694  success  3         223    
s1-deploy       gitlab    real CI  1024695  success  2         205    
s2-check        gitlab    real CI  1024699  success  2         224    
s2-deploy       gitlab    real CI  1024704  success  2         198    
s3-check        gitlab    real CI  1024706  success  2         220    
s3-deploy       gitlab    real CI  1024707  success  0         194    
uat-check       gitlab    real CI  1024709  success  1         224    
uat-deploy      gitlab    real CI  1024710  success  2         202    
preprod-check   gitlab    real CI  1024716  success  1         370    
preprod-deploy  gitlab    real CI  1024717  success  1         203    
main-check      gitlab    real CI  1024723  success  2         246    
main-deploy     gitlab    real CI  1024724  success  1         197    
```

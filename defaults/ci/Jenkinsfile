 /* sfdx-hardis CI/CD Pipeline for Jenkins

 You need to do a CTRL+F on "MANUAL" and add your variable instead of example variable

 */
pipeline {
    agent any
    // MANUAL : Add Environment variable if necessary
    environment {
        SFDX_CLIENT_ID_INTEGRATION = credentials('SFDX_CLIENT_ID_INTEGRATION') //Example
        SFDX_CLIENT_KEY_INTEGRATION = credentials('SFDX_CLIENT_KEY_INTEGRATION') //Example
        SFDX_CLIENT_ID_UAT = credentials('SFDX_CLIENT_ID_UAT') //Example
        SFDX_CLIENT_KEY_UAT = credentials('SFDX_CLIENT_KEY_UAT') //Example
        SFDX_CLIENT_ID_PREPROD = credentials('SFDX_CLIENT_ID_PREPROD') //Example
        SFDX_CLIENT_KEY_PREPROD = credentials('SFDX_CLIENT_KEY_PREPROD') //Example
        SFDX_CLIENT_ID_MAIN = credentials('SFDX_CLIENT_ID_MAIN') //Example
        SFDX_CLIENT_KEY_MAIN = credentials('SFDX_CLIENT_KEY_MAIN') //Example
        SFDX_AUTH_URL_TECHNICAL_ORG = credentials('SFDX_AUTH_URL_TECHNICAL_ORG')
        SLACK_TOKEN = credentials('SLACK_TOKEN') // Remove if not used
        SLACK_CHANNEL_ID = credentials('SLACK_CHANNEL_ID') // Remove if not used
        NOTIF_EMAIL_ADDRESS = credentials('NOTIF_EMAIL_ADDRESS') // Remove if not used
        JIRA_HOST = credentials('JIRA_HOST') // Remove if not used
        JIRA_EMAIL = credentials('JIRA_EMAIL') // Remove if not used
        JIRA_TOKEN = credentials('JIRA_TOKEN') // Remove if not used
        JIRA_PAT = credentials('JIRA_PAT') // Remove if not used
        CONFIG_BRANCH = "${GIT_BRANCH}"
        CI_COMMIT_REF_NAME = "${GIT_BRANCH}"
        ORG_ALIAS = "${GIT_BRANCH}"
        SFDX_DISABLE_FLOW_DIFF = 'false' // Set to true to disable Flow doc during CI/CD setup
    }

    //Stage of the job
    stages {
        parallel {
            //run megalinter
            stage('MegaLinter') {
                agent {
                    docker {
                        image 'oxsecurity/megalinter:latest'
                        args "-u root -e VALIDATE_ALL_CODEBASE=true -v ${WORKSPACE}:/tmp/lint --entrypoint=''"
                        reuseNode true
                    }
                }
                when { changeRequest() }
                steps {
                    sh '/entrypoint.sh'
                }
                post {
                    always {
                        archiveArtifacts allowEmptyArchive: true, artifacts: 'mega-linter.log,megalinter-reports/**/*', defaultExcludes: false, followSymlinks: false
                    }
                }
            }
            stage('Validation') {
                agent {
                    docker {
                        // If rate limits reached, use ghcr.io/hardisgroupcom/sfdx-hardis:latest
                        image 'hardisgroupcom/sfdx-hardis:latest' 
                    }
                }
                when { changeRequest() }
                //Validation on the appropriate org
                steps {
                    script {
                        sh 'sf hardis:auth:login'
                        sh 'sf hardis:project:deploy:smart --check'
                    }
                }
                post {
                    always {
                        archiveArtifacts allowEmptyArchive: true, artifacts: 'hardis-report', defaultExcludes: false, followSymlinks: false
                    }
                }
            }
            stage('Deployment') {
                agent {
                    docker {
                        // If rate limits reached, use ghcr.io/hardisgroupcom/sfdx-hardis:latest
                        image 'hardisgroupcom/sfdx-hardis:latest'
                    }
                }
                //MANUAL: add your major branch if necessary
                when {
                    allOf {
                        anyOf {
                            branch: 'integration' //Example
                            branch: 'uat' //Example
                            branch: 'preprod' //Example
                            branch: 'main' //Example
                        };
                        not { changeRequest() }
                    }
                }
                //deploy on the appropriate org
                steps {
                    script {
                        sh 'sf hardis:auth:login'
                        sh 'sf hardis:project:deploy:smart'
                    }
                }
                post {
                    always {
                        archiveArtifacts allowEmptyArchive: true, artifacts: 'hardis-report', defaultExcludes: false, followSymlinks: false
                    }
                }
            }
        }
    }
}

// Pipeline for Salesforce monitoring using sfdx-hardis
//
// SETUP (do a CTRL+F on "MANUAL"):
// 1. In Jenkins, create a Multibranch Pipeline pointing to this repository.
//    Configure the branch discovery filter to include your monitoring branches (e.g. monitoring_*).
//    Each monitoring branch must contain this Jenkinsfile.
//
// 2. Add the following credentials in Jenkins (Manage Jenkins → Credentials):
//    - GIT_ACCESS_TOKEN : Username with password - git username + personal access token (for commit push) [REQUIRED]
//    - SFDX_CLIENT_ID_* and SFDX_CLIENT_KEY_* : Secret text - one pair per monitored org (see MANUAL below) [REQUIRED]
//    - SLACK_TOKEN, SLACK_CHANNEL_ID, NOTIF_EMAIL_ADDRESS : Secret text [optional - skip if unused]
//    - NOTIF_API_URL, NOTIF_API_BASIC_AUTH_USERNAME, NOTIF_API_BASIC_AUTH_PASSWORD : Secret text [optional]
//    - NOTIF_API_METRICS_URL, NOTIF_API_METRICS_BASIC_AUTH_USERNAME, NOTIF_API_METRICS_BASIC_AUTH_PASSWORD : Secret text [optional]
//    - CLOUDFLARE_EMAIL, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, etc. : Secret text [optional]
//    Optional credentials use `optional: true` (requires Credentials Binding Plugin ≥ 1.24).
//    Missing optional credentials are silently ignored - the pipeline will NOT crash.
//
// 3. The Docker agent requires Docker to be available on the Jenkins node.
//    The main agent uses hardisgroupcom/sfdx-hardis:latest.
//    MegaLinter runs via `docker run` inside that agent (Docker socket is mounted).
//
// Doc & support: https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/

pipeline {

    agent {
        docker {
            // Use sfdx-hardis image - no install step needed. If not working on Jenkins, use ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:latest
            image 'ghcr.io/hardisgroupcom/sfdx-hardis:latest'
            // Mount Docker socket so MegaLinter can run as a sibling container
            args '-v /var/run/docker.sock:/var/run/docker.sock --user root'
        }
    }

    // Run every day at midnight - adjust cron expression as needed
    // Cron format reference: https://crontab.cronhub.io/
    triggers {
        cron('H 0 * * *')
    }

    options {
        timeout(time: 360, unit: 'MINUTES')
        disableConcurrentBuilds()
        // Keep build logs for 6 months
        buildDiscarder(logRotator(daysToKeepStr: '180'))
    }

    environment {
        FORCE_COLOR = '1'
        // Normalize branch name: strip the "origin/" prefix added by Jenkins
        BRANCH_NAME_CLEAN = "${env.BRANCH_NAME ?: env.GIT_BRANCH?.replaceAll('^origin/', '')}"
        CI_COMMIT_REF_NAME = "${BRANCH_NAME_CLEAN}"
        CONFIG_BRANCH       = "${BRANCH_NAME_CLEAN}"
        ORG_ALIAS           = "${BRANCH_NAME_CLEAN}"
    }

    stages {

        //////////////////////////////////////////////
        // Configure git identity before any stage //
        //////////////////////////////////////////////
        stage('Git Setup') {
            steps {
                sh '''
                    git config --global user.email "contact@cloudity.com"
                    git config --global user.name "sfdx-hardis monitoring"
                '''
            }
        }

        //////////////////////////////////////////////
        // Sfdx Sources Backup + Push new commit   //
        //////////////////////////////////////////////
        stage('Backup Metadata') {
            steps {
                withCredentials([
                    // ----------------------------------------------------------------
                    // MANUAL: Add one pair of credentials per monitored org.
                    // The credential ID must match the variable name expected by sfdx-hardis.
                    // Examples - duplicate and adapt for each org branch:
                    //
                    // string(credentialsId: 'SFDX_CLIENT_ID_MONITORING_MYCLIENT',               variable: 'SFDX_CLIENT_ID_MONITORING_MYCLIENT'),
                    // string(credentialsId: 'SFDX_CLIENT_KEY_MONITORING_MYCLIENT',              variable: 'SFDX_CLIENT_KEY_MONITORING_MYCLIENT'),
                    // string(credentialsId: 'SFDX_CLIENT_ID_MONITORING_MYCLIENT__INTEG_SANDBOX', variable: 'SFDX_CLIENT_ID_MONITORING_MYCLIENT__INTEG_SANDBOX'),
                    // string(credentialsId: 'SFDX_CLIENT_KEY_MONITORING_MYCLIENT__INTEG_SANDBOX',variable: 'SFDX_CLIENT_KEY_MONITORING_MYCLIENT__INTEG_SANDBOX'),
                    // ----------------------------------------------------------------
                    // Notification credentials (optional - pipeline will NOT crash if missing)
                    string(credentialsId: 'SLACK_TOKEN',                           variable: 'SLACK_TOKEN',                           optional: true),
                    string(credentialsId: 'SLACK_CHANNEL_ID',                      variable: 'SLACK_CHANNEL_ID',                      optional: true),
                    string(credentialsId: 'NOTIF_EMAIL_ADDRESS',                   variable: 'NOTIF_EMAIL_ADDRESS',                   optional: true),
                    string(credentialsId: 'NOTIF_API_URL',                         variable: 'NOTIF_API_URL',                         optional: true),
                    string(credentialsId: 'NOTIF_API_BASIC_AUTH_USERNAME',         variable: 'NOTIF_API_BASIC_AUTH_USERNAME',         optional: true),
                    string(credentialsId: 'NOTIF_API_BASIC_AUTH_PASSWORD',         variable: 'NOTIF_API_BASIC_AUTH_PASSWORD',         optional: true),
                    string(credentialsId: 'NOTIF_API_METRICS_URL',                 variable: 'NOTIF_API_METRICS_URL',                 optional: true),
                    string(credentialsId: 'NOTIF_API_METRICS_BASIC_AUTH_USERNAME', variable: 'NOTIF_API_METRICS_BASIC_AUTH_USERNAME', optional: true),
                    string(credentialsId: 'NOTIF_API_METRICS_BASIC_AUTH_PASSWORD', variable: 'NOTIF_API_METRICS_BASIC_AUTH_PASSWORD', optional: true),
                    // Cloudflare credentials (optional - pipeline will NOT crash if missing)
                    string(credentialsId: 'CLOUDFLARE_EMAIL',                      variable: 'CLOUDFLARE_EMAIL',                      optional: true),
                    string(credentialsId: 'CLOUDFLARE_API_TOKEN',                  variable: 'CLOUDFLARE_API_TOKEN',                  optional: true),
                    string(credentialsId: 'CLOUDFLARE_ACCOUNT_ID',                 variable: 'CLOUDFLARE_ACCOUNT_ID',                 optional: true),
                    string(credentialsId: 'CLOUDFLARE_PROJECT_NAME',               variable: 'CLOUDFLARE_PROJECT_NAME',               optional: true),
                    string(credentialsId: 'CLOUDFLARE_DEFAULT_LOGIN_METHOD_TYPE',  variable: 'CLOUDFLARE_DEFAULT_LOGIN_METHOD_TYPE',  optional: true),
                    string(credentialsId: 'CLOUDFLARE_DEFAULT_ACCESS_EMAIL_DOMAIN',variable: 'CLOUDFLARE_DEFAULT_ACCESS_EMAIL_DOMAIN',optional: true),
                    string(credentialsId: 'CLOUDFLARE_EXTRA_ACCESS_POLICY_ID_LIST',variable: 'CLOUDFLARE_EXTRA_ACCESS_POLICY_ID_LIST',optional: true),
                ]) {
                    sh '''
                        echo "Monitoring sfdx-hardis: Metadata Backup for \"${CI_COMMIT_REF_NAME}\""
                        sf hardis:auth:login
                        sf hardis:org:monitor:backup
                    '''
                }

                // Commit and push new org state
                // GIT_ACCESS_TOKEN must be a "Username with password" credential
                // (username = git user, password = personal access token)
                withCredentials([usernamePassword(
                    credentialsId: 'GIT_ACCESS_TOKEN',
                    usernameVariable: 'GIT_USER',
                    passwordVariable: 'GIT_TOKEN'
                )]) {
                    sh '''
                        BUILD_DATE=$(date -u +'%Y-%m-%d %H:%M')
                        git status
                        git add --all
                        git commit -m "Org state on ${BUILD_DATE} for ${BRANCH_NAME_CLEAN} [skip ci]" || echo "No changes to commit"

                        # Push using token-based HTTPS authentication (works for GitHub, GitLab, Azure DevOps, Bitbucket)
                        REMOTE_URL=$(git remote get-url origin)
                        # Strip existing credentials from URL if any, then inject token
                        REMOTE_URL_WITH_TOKEN=$(echo "$REMOTE_URL" | sed "s|https://|https://${GIT_USER}:${GIT_TOKEN}@|")
                        git push "$REMOTE_URL_WITH_TOKEN" HEAD:"${BRANCH_NAME_CLEAN}"
                    '''
                }
            }

            post {
                always {
                    archiveArtifacts artifacts: 'hardis-report/**', allowEmptyArchive: true
                }
            }
        }

        ///////////////////////////////////////////////////////////////
        // Post-backup checks - run in parallel (all allow failure)  //
        ///////////////////////////////////////////////////////////////
        stage('Post-Backup Checks') {
            parallel {

                //////////////////////
                // Run Apex Tests   //
                //////////////////////
                stage('Apex Tests') {
                    steps {
                        sh "git pull origin ${BRANCH_NAME_CLEAN} || echo 'Issue when pulling latest branch state, but that should be ok'"

                        withCredentials([
                            // MANUAL: Add one pair per monitored org (duplicate lines as needed)
                            // string(credentialsId: 'SFDX_CLIENT_ID_MONITORING_MYCLIENT', variable: 'SFDX_CLIENT_ID_MONITORING_MYCLIENT'),
                            // string(credentialsId: 'SFDX_CLIENT_KEY_MONITORING_MYCLIENT', variable: 'SFDX_CLIENT_KEY_MONITORING_MYCLIENT'),
                            string(credentialsId: 'SLACK_TOKEN',                           variable: 'SLACK_TOKEN',                           optional: true),
                            string(credentialsId: 'SLACK_CHANNEL_ID',                      variable: 'SLACK_CHANNEL_ID',                      optional: true),
                            string(credentialsId: 'NOTIF_EMAIL_ADDRESS',                   variable: 'NOTIF_EMAIL_ADDRESS',                   optional: true),
                            string(credentialsId: 'NOTIF_API_URL',                         variable: 'NOTIF_API_URL',                         optional: true),
                            string(credentialsId: 'NOTIF_API_BASIC_AUTH_USERNAME',         variable: 'NOTIF_API_BASIC_AUTH_USERNAME',         optional: true),
                            string(credentialsId: 'NOTIF_API_BASIC_AUTH_PASSWORD',         variable: 'NOTIF_API_BASIC_AUTH_PASSWORD',         optional: true),
                            string(credentialsId: 'NOTIF_API_METRICS_URL',                 variable: 'NOTIF_API_METRICS_URL',                 optional: true),
                            string(credentialsId: 'NOTIF_API_METRICS_BASIC_AUTH_USERNAME', variable: 'NOTIF_API_METRICS_BASIC_AUTH_USERNAME', optional: true),
                            string(credentialsId: 'NOTIF_API_METRICS_BASIC_AUTH_PASSWORD', variable: 'NOTIF_API_METRICS_BASIC_AUTH_PASSWORD', optional: true),
                        ]) {
                            sh '''
                                echo "Run Apex Tests against \"${CI_COMMIT_REF_NAME}\""
                                sf hardis:auth:login
                                sf hardis:org:test:apex
                            '''
                        }
                    }

                    post {
                        always {
                            archiveArtifacts artifacts: 'hardis-report/**', allowEmptyArchive: true
                        }
                        failure {
                            echo 'Apex Tests failed - pipeline continues (allow_failure)'
                        }
                    }
                }

                ////////////////////////////////////////////////////////////
                // Run MegaLinter to detect quality and security issues   //
                ////////////////////////////////////////////////////////////
                stage('MegaLinter') {
                    steps {
                        sh "git pull origin ${BRANCH_NAME_CLEAN} || echo 'Issue when pulling latest branch state, but that should be ok'"

                        withCredentials([
                            string(credentialsId: 'NOTIF_API_URL',                         variable: 'NOTIF_API_URL',                         optional: true),
                            string(credentialsId: 'NOTIF_API_BASIC_AUTH_USERNAME',         variable: 'NOTIF_API_BASIC_AUTH_USERNAME',         optional: true),
                            string(credentialsId: 'NOTIF_API_BASIC_AUTH_PASSWORD',         variable: 'NOTIF_API_BASIC_AUTH_PASSWORD',         optional: true),
                            string(credentialsId: 'NOTIF_API_METRICS_URL',                 variable: 'NOTIF_API_METRICS_URL',                 optional: true),
                            string(credentialsId: 'NOTIF_API_METRICS_BASIC_AUTH_USERNAME', variable: 'NOTIF_API_METRICS_BASIC_AUTH_USERNAME', optional: true),
                            string(credentialsId: 'NOTIF_API_METRICS_BASIC_AUTH_PASSWORD', variable: 'NOTIF_API_METRICS_BASIC_AUTH_PASSWORD', optional: true),
                        ]) {
                            // Run MegaLinter as a sibling container (Docker socket must be mounted in the agent)
                            // All available variables: https://megalinter.io/latest/config-file/
                            sh '''
                                docker pull oxsecurity/megalinter-salesforce:latest
                                docker run --rm \
                                  -v "${WORKSPACE}:/tmp/lint" \
                                  -e DEFAULT_WORKSPACE=/tmp/lint \
                                  -e VALIDATE_ALL_CODEBASE=true \
                                  -e API_REPORTER=true \
                                  -e NOTIF_API_URL="${NOTIF_API_URL}" \
                                  -e NOTIF_API_BASIC_AUTH_USERNAME="${NOTIF_API_BASIC_AUTH_USERNAME}" \
                                  -e NOTIF_API_BASIC_AUTH_PASSWORD="${NOTIF_API_BASIC_AUTH_PASSWORD}" \
                                  -e NOTIF_API_METRICS_URL="${NOTIF_API_METRICS_URL}" \
                                  -e NOTIF_API_METRICS_BASIC_AUTH_USERNAME="${NOTIF_API_METRICS_BASIC_AUTH_USERNAME}" \
                                  -e NOTIF_API_METRICS_BASIC_AUTH_PASSWORD="${NOTIF_API_METRICS_BASIC_AUTH_PASSWORD}" \
                                  oxsecurity/megalinter-salesforce:latest || true
                            '''
                        }
                    }

                    post {
                        always {
                            archiveArtifacts artifacts: 'megalinter-reports/**,mega-linter.log', allowEmptyArchive: true
                        }
                        failure {
                            echo 'MegaLinter failed - pipeline continues (allow_failure)'
                        }
                    }
                }

                //////////////////////////////////////////
                // Run other monitoring checks          //
                //////////////////////////////////////////
                stage('Monitoring Checks') {
                    steps {
                        sh "git pull origin ${BRANCH_NAME_CLEAN} || echo 'Issue when pulling latest branch state, but that should be ok'"

                        withCredentials([
                            // MANUAL: Add one pair per monitored org (duplicate lines as needed)
                            // string(credentialsId: 'SFDX_CLIENT_ID_MONITORING_MYCLIENT', variable: 'SFDX_CLIENT_ID_MONITORING_MYCLIENT'),
                            // string(credentialsId: 'SFDX_CLIENT_KEY_MONITORING_MYCLIENT', variable: 'SFDX_CLIENT_KEY_MONITORING_MYCLIENT'),
                            string(credentialsId: 'SLACK_TOKEN',                           variable: 'SLACK_TOKEN',                           optional: true),
                            string(credentialsId: 'SLACK_CHANNEL_ID',                      variable: 'SLACK_CHANNEL_ID',                      optional: true),
                            string(credentialsId: 'NOTIF_EMAIL_ADDRESS',                   variable: 'NOTIF_EMAIL_ADDRESS',                   optional: true),
                            string(credentialsId: 'NOTIF_API_URL',                         variable: 'NOTIF_API_URL',                         optional: true),
                            string(credentialsId: 'NOTIF_API_BASIC_AUTH_USERNAME',         variable: 'NOTIF_API_BASIC_AUTH_USERNAME',         optional: true),
                            string(credentialsId: 'NOTIF_API_BASIC_AUTH_PASSWORD',         variable: 'NOTIF_API_BASIC_AUTH_PASSWORD',         optional: true),
                            string(credentialsId: 'NOTIF_API_METRICS_URL',                 variable: 'NOTIF_API_METRICS_URL',                 optional: true),
                            string(credentialsId: 'NOTIF_API_METRICS_BASIC_AUTH_USERNAME', variable: 'NOTIF_API_METRICS_BASIC_AUTH_USERNAME', optional: true),
                            string(credentialsId: 'NOTIF_API_METRICS_BASIC_AUTH_PASSWORD', variable: 'NOTIF_API_METRICS_BASIC_AUTH_PASSWORD', optional: true),
                        ]) {
                            sh '''
                                echo "Run Monitoring checks against \"${CI_COMMIT_REF_NAME}\""
                                sf hardis:auth:login
                                sf hardis:org:monitor:all
                            '''
                        }
                    }

                    post {
                        always {
                            archiveArtifacts artifacts: 'hardis-report/**', allowEmptyArchive: true
                        }
                        failure {
                            echo 'Monitoring Checks failed - pipeline continues (allow_failure)'
                        }
                    }
                }

            } // end parallel
        } // end Post-Backup Checks

    } // end stages

    post {
        always {
            cleanWs(cleanWhenAborted: true, cleanWhenFailure: true, cleanWhenSuccess: true)
        }
    }

}

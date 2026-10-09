/**
 * Utility functions for detecting Jenkins CI and mapping its environment
 * variables to git-provider-specific variables.
 *
 * Jenkins environment variables reference:
 *   Core:        JENKINS_URL, BUILD_URL, BUILD_NUMBER, JOB_NAME
 *   Git plugin:  GIT_BRANCH, GIT_LOCAL_BRANCH, GIT_URL, GIT_COMMIT
 *   Multibranch: CHANGE_ID, CHANGE_URL, CHANGE_BRANCH, CHANGE_TARGET,
 *                CHANGE_TITLE, CHANGE_AUTHOR, BRANCH_NAME
 */

/**
 * Returns true when the current CI runner is Jenkins.
 */
export function isJenkins(): boolean {
  return !!(process.env.JENKINS_URL || process.env.JENKINS_HOME);
}

/**
 * Returns the clean branch name derived from Jenkins variables.
 *
 * Priority:
 *  1. CHANGE_BRANCH - source branch of a PR build
 *  2. GIT_LOCAL_BRANCH - explicit local branch (checkout option)
 *  3. GIT_BRANCH stripped of "origin/" prefix
 *  4. BRANCH_NAME (multibranch) when it is not a synthetic "PR-N" ref
 */
export function getJenkinsBranchName(): string | null {
  if (process.env.CHANGE_BRANCH) {
    return process.env.CHANGE_BRANCH;
  }
  if (process.env.GIT_LOCAL_BRANCH) {
    return process.env.GIT_LOCAL_BRANCH;
  }
  if (process.env.GIT_BRANCH) {
    return process.env.GIT_BRANCH.replace(/^origin\//, "");
  }
  if (process.env.BRANCH_NAME && !/^PR-\d+$/i.test(process.env.BRANCH_NAME)) {
    return process.env.BRANCH_NAME;
  }
  return null;
}

/**
 * Returns the pull-request / merge-request number from Jenkins CHANGE_ID.
 * Only set for multibranch pipeline builds that correspond to a change request.
 */
export function getJenkinsPrNumber(): string | null {
  return process.env.CHANGE_ID || null;
}

/**
 * Returns the URL of the current Jenkins build (BUILD_URL).
 */
export function getJenkinsJobUrl(): string | null {
  return process.env.BUILD_URL || null;
}

/**
 * Returns the Jenkins job name (JOB_NAME).
 */
export function getJenkinsJobName(): string | null {
  return process.env.JOB_NAME || null;
}

/**
 * Returns the Jenkins build number (BUILD_NUMBER).
 */
export function getJenkinsBuildNumber(): string | null {
  return process.env.BUILD_NUMBER || null;
}

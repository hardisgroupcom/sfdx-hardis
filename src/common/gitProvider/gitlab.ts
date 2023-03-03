import { GitProvider } from ".";

export class GitlabProvider extends GitProvider {

    async getDeployId() {
        // CI_COMMIT_MESSAGE contains "See merge request !<MR_ID>" 
        const commitMsg = process.env.CI_COMMIT_MESSAGE;
        const parentMergeRequestID = commitMsg.split('!').pop();
    }
}
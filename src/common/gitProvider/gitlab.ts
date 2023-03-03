import { Gitlab } from "@gitbeaker/node";
import { GitProvider } from ".";

export class GitlabProvider extends GitProvider {
  private api: InstanceType<typeof Gitlab>;

  constructor(host: string, token: string) {
    super(host, token);
    this.api = new Gitlab({ host: this.host, token: this.token });
  }

  async getParentMergeRequestId(): Promise<number> {
    // CI_COMMIT_MESSAGE contains "See merge request !<MR_ID>"
    const commitMsg = process.env.CI_COMMIT_MESSAGE;
    return parseInt(commitMsg.split("!").pop());
  }

  async getPipelineId(): Promise<string> {
    const projectId: string = process.env.CI_PROJECT_ID;
    const parentMergeRequestId: number = await this.getParentMergeRequestId();
    const pipelines = await this.api.MergeRequests.pipelines(projectId, parentMergeRequestId);
    console.log(pipelines);
    return '';
  }

}

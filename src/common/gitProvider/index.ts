export abstract class GitProvider {
  protected host: string;
  protected token: string;

  constructor(host: string, token: string) {
    this.host = host;
    this.token = token;
  }

  async getParentMergeRequestId(): Promise<number> {
    return null;
  }

  async getPipelineId(): Promise<string> {
    return "This method is not yet implemented.";
  }

  async getJobsFromPipeline(): Promise<string> {
    return "This method is not yet implemented.";
  }

  async getDeployId(): Promise<string> {
    return "This method is not yet implemented.";
  }
}

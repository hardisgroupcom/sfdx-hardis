import { PullRequestMessageRequest, PullRequestMessageResult } from "./gitProvider";

export interface GitProviderInterface {
    postPullRequestMessage(prMessage: PullRequestMessageRequest): Promise<PullRequestMessageResult>
}
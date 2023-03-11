export declare type PullRequestMessageRequest = {
    title: string;
    message: string;
    status: ["valid", "invalid", "tovalidate"]
}

export declare type PullRequestMessageResult = {
    posted: boolean;
    providerResult: any
}
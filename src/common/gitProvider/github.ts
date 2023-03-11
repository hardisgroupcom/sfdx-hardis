import { GitProviderRoot } from "./gitProviderRoot";

export class GithubProvider extends GitProviderRoot {

    constructor() {
        super()
    }

    public getLabel(): string {
        return "sfdx-hardis Gitlab connector";
    }

}
import { GitProviderRoot } from "./gitProviderRoot";

export class AzureDevopsProvider extends GitProviderRoot {

    constructor() {
        super()
    }

    public getLabel(): string {
        return "sfdx-hardis Azure Devops connector";
    }

}
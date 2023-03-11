import { GitProviderRoot } from "./gitProviderRoot";

export class AzureDevopsProvider extends GitProviderRoot {

    constructor() {
        super()
    }

    getLabel(): string {
        return "sfdx-hardis Gitlab connector";
      }

}
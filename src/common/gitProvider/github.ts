import { GitProviderRoot } from "./gitProviderRoot";

export class GithubProvider extends GitProviderRoot {

    constructor() {
        super()
    }

    getLabel(): string {
        return "sfdx-hardis Gitlab connector";
      }

}
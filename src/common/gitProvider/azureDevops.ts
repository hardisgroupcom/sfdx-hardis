import { GitProvider } from ".";

export class AzureDevopsProvider extends GitProvider {

    getLabel(): string {
        return "sfdx-hardis Gitlab connector";
      }

}
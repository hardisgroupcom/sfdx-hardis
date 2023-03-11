import { GitProvider } from ".";

export class GithubProvider extends GitProvider {

    getLabel(): string {
        return "sfdx-hardis Gitlab connector";
      }

}
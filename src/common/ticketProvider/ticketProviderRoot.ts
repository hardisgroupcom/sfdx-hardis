import { SfError } from "@salesforce/core";
import c from "chalk";
import { Ticket } from "./index.js";
import { getCurrentGitBranch, uxLog } from "../utils/index.js";

export abstract class TicketProviderRoot {
  public isActive = false;
  protected token: string | null;

  public getLabel(): string {
    throw new SfError("getLabel should be implemented on this call");
  }

  public async collectTicketsInfo(tickets: Ticket[]) {
    uxLog(this, c.yellow("collectTicketsInfo is not implemented on " + this.getLabel()));
    return tickets;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postDeploymentComments(tickets: Ticket[], _org: string, _pullRequestInfo: any) {
    uxLog(this, c.yellow("postDeploymentComments is not implemented on " + this.getLabel()));
    return tickets;
  }

  public async getDeploymentTag(): Promise<string> {
    const currentGitBranch = await getCurrentGitBranch() || "";
    let tag = currentGitBranch.toUpperCase() + "_DEPLOYED";
    if (process.env?.DEPLOYED_TAG_TEMPLATE && !(process.env?.DEPLOYED_TAG_TEMPLATE || "").includes("$(")) {
      tag = process.env?.DEPLOYED_TAG_TEMPLATE.replace("{BRANCH}", currentGitBranch.toUpperCase());
    }
    return tag;
  }
}

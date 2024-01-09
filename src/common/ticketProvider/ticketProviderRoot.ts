import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import { Ticket } from ".";
import { uxLog } from "../utils";

export abstract class TicketProviderRoot {
  public isActive = false;
  protected token: string;

  public getLabel(): string {
    throw new SfdxError("getLabel should be implemented on this call");
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
}

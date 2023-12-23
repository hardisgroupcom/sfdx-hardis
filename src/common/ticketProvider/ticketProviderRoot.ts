import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import { Ticket } from ".";
import { uxLog } from "../utils";

export abstract class TicketProviderRoot {
  protected token: string;

  public getLabel(): string {
    throw new SfdxError("getLabel should be implemented on this call");
  }

  public async collectTicketsInfo(tickets: Ticket[]) {
    uxLog(this, c.yellow("collectTicketsInfo is not implemented on " + this.getLabel()));
    return tickets;
  }
}

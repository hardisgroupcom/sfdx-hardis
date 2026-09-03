import { SfError } from "@salesforce/core";
import c from "chalk";
import { Ticket } from "./index.js";
import { getCurrentGitBranch, uxLog } from "../utils/index.js";
import * as os from "os";
import * as path from "path";
import { CommonPullRequestInfo, GitProvider } from "../gitProvider/index.js";
import {
  TICKET_ATTACHMENT_MAX_BYTES_DEFAULT,
  TicketDetails,
  TicketDetailsOptions,
  downloadTicketAttachment,
} from "./ticketDetails.js";
import { t } from '../utils/i18n.js';

// Issues met while collecting ticket details (ex: expired JIRA token), so the Pull Request
// comment can display why the Tickets section only contains bare links.
const _ticketCollectionIssues: string[] = [];

export function recordTicketCollectionIssue(message: string): void {
  _ticketCollectionIssues.push(message);
}

// Called at the start of each collection cycle, so a comment built after a later,
// successful collection does not display the stale issues of a previous one
export function clearTicketCollectionIssues(): void {
  _ticketCollectionIssues.length = 0;
}

export function getTicketCollectionIssues(): string[] {
  return [..._ticketCollectionIssues];
}

export abstract class TicketProviderRoot {
  public isActive = false;
  protected token: string | null;

  public getLabel(): string {
    throw new SfError("getLabel should be implemented on this call");
  }

  public async collectTicketsInfo(tickets: Ticket[]) {
    uxLog("warning", this, c.yellow(t('collectticketsinfoIsNotImplementedOn') + this.getLabel()));
    return tickets;
  }

  /**
   * Deep fetch of a single ticket: description, comments, links and attachments.
   *
   * collectTicketsInfo() is the bulk counterpart, kept deliberately shallow because it runs on every
   * ticket of a pull request. getTicketDetails() is the opposite: one ticket, everything about it,
   * for a human reading a report or an agent designing a solution from the requirement.
   *
   * Returns null when the provider has no API integration for detailed fetch.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async getTicketDetails(_ticketId: string, _options: TicketDetailsOptions = {}): Promise<TicketDetails | null> {
    uxLog("warning", this, c.yellow(t('getticketdetailsIsNotImplementedOn') + this.getLabel()));
    return null;
  }

  /**
   * Downloads the attachments already listed on `details`, one after the other.
   *
   * Lives here, and takes the credentials as an argument, so that no provider has to expose its
   * authentication headers to the calling command: the credentials never leave the provider.
   */
  protected async downloadDetailsAttachments(
    details: TicketDetails,
    baseUrl: string,
    headers: Record<string, string>,
    options: TicketDetailsOptions
  ): Promise<void> {
    if (options.downloadAttachments === false || details.attachments.length === 0) {
      return;
    }
    const targetDir = options.attachmentsDir || path.join(os.tmpdir(), `sfdx-hardis-ticket-${details.id.replace(/\W/g, "_")}`);
    const maxBytes = options.maxAttachmentBytes || TICKET_ATTACHMENT_MAX_BYTES_DEFAULT;
    let index = 1;
    for (const attachment of details.attachments) {
      await downloadTicketAttachment({ attachment, baseUrl, headers, targetDir, maxBytes, index });
      index++;
    }
    details.attachmentsDir = details.attachments.some((attachment) => attachment.localPath) ? targetDir : null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async postDeploymentComments(tickets: Ticket[], _org: string, _pullRequestInfo: CommonPullRequestInfo | null): Promise<Ticket[]> {
    uxLog("warning", this, c.yellow(t('postdeploymentcommentsIsNotImplementedOn') + this.getLabel()));
    return tickets;
  }

  public async getDeploymentTag(): Promise<string> {
    const currentGitBranch = await getCurrentGitBranch() || "";
    let tag = currentGitBranch.toUpperCase() + "_DEPLOYED";

    if (GitProvider.isDeployBeforeMerge()) {
      const prInfo = await GitProvider.getPullRequestInfo({ useCache: true });
      const targetBranch = prInfo?.targetBranch || process.env.FORCE_TARGET_BRANCH;
      if (targetBranch) {
        tag = targetBranch.toUpperCase() + "_DEPLOYED";
      }
    }

    if (process.env?.DEPLOYED_TAG_TEMPLATE && !(process.env?.DEPLOYED_TAG_TEMPLATE || "").includes("$(")) {
      const branchToUse = tag.replace("_DEPLOYED", "");
      tag = process.env?.DEPLOYED_TAG_TEMPLATE.replace("{BRANCH}", branchToUse);
    }

    return tag;
  }
}

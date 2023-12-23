import { Ticket } from ".";
import { extractRegexMatches } from "../utils";

export class UtilsTickets {
  public static isJiraAvailable() {
    if (
      process.env.JIRA_TOKEN &&
      process.env.JIRA_TOKEN.length > 5 &&
      !process.env.SLACK_TOKEN.includes("JIRA_TOKEN") &&
      process.env.JIRA_HOST &&
      process.env.JIRA_HOST.length > 5 &&
      !process.env.JIRA_HOST.includes("JIRA_HOST") &&
      process.env.JIRA_EMAIL &&
      process.env.JIRA_EMAIL.length > 5 &&
      !process.env.JIRA_EMAIL.includes("JIRA_EMAIL")
    ) {
      return true;
    }
    return false;
  }

  public static async getTicketsFromString(text: string): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    // Extract JIRA tickets
    const jiraUrlRegex = /(https:\/\/.*(jira|atlassian\.net).*\/[A-Z0-9]+-\d+\b)/g;
    const jiraMatches = await extractRegexMatches(jiraUrlRegex, text);
    for (const jiraTicketUrl of jiraMatches) {
      const pattern = /https:\/\/.*\/([A-Z0-9]+-\d+\b)/;
      const match = jiraTicketUrl.match(pattern);
      if (match) {
        if (!tickets.some((ticket) => ticket.url === jiraTicketUrl)) {
          tickets.push({
            provider: "JIRA",
            url: jiraTicketUrl,
            id: match[1],
          });
        }
      }
    }
    return tickets;
  }
}

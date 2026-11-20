import { CommonPullRequestInfo } from '../../../src/common/gitProvider/index.js';
import { DashboardComment, DashboardFormat, DashboardRef } from '../../../src/common/gitProvider/gitProviderRoot.js';

// A git provider kept in memory, with the two behaviors measured on the real ones: a delete that
// answers true to everybody (GitHub, GitLab, Bitbucket) or to the first caller only (Azure DevOps)
export class FakeDashboardProvider {
  public dashboards: Array<{ ref: DashboardRef; title: string; body: string; closed: boolean; comments: DashboardComment[] }> = [];
  public wornOut = false;
  // False like Bitbucket: one open dashboard at a time
  public twoOpenDashboards = true;
  // Ids of the comments this client is not allowed to delete (written by another account)
  public protectedComments = new Set<number>();
  private nextCommentId = 100;

  constructor(private atomicDelete: boolean, private format: DashboardFormat = 'markdown') { }

  supportsDashboard() {
    return true;
  }

  getDashboardTitle(title: string) {
    return title;
  }

  allowsTwoOpenDashboards() {
    return this.twoOpenDashboards;
  }

  getDashboardFormat() {
    return this.format;
  }

  async findDashboard(title: string) {
    await this.networkDelay();
    return this.dashboards.find((dashboard) => dashboard.title === title && !dashboard.closed)?.ref || null;
  }

  async createDashboard(title: string, body: string) {
    const ref = { id: this.dashboards.length + 1, url: `https://example.com/dashboard/${this.dashboards.length + 1}` };
    this.dashboards.push({ ref, title, body, closed: false, comments: [] });
    return ref;
  }

  async updateDashboardBody(ref: DashboardRef, _title: string, body: string) {
    this.get(ref).body = body;
  }

  public listDashboardCommentsCalls = 0;

  async listDashboardComments(ref: DashboardRef) {
    this.listDashboardCommentsCalls++;
    await this.networkDelay();
    return this.get(ref).comments.map((comment) => ({ ...comment }));
  }

  async createDashboardComment(ref: DashboardRef, body: string) {
    await this.networkDelay();
    const id = this.nextCommentId++;
    this.get(ref).comments.push({ id, body, createdDate: new Date().toISOString() });
    return id;
  }

  async deleteDashboardComment(ref: DashboardRef, commentId: number) {
    if (this.protectedComments.has(commentId)) {
      throw new Error('403 Forbidden');
    }
    // The comment is looked up before the delay: simultaneous callers all find it
    const found = this.get(ref).comments.some((comment) => comment.id === commentId);
    await this.networkDelay();
    const stillThere = this.get(ref).comments.some((comment) => comment.id === commentId);
    this.get(ref).comments = this.get(ref).comments.filter((comment) => comment.id !== commentId);
    return this.atomicDelete ? stillThere : found;
  }

  // Merged Pull Requests answered by listPullRequests, and the filters it was called with
  public mergedPullRequests: CommonPullRequestInfo[] = [];
  public listPullRequestsCalls: any[] = [];

  async listPullRequests(filters: any = {}) {
    this.listPullRequestsCalls.push(filters);
    return this.mergedPullRequests.filter(
      (pr) => (!filters.targetBranch || pr.targetBranch === filters.targetBranch) && (!filters.minDate || Date.parse(pr.mergedDate || '') >= filters.minDate.getTime())
    );
  }

  async isDashboardWornOut() {
    return this.wornOut;
  }

  async closeDashboard(ref: DashboardRef) {
    this.get(ref).closed = true;
    this.wornOut = false;
  }

  current() {
    return this.dashboards.find((dashboard) => !dashboard.closed)!;
  }

  private get(ref: DashboardRef) {
    return this.dashboards.find((dashboard) => dashboard.ref.id === ref.id)!;
  }

  private async networkDelay() {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
  }
}

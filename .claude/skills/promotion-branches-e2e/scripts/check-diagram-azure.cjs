// Feeds the vscode-sfdx-hardis promotion helpers with the real Pull Requests of the Azure DevOps
// test repository, and asserts that a Pull Request number appears in a single branch window.
//
//   EXT=C:/git/vscode-sfdx-hardis AZ_ORG=... AZ_PROJECT=... AZ_TOKEN=... \
//     node check-diagram-azure.cjs <repository id or name> [branch,branch,...]
//
// The extension must be compiled first (cd $EXT && yarn dev), on the branch under test: this
// script calls its compiled helpers rather than reimplementing the rules, so what it proves is
// what the pipeline actually does.
const { execFileSync } = require("child_process");
const path = require("path");

const EXT = process.env.EXT || "C:/git/vscode-sfdx-hardis";
const HELPERS = path.join(EXT, "out/utils/pipeline/promotionBranchUtils.js");
let M;
try {
  M = require(HELPERS);
} catch (e) {
  console.error(`Cannot load ${HELPERS}: compile the extension first (cd ${EXT} && yarn dev)`);
  console.error(String(e));
  process.exit(2);
}

const REPO = process.argv[2];
const AZ_ORG = process.env.AZ_ORG;
const AZ_PROJECT = process.env.AZ_PROJECT;
const AZ_TOKEN = process.env.AZ_TOKEN;
if (!REPO || !AZ_ORG || !AZ_PROJECT || !AZ_TOKEN) {
  console.error("Usage: EXT=<path> AZ_ORG=<org> AZ_PROJECT=<project> AZ_TOKEN=<pat> node check-diagram-azure.cjs <repo> [branches]");
  process.exit(2);
}
const BRANCHES = (process.argv[3] || "integration,uat,preprod,main").split(",");
const CONFIG = { enabled: true };
const API = `https://dev.azure.com/${AZ_ORG}/${AZ_PROJECT}/_apis/git/repositories/${REPO}`;

const az = (apiPath) =>
  JSON.parse(
    execFileSync("curl", ["-sS", "-u", `:${AZ_TOKEN}`, `${API}/${apiPath}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );

// Azure DevOps truncates the description of a Pull Request returned by the list API to 400
// characters, with no marker saying so, which is exactly what hides a promotionPullRequests
// declaration. Read the full Pull Request whenever the listed one could have been cut - the same
// thing AzureDevopsProvider.completeTruncatedDescription does in the CLI.
const LIST_DESCRIPTION_TRUNCATION_LENGTH = 400;
const fullDescription = (pr) => {
  const listed = pr.description || "";
  if (listed.length < LIST_DESCRIPTION_TRUNCATION_LENGTH) {
    return listed;
  }
  return az(`pullrequests/${pr.pullRequestId}?api-version=7.1`).description || listed;
};

// Same normalisation as GitProviderAzure.convertToPullRequest / mapAzureStatusToState
const mapState = (pr) => {
  if (pr.status === "active") return "open";
  if (pr.status === "abandoned") return "declined";
  if (pr.status === "completed") return pr.mergeStatus === "succeeded" ? "merged" : "closed";
  return "open";
};

const raw = az("pullrequests?searchCriteria.status=all&$top=500&api-version=7.1").value;
const all = raw.map((pr) => ({
  id: pr.pullRequestId,
  number: pr.pullRequestId,
  title: pr.title || "",
  description: fullDescription(pr),
  sourceBranch: (pr.sourceRefName || "").replace(/^refs\/heads\//, ""),
  targetBranch: (pr.targetRefName || "").replace(/^refs\/heads\//, ""),
  authorLabel: (pr.createdBy && pr.createdBy.displayName) || "unknown",
  state: mapState(pr),
  webUrl: `https://dev.azure.com/${AZ_ORG}/${AZ_PROJECT}/_git/${REPO}/pullrequest/${pr.pullRequestId}`,
  mergeDate: pr.status === "completed" && pr.closedDate ? pr.closedDate : undefined,
  jobsStatus: "unknown",
}));

// Each branch window: the Pull Requests merged into it (the real windows are bounded by the
// last merge, this is a superset, which only makes the duplicate check stricter)
const windows = new Map();
for (const branch of BRANCHES) {
  windows.set(
    branch,
    all.filter((pr) => pr.targetBranch === branch && pr.state === "merged").map((pr) => ({ ...pr })),
  );
}

// Expansion, exactly like completeMajorOrgsWithPromotionBranches does
const known = new Map(all.map((pr) => [pr.number, pr]));
(async () => {
  for (const branch of BRANCHES) {
    const { all: expanded } = await M.expandPullRequestsWithPromotions(
      windows.get(branch),
      CONFIG,
      known,
      async (n) => known.get(n) || null,
    );
    windows.set(branch, expanded);
  }
  const promotions = [];
  for (const branch of BRANCHES) {
    for (const pr of windows.get(branch)) {
      if (M.isPromotionPullRequest(pr, CONFIG) && M.isMergedPullRequest(pr)) {
        promotions.push(pr);
      }
    }
  }
  const index = M.buildPromotionIndex(promotions, CONFIG);
  for (const branch of BRANCHES) {
    M.annotateAlreadyPromoted(windows.get(branch), branch, index, CONFIG);
  }
  // Same last step as the extension: the invariant is enforced on the windows themselves
  M.enforceSinglePlacePerPullRequest(
    BRANCHES.map((branch) => ({ branchName: branch, pullRequests: windows.get(branch) })),
    CONFIG,
  );

  const places = new Map();
  console.log("Branch   | node counter | Pull Requests listed");
  console.log("---------|--------------|---------------------");
  for (const branch of BRANCHES) {
    // Same rule as the extension: not carried away, and User Stories only (no promotion or
    // major-to-major Pull Request) unless the toggles say otherwise
    const visible = M.userStoryPullRequests(M.visiblePullRequests(windows.get(branch)), BRANCHES, CONFIG);
    console.log(
      `${branch.padEnd(8)} | ${String(visible.length).padEnd(12)} | ${visible.map((pr) => "#" + pr.number).join(", ")}`,
    );
    for (const pr of visible) {
      places.set(pr.number, [...(places.get(pr.number) || []), branch]);
    }
  }
  const duplicates = [...places.entries()].filter(([, branches]) => branches.length > 1);
  console.log("");
  console.log(
    duplicates.length === 0
      ? "OK: every Pull Request number appears in a single branch"
      : "DUPLICATES: " + duplicates.map(([n, b]) => `#${n} in ${b.join(" and ")}`).join("; "),
  );
  const withToggle = BRANCHES.map(
    (b) => `${b}=${M.userStoryPullRequests(M.visiblePullRequests(windows.get(b), true), BRANCHES, CONFIG).length}`,
  ).join(" ");
  console.log("With 'show already promoted' on: " + withToggle);
  const withPromotions = BRANCHES.map(
    (b) => `${b}=${M.userStoryPullRequests(M.visiblePullRequests(windows.get(b)), BRANCHES, CONFIG, true).length}`,
  ).join(" ");
  console.log("With 'show merge and promotion Pull Requests' on: " + withPromotions);
  process.exit(duplicates.length === 0 ? 0 : 1);
})();

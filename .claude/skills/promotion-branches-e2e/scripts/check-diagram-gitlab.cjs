// Feeds the vscode-sfdx-hardis promotion helpers with the real Pull Requests of the test
// repository, and asserts that a Pull Request number appears in a single branch window.
//
//   EXT=C:/git/vscode-sfdx-hardis GL_HOST=... GL_TOKEN=... \n//     node check-diagram-gitlab.cjs <project id> [branch,branch,...]
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

const PROJECT = process.argv[2];
if (!PROJECT) {
  console.error("Usage: EXT=<path> GL_HOST=<url> GL_TOKEN=<token> node check-diagram-gitlab.cjs <project id> [branches]");
  process.exit(2);
}
const GL_HOST = process.env.GL_HOST;
const GL_TOKEN = process.env.GL_TOKEN;
if (!GL_HOST || !GL_TOKEN) {
  console.error("GL_HOST and GL_TOKEN are required");
  process.exit(2);
}
const BRANCHES = (process.argv[3] || "integration,uat,preprod,main").split(",");
const CONFIG = { enabled: true };

// curl rather than fetch: the self-hosted GitLab is behind a corporate CA that node accepts only
// through the system store, which curl uses
const gl = (path) =>
  JSON.parse(
    execFileSync("curl", ["-sS", "-H", `PRIVATE-TOKEN: ${GL_TOKEN}`, `${GL_HOST}/api/v4/${path}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );

const all = gl(`projects/${PROJECT}/merge_requests?state=all&per_page=100`).map((mr) => ({
  id: mr.id,
  number: mr.iid,
  title: mr.title,
  description: mr.description || "",
  sourceBranch: mr.source_branch,
  targetBranch: mr.target_branch,
  authorLabel: mr.author && mr.author.username,
  // Same normalisation as GitProviderGitlab.convertToPullRequest
  state: mr.state === "merged" ? "merged" : mr.state === "closed" ? "closed" : "open",
  webUrl: mr.web_url,
  mergeDate: mr.merged_at || undefined,
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

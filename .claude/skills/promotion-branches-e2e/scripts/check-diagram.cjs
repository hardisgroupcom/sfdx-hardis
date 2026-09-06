// Feeds the vscode-sfdx-hardis promotion helpers with the real Pull Requests of the test
// repository, and asserts that a Pull Request number appears in a single branch window.
//
//   EXT=C:/git/vscode-sfdx-hardis node check-diagram.cjs <owner>/<repo> [branch,branch,...]
//
// The extension must be compiled first (cd $EXT && yarn dev), on the branch under test: this
// script calls its compiled helpers rather than reimplementing the rules, so what it proves is
// what the pipeline actually does.
const { execSync } = require("child_process");
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
if (!REPO) {
  console.error("Usage: EXT=<vscode-sfdx-hardis path> node check-diagram.cjs <owner>/<repo> [branches]");
  process.exit(2);
}
const BRANCHES = (process.argv[3] || "integration,uat,preprod,main").split(",");
const CONFIG = { enabled: true };

const gh = (apiPath) =>
  JSON.parse(execSync(`gh api "${apiPath}" --paginate`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));

const all = gh(`repos/${REPO}/pulls?state=all&per_page=100`).map((pr) => ({
  id: pr.id,
  number: pr.number,
  title: pr.title,
  description: pr.body || "",
  sourceBranch: pr.head.ref,
  targetBranch: pr.base.ref,
  authorLabel: pr.user && pr.user.login,
  // Same normalisation as GitProviderGitHub.convertToPullRequest
  state: pr.merged_at ? "merged" : pr.state,
  webUrl: pr.html_url,
  mergeDate: pr.merged_at || undefined,
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

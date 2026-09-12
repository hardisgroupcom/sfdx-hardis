// Asserts what the vscode-sfdx-hardis DevOps Pipeline shows for the test repository, at a given
// point of the run: the User Stories each branch node lists, its counter bubble, and the open
// promotion drawn on the arrow between two major branches.
//
//   EXT=C:/git/vscode-sfdx-hardis WORK=/c/tmp/promo-e2e \
//     node check-pipeline.cjs <expectations.json> [--dump observed.json]
//
// Unlike check-diagram*.cjs, this one fetches nothing of its own: it drives the extension's own
// PipelineDataProvider, so listPullRequestsInBranchSinceLastMerge, the promotion expansion, the
// single-place invariant and the mermaid builder all run exactly as they do in the webview. That
// is the point: the diagram scripts prove the rules, this one proves what the user sees.
//
// It needs the extension compiled with tsc (cd $EXT && yarn compile) and the provider token in
// PROVIDER_TOKEN. The extension reads its token from a secret named after the remote host, dots
// replaced by underscores and uppercased, plus _TOKEN (GITHUB_COM_TOKEN, DEV_AZURE_COM_TOKEN, and
// GITLAB_HARDIS-GROUP_COM_TOKEN, whose hyphen a shell cannot even export), so this script reads
// the remote itself and puts the token under the right name.
//
// Expectations file (every key optional, only what is present is asserted):
//   {
//     "label": "before the integration -> uat promotion",
//     "windows":  { "integration": [1, 2, 3], "uat": [] },
//     "counters": { "integration": 3 },
//     "arrows":   { "integration>uat": 7, "uat>preprod": null },
//     "noFeatureNodeFor": ["promotion/integration/uat/2026-09-08-1"],
//     "promotionSteps": ["uat>preprod"]
//   }
// "windows" lists the User Story numbers the branch node must show, order free. "arrows" gives the
// number of the open Pull Request drawn on a merge edge, or null for "no Pull Request chip there".

const path = require("path");
const fs = require("fs");

const EXT = process.env.EXT || "C:/git/vscode-sfdx-hardis";
const WORK = process.env.WORK;
if (!WORK) {
  console.error("WORK must point at the local clone of the test repository");
  process.exit(2);
}

// ---------------------------------------------------------------- vscode stub
const Module = require("module");
const origLoad = Module._load;
const vscodeStub = {
  workspace: {
    getConfiguration: () => ({ get: () => undefined, has: () => false, update: async () => {} }),
    workspaceFolders: [{ uri: { path: WORK, fsPath: WORK }, name: "e2e", index: 0 }],
    onDidChangeConfiguration: () => ({ dispose() {} }),
    fs: {},
  },
  env: { language: "en" },
  window: {
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    withProgress: async (_o, task) => task({ report() {} }, { isCancellationRequested: false }),
  },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => undefined },
  Uri: { file: (p) => ({ fsPath: p, path: p }) },
  EventEmitter: class {
    constructor() {
      this.event = () => ({ dispose() {} });
    }
    fire() {}
    dispose() {}
  },
  ProgressLocation: { Notification: 15, Window: 10 },
  ExtensionMode: { Development: 1, Production: 2, Test: 3 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
};
Module._load = function (request) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return origLoad.apply(this, arguments);
};

process.chdir(WORK);

const req = (rel) => {
  const file = path.join(EXT, "out", rel);
  try {
    return require(file);
  } catch (e) {
    console.error(`Cannot load ${file}: compile the extension first (cd ${EXT} && yarn compile)`);
    console.error(String(e));
    process.exit(2);
  }
};

const { SecretsManager } = req("utils/secretsManager.js");
SecretsManager.init({
  secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
});

// The provider caches its resolved project id in the extension's global state. An in-memory store
// gives every invocation a cold cache, which is what a check run right after a merge needs: a
// stale answer here would look exactly like the defect being hunted.
const memory = new Map();
req("utils/cache-manager.js").CacheManager.init(
  {
    get: (key, fallback) => (memory.has(key) ? memory.get(key) : fallback),
    update: async (key, value) => {
      memory.set(key, value);
    },
    keys: () => [...memory.keys()],
  },
  path.join(require("os").tmpdir(), "sfdx-hardis-pipeline-check"),
);

// Put the token where the extension looks for it, under the host-derived secret name
if (process.env.PROVIDER_TOKEN) {
  const remote = require("child_process")
    .execSync("git remote get-url origin", { cwd: WORK, encoding: "utf8" })
    .trim();
  const host = (remote.match(/^(?:https?:\/\/(?:[^@]+@)?|git@)([^/:]+)/) || [])[1];
  if (!host) {
    console.error(`Cannot read the host out of the origin remote: ${remote}`);
    process.exit(2);
  }
  process.env[host.replace(/\./g, "_").toUpperCase() + "_TOKEN"] = process.env.PROVIDER_TOKEN;
  if (process.env.PROVIDER_EMAIL) {
    process.env[host.replace(/\./g, "_").toUpperCase() + "_BITBUCKET_EMAIL"] =
      process.env.PROVIDER_EMAIL;
  }
}

const { GitProvider } = req("utils/gitProviders/gitProvider.js");
const { PipelineDataProvider } = req("pipeline-data-provider.js");

// ------------------------------------------------------------------ arguments
const args = process.argv.slice(2);
let expectFile = null;
let dumpFile = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dump") {
    dumpFile = args[++i];
  } else if (!expectFile) {
    expectFile = args[i];
  }
}
const expected =
  expectFile && fs.existsSync(expectFile) ? JSON.parse(fs.readFileSync(expectFile, "utf8")) : {};

// Reads the hidden counter bubble and the merge edges back out of the mermaid the webview renders,
// so a check reads the diagram itself rather than the numbers that went into it.
function readDiagram(mermaid) {
  const counters = {};
  // A node line is `name("label"):::class`, `name(["label"])` or `name@{ shape: ..., label: "..." }`
  const nodeNameRe = /^\s*([A-Za-z0-9_-]+)\s*(?:\(\[|\(|\[|@\{)/;
  const countRe = /data-count='(\d+)' data-count-all='(\d+)'/;
  const edgeRe = /^\s*([A-Za-z0-9_-]+)\s*[=.-]+>\|"(.*)"\|\s*([A-Za-z0-9_-]+)\s*$/;
  const nodes = [];
  const edges = [];
  for (const line of String(mermaid).split("\n")) {
    const node = line.match(nodeNameRe);
    if (node && !/^\s*(?:class|classDef|click|linkStyle|style|subgraph|flowchart|graph)/.test(line)) {
      nodes.push(node[1]);
      const counted = line.match(countRe);
      if (counted) {
        counters[node[1]] = { count: Number(counted[1]), countAll: Number(counted[2]) };
      }
    }
    const edge = line.match(edgeRe);
    if (edge) {
      const chip = edge[2].match(/>#(\d+)</);
      edges.push({
        source: edge[1],
        target: edge[3],
        label: edge[2],
        prNumber: chip ? Number(chip[1]) : null,
      });
    }
  }
  return { counters, nodes, edges };
}

const sanitize = (branch) =>
  String(branch || "unknown")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/-+/g, "-");

const failures = [];
const same = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);

(async () => {
  const provider = await GitProvider.getInstance(true);
  if (!provider || !provider.isActive) {
    console.error(
      "No active git provider for " +
        WORK +
        ": check the remote of the clone and the <HOST>_TOKEN environment variable",
    );
    process.exit(2);
  }
  const openPullRequests = await provider.listOpenPullRequests();
  const data = await new PipelineDataProvider().getPipelineData(true, {
    browseGitProvider: true,
    openPullRequests,
  });

  const promotionConfig = data.promotionBranches || { enabled: false, allowedSteps: [] };
  const { userStoryPullRequests, visiblePullRequests } = req(
    "utils/pipeline/promotionBranchUtils.js",
  );
  const branchNames = data.orgs.map((org) => org.name);
  const diagram = readDiagram(data.mermaidDiagram);

  const observed = {
    label: expected.label || "",
    windows: {},
    counters: {},
    arrows: {},
    nodes: diagram.nodes,
    // The steps the DevOps Pipeline offers "Create promotion" on, from allowedPromotionSteps
    promotionSteps: (promotionConfig.allowedSteps || [])
      .map((step) => `${step.source}>${step.target}`)
      .sort(),
  };
  for (const org of data.orgs) {
    const window = org.pullRequestsInBranchSinceLastMerge || [];
    observed.windows[org.name] = userStoryPullRequests(
      visiblePullRequests(window),
      branchNames,
      promotionConfig,
    )
      .map((pr) => Number(pr.number))
      .sort((a, b) => a - b);
    const counter = diagram.counters[sanitize(org.name) + "Branch"];
    observed.counters[org.name] = counter ? counter.count : 0;
  }
  for (const link of data.links || []) {
    const edge = diagram.edges.find(
      (e) =>
        e.source === sanitize(link.source) + "Branch" &&
        e.target === sanitize(link.target) + "Branch",
    );
    observed.arrows[`${link.source}>${link.target}`] = edge ? edge.prNumber : null;
  }

  // ------------------------------------------------------------------ report
  console.log(`Pipeline check${expected.label ? ": " + expected.label : ""}`);
  console.log("");
  console.log("Branch       | counter | User Stories listed");
  console.log("-------------|---------|--------------------");
  for (const name of Object.keys(observed.windows)) {
    console.log(
      `${name.padEnd(12)} | ${String(observed.counters[name]).padEnd(7)} | ${observed.windows[name]
        .map((n) => "#" + n)
        .join(", ")}`,
    );
  }
  console.log("");
  console.log(
    `Create promotion offered on: ${observed.promotionSteps.join(", ") || "nothing"}`,
  );
  console.log("");
  console.log("Merge arrow                | open Pull Request drawn on it");
  console.log("---------------------------|------------------------------");
  for (const [arrow, pr] of Object.entries(observed.arrows)) {
    console.log(`${arrow.padEnd(26)} | ${pr === null ? "-" : "#" + pr}`);
  }

  // ------------------------------------------------------------- assertions
  const places = new Map();
  for (const [branch, numbers] of Object.entries(observed.windows)) {
    for (const n of numbers) {
      places.set(n, [...(places.get(n) || []), branch]);
    }
  }
  for (const [n, branches] of places) {
    if (branches.length > 1) {
      failures.push(
        `#${n} is listed in ${branches.join(" and ")}: a Pull Request belongs to one branch only`,
      );
    }
  }

  for (const [branch, numbers] of Object.entries(expected.windows || {})) {
    const want = [...numbers].map(Number).sort((a, b) => a - b);
    const got = observed.windows[branch];
    if (!got) {
      failures.push(`branch ${branch} is not in the pipeline`);
    } else if (!same(want, got)) {
      failures.push(
        `${branch} lists ${got.map((n) => "#" + n).join(", ") || "nothing"}, expected ${
          want.map((n) => "#" + n).join(", ") || "nothing"
        }`,
      );
    }
  }
  if (expected.promotionSteps) {
    const want = [...expected.promotionSteps].sort();
    if (!same(want, observed.promotionSteps)) {
      failures.push(
        `the pipeline offers Create promotion on ${observed.promotionSteps.join(", ") || "nothing"}, expected ${want.join(", ") || "nothing"}`,
      );
    }
  }
  for (const [branch, count] of Object.entries(expected.counters || {})) {
    if (observed.counters[branch] !== Number(count)) {
      failures.push(`the counter of ${branch} says ${observed.counters[branch]}, expected ${count}`);
    }
  }
  // The counter bubble and the list under it are the same rule applied twice: a difference means
  // the webview shows a number the modal cannot explain.
  for (const [branch, numbers] of Object.entries(observed.windows)) {
    if (observed.counters[branch] !== numbers.length) {
      failures.push(
        `the counter of ${branch} says ${observed.counters[branch]} but it lists ${numbers.length} User Stories`,
      );
    }
  }
  for (const [arrow, pr] of Object.entries(expected.arrows || {})) {
    if (!(arrow in observed.arrows)) {
      failures.push(`there is no ${arrow} merge arrow in the pipeline`);
    } else if (pr === null && observed.arrows[arrow] !== null) {
      failures.push(`the ${arrow} arrow draws #${observed.arrows[arrow]}, expected no Pull Request`);
    } else if (pr !== null && observed.arrows[arrow] !== Number(pr)) {
      failures.push(
        `the ${arrow} arrow draws ${
          observed.arrows[arrow] === null ? "no Pull Request" : "#" + observed.arrows[arrow]
        }, expected #${pr}`,
      );
    }
  }
  // A promotion drawn on an arrow must not also get a feature branch node of its own
  for (const branch of expected.noFeatureNodeFor || []) {
    const node = sanitize(branch) + "Branch";
    if (diagram.nodes.includes(node)) {
      failures.push(`${branch} has a feature branch node of its own: it belongs on the merge arrow`);
    }
  }

  if (dumpFile) {
    fs.writeFileSync(dumpFile, JSON.stringify(observed, null, 2));
  }
  console.log("");
  if (failures.length === 0) {
    console.log("OK: the DevOps Pipeline shows what this point of the run expects");
    process.exit(0);
  }
  for (const failure of failures) {
    console.log("FAIL: " + failure);
  }
  process.exit(1);
})().catch((e) => {
  console.error(String((e && e.stack) || e));
  process.exit(2);
});

// Asserts what the vscode-sfdx-hardis DevOps Pipeline shows for the test repository, at a given
// point of the run: the User Stories each branch node lists, its counter bubble, and the open
// promotion drawn on the arrow between two major branches.
//
//   EXT=<vscode-sfdx-hardis clone, default ../vscode-sfdx-hardis> WORK=<local clone> \
//     node check-pipeline.cjs <expectations.json> [--dump observed.json] [--now <ISO date>]
//
// --now <ISO date> makes Date.now() and new Date() (no argument) answer that time, before any
// module of the extension is loaded: the staleness of a major branch deployment check is computed
// with the current time, so a check can be made "25 hours old" without waiting 25 hours.
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
//
// Major branch deployment check (enableMajorBranchDeploymentCheck), optional keys too:
//   {
//     "majorBranchDeploymentCheckEnabled": true,
//     "deployArrows": { "integration": "success" },
//     "branchChecks": {
//       "integration": { "status": "failed", "stale": false, "staleReason": null },
//       "uat": { "status": ["running", "pending"] },
//       "main": null
//     },
//     "nodeClasses": { "integration": "gitBranchCheckFailed", "main": "gitMain" },
//     "checkLinks": true
//   }
// "deployArrows" is the status of the deployment arrow of a branch to its org: the jobsStatus of
// the sfDeploy link the mermaid builder made for it (success, failed, running, pending, unknown).
// "branchChecks" compares the listed keys of orgs[].majorBranchCheck (an array accepts any of its
// values, an absent key reads null); null means the branch has no check at all.
// "nodeClasses" reads the classes of the branch node out of the generated mermaid text, in the full
// diagram and in the major branches one: the node must carry that class and no other
// gitBranchCheck* class (gitMajor / gitMain therefore means "no check class at all").
// "checkLinks": every majorBranchCheck.webUrl is an http(s) URL on the host of the origin remote.
//
// Development orgs (enableDevOrgsRegistry), optional keys too:
//   {
//     "devOrgsFile": "<file holding the output of sf hardis:project:dev-org:list --json>",
//     "devOrgNodes": { "devOrgs": { "<orgId>": 1, "<other>": null }, "featureBranches": { "<orgId>": null } }
//   }
// "devOrgsFile" gives the extension the answer of the CLI, the way showPipeline.ts does.
// "devOrgNodes" reads the diagram of each view of the header switch (devOrgs, featureBranches): a
// number or "2+" is the "to backpromote" chip on the arrow that reaches the node of the org, "none"
// a node without chip, null no node for that org.

const path = require("path");
const fs = require("fs");

// ------------------------------------------------------------------ --now: a fixed current time
// Set before anything of the extension is loaded, so every Date.now() and new Date() it runs
// answers the fixed time. Date(...) called without new keeps its string answer, of the fixed time.
const nowArgIndex = process.argv.indexOf("--now");
if (nowArgIndex > 1) {
  const fixedNow = Date.parse(process.argv[nowArgIndex + 1] || "");
  if (Number.isNaN(fixedNow)) {
    console.error(`--now needs an ISO date, got "${process.argv[nowArgIndex + 1] || ""}"`);
    process.exit(2);
  }
  const RealDate = Date;
  const FixedDate = function (...dateArgs) {
    if (!new.target) {
      return new RealDate(fixedNow).toString();
    }
    return dateArgs.length === 0 ? new RealDate(fixedNow) : new RealDate(...dateArgs);
  };
  Object.setPrototypeOf(FixedDate, RealDate);
  FixedDate.prototype = RealDate.prototype;
  FixedDate.now = () => fixedNow;
  global.Date = FixedDate;
}

const EXT = require('./env-lib.cjs').extDir();
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

// The origin remote of the clone and its host (no user, no port)
function readRemote() {
  const remote = require("child_process")
    .execSync("git remote get-url origin", { cwd: WORK, encoding: "utf8" })
    .trim();
  return { remote, host: (remote.match(/^(?:https?:\/\/(?:[^@]+@)?|git@)([^/:]+)/) || [])[1] };
}

// Put the token where the extension looks for it, under the host-derived secret name
if (process.env.PROVIDER_TOKEN) {
  const { remote, host } = readRemote();
  if (!host) {
    console.error(`Cannot read the host out of the origin remote: ${remote}`);
    process.exit(2);
  }
  process.env[host.replace(/\./g, "_").toUpperCase() + "_TOKEN"] = process.env.PROVIDER_TOKEN;
  // The Bitbucket provider of the extension reads <HOST>_BITBUCKET_TOKEN, not <HOST>_TOKEN
  // (gitProviderBitbucket.ts initialize)
  if (/bitbucket/i.test(host)) {
    process.env[host.replace(/\./g, "_").toUpperCase() + "_BITBUCKET_TOKEN"] = process.env.PROVIDER_TOKEN;
  }
  if (process.env.PROVIDER_EMAIL) {
    process.env[host.replace(/\./g, "_").toUpperCase() + "_BITBUCKET_EMAIL"] =
      process.env.PROVIDER_EMAIL;
  }
}

const { GitProvider } = req("utils/gitProviders/gitProvider.js");
const { PipelineDataProvider } = req("pipeline-data-provider.js");

// The deployment arrows: the sfDeploy links of each build of the mermaid builder, kept as the
// builder made them (the rendered edge only carries a style, not the status it came from)
const builds = [];
const { BranchStrategyMermaidBuilder } = req("utils/pipeline/branchStrategyMermaidBuilder.js");
const originalBuild = BranchStrategyMermaidBuilder.prototype.build;
BranchStrategyMermaidBuilder.prototype.build = function (options) {
  const result = originalBuild.apply(this, arguments);
  builds.push({
    onlyMajorBranches: !!(options && options.onlyMajorBranches),
    deployLinks: (this.deployLinks || []).map((link) => ({
      source: link.source,
      target: link.target,
      type: link.type,
      jobsStatus: link.jobsStatus,
    })),
  });
  return result;
};

// ------------------------------------------------------------------ arguments
const args = process.argv.slice(2);
let expectFile = null;
let dumpFile = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dump") {
    dumpFile = args[++i];
  } else if (args[i] === "--now") {
    i++; // read at the top of the script
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
  // The marker only exists when the branch holds at least one User Story: no marker means zero
  const countRe = /data-count='(\d+)'/;
  const edgeRe = /^\s*([A-Za-z0-9_-]+)\s*[=.-]+>\|"(.*)"\|\s*([A-Za-z0-9_-]+)\s*$/;
  const nodes = [];
  const edges = [];
  for (const line of String(mermaid).split("\n")) {
    const node = line.match(nodeNameRe);
    if (node && !/^\s*(?:class|classDef|click|linkStyle|style|subgraph|flowchart|graph)/.test(line)) {
      nodes.push(node[1]);
      const counted = line.match(countRe);
      if (counted) {
        counters[node[1]] = { count: Number(counted[1]) };
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

// The classes of every node of a mermaid text: `name("label"):::class` and `class a,b class` lines
function readNodeClasses(mermaid) {
  const classes = {};
  const add = (node, cls) => {
    classes[node] = [...(classes[node] || []), cls];
  };
  for (const line of String(mermaid).split("\n")) {
    const inline = line.match(/^\s*([A-Za-z0-9_-]+)\s*(?:\(\[|\(|\[|@\{).*:::([A-Za-z0-9_-]+)\s*$/);
    if (inline) {
      add(inline[1], inline[2]);
    }
    const assigned = line.match(/^\s*class\s+([A-Za-z0-9_,-]+)\s+([A-Za-z0-9_-]+)\s*;?\s*$/);
    if (assigned) {
      for (const node of assigned[1].split(",")) {
        add(node, assigned[2]);
      }
    }
  }
  return classes;
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
  let devOrgs;
  if (expected.devOrgsFile) {
    const answer = JSON.parse(fs.readFileSync(expected.devOrgsFile, "utf8").replace(/^[^{]*/, ""));
    const outcome = req("utils/pipeline/devOrgsUtils.js").readDevOrgsOutcome({ status: 0, result: answer.result || answer });
    if (!outcome.devOrgs) {
      console.error("devOrgsFile is not an answer of sf hardis:project:dev-org:list: " + JSON.stringify(outcome.error));
      process.exit(2);
    }
    devOrgs = outcome.devOrgs;
  }
  const data = await new PipelineDataProvider().getPipelineData(true, {
    browseGitProvider: true,
    openPullRequests,
    devOrgs,
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
    // detectManualCherryPicks: the pill of each visible row, dumped only (manual-cherry-picks scenario)
    const flags = {};
    for (const pr of visiblePullRequests(window)) {
      const flag = pr.manualCherryPick
        ? `cherry-picked into ${pr.manualCherryPick.targetBranch}${pr.manualCherryPick.releasePullRequest ? " via !" + pr.manualCherryPick.releasePullRequest : ""}`
        : pr.partiallyCherryPicked
          ? `partially in ${pr.partiallyCherryPicked.targetBranch}`
          : pr.probablyCherryPicked
            ? `probably in ${pr.probablyCherryPicked.targetBranch}`
            : pr.carriesManualCherryPicks
              ? "carrier"
              : "";
      if (flag) {
        flags[Number(pr.number)] = flag;
      }
    }
    if (Object.keys(flags).length > 0) {
      observed.flags = observed.flags || {};
      observed.flags[org.name] = flags;
    }
  }
  for (const link of data.links || []) {
    const edge = diagram.edges.find(
      (e) =>
        e.source === sanitize(link.source) + "Branch" &&
        e.target === sanitize(link.target) + "Branch",
    );
    observed.arrows[`${link.source}>${link.target}`] = edge ? edge.prNumber : null;
  }

  // Major branch deployment check: the check of each org, its deployment arrow, its node classes
  observed.majorBranchDeploymentCheckEnabled =
    data.majorBranchDeploymentCheckEnabled === undefined ? null : data.majorBranchDeploymentCheckEnabled;
  observed.majorBranchDeploymentCheckValidityHours =
    data.majorBranchDeploymentCheckValidityHours === undefined ? null : data.majorBranchDeploymentCheckValidityHours;
  observed.branchChecks = {};
  observed.deployArrows = {};
  observed.nodeClasses = {};
  const fullBuild = builds.find((b) => !b.onlyMajorBranches) || builds[0] || { deployLinks: [] };
  const diagrams = { full: data.mermaidDiagram, major: data.mermaidDiagramMajor };
  const classesByDiagram = {};
  for (const [kind, text] of Object.entries(diagrams)) {
    if (typeof text === "string" && text.includes("Branch")) {
      classesByDiagram[kind] = readNodeClasses(text);
      observed.nodeClasses[kind] = {};
    }
  }
  for (const org of data.orgs) {
    observed.branchChecks[org.name] = org.majorBranchCheck === undefined ? null : org.majorBranchCheck;
    const node = sanitize(org.name) + "Branch";
    const deploy = fullBuild.deployLinks.find((l) => l.type === "sfDeploy" && l.source === node);
    observed.deployArrows[org.name] = deploy
      ? deploy.jobsStatus || "unknown"
      : org.jobsStatus === undefined
        ? null
        : org.jobsStatus;
    for (const kind of Object.keys(classesByDiagram)) {
      observed.nodeClasses[kind][org.name] = classesByDiagram[kind][node] || null;
    }
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
  console.log("");
  console.log(
    `Major branch deployment check: ${observed.majorBranchDeploymentCheckEnabled === null ? "not reported" : observed.majorBranchDeploymentCheckEnabled ? "on" : "off"}` +
      (observed.majorBranchDeploymentCheckValidityHours !== null ? `, valid ${observed.majorBranchDeploymentCheckValidityHours}h` : ""),
  );
  console.log("Branch       | check                     | deploy arrow | node classes (full diagram)");
  console.log("-------------|---------------------------|--------------|----------------------------");
  for (const name of Object.keys(observed.branchChecks)) {
    const check = observed.branchChecks[name];
    const checkText = check
      ? `${check.status}${check.stale ? ` stale (${check.staleReason})` : ""}`
      : "-";
    const classes = (observed.nodeClasses.full || {})[name];
    console.log(
      `${name.padEnd(12)} | ${checkText.padEnd(25)} | ${String(observed.deployArrows[name]).padEnd(12)} | ${classes ? classes.join(" ") : "-"}`,
    );
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

  // ------------------------------------------------- major branch deployment check
  if (
    "majorBranchDeploymentCheckEnabled" in expected &&
    observed.majorBranchDeploymentCheckEnabled !== expected.majorBranchDeploymentCheckEnabled
  ) {
    failures.push(
      `majorBranchDeploymentCheckEnabled is ${observed.majorBranchDeploymentCheckEnabled}, expected ${expected.majorBranchDeploymentCheckEnabled}`,
    );
  }
  for (const [branch, want] of Object.entries(expected.deployArrows || {})) {
    const got = observed.deployArrows[branch];
    if (got === undefined || got === null) {
      failures.push(`${branch} has no deployment arrow in the pipeline`);
    } else if (got !== want) {
      failures.push(`the deployment arrow of ${branch} shows ${got}, expected ${want}`);
    }
  }
  for (const [branch, want] of Object.entries(expected.branchChecks || {})) {
    if (!(branch in observed.branchChecks)) {
      failures.push(`branch ${branch} is not in the pipeline`);
      continue;
    }
    const got = observed.branchChecks[branch];
    if (want === null) {
      if (got !== null) {
        failures.push(`${branch} has a major branch deployment check (${got.status}), expected none`);
      }
      continue;
    }
    if (got === null) {
      failures.push(`${branch} has no major branch deployment check, expected ${JSON.stringify(want)}`);
      continue;
    }
    for (const [key, value] of Object.entries(want)) {
      const actual = got[key] === undefined ? null : got[key];
      const accepted = Array.isArray(value) ? value : [value];
      if (!accepted.some((v) => v === actual)) {
        failures.push(
          `the check of ${branch} has ${key} ${JSON.stringify(actual)}, expected ${accepted.map((v) => JSON.stringify(v)).join(" or ")}`,
        );
      }
    }
  }
  for (const [branch, want] of Object.entries(expected.nodeClasses || {})) {
    const kinds = Object.keys(classesByDiagram);
    if (kinds.length === 0) {
      failures.push(`nodeClasses: no mermaid diagram was generated`);
    }
    for (const kind of kinds) {
      const classes = (observed.nodeClasses[kind] || {})[branch];
      if (!classes) {
        failures.push(`the ${kind} diagram has no node for ${branch}`);
        continue;
      }
      const checkClasses = classes.filter((cls) => cls.startsWith("gitBranchCheck"));
      if (!classes.includes(want) || checkClasses.some((cls) => cls !== want)) {
        failures.push(`the ${branch} node of the ${kind} diagram has classes ${classes.join(" ")}, expected ${want}`);
      }
    }
  }
  if (expected.devOrgNodes) {
    const { devOrgNodeName } = req("utils/pipeline/devOrgsUtils.js");
    observed.devOrgNodes = {};
    for (const [mode, orgs] of Object.entries(expected.devOrgNodes)) {
      const text = mode === "devOrgs" ? data.mermaidDiagramDevOrgs : data.mermaidDiagram;
      observed.devOrgNodes[mode] = {};
      for (const [orgId, want] of Object.entries(orgs)) {
        const nodeName = devOrgNodeName(orgId);
        const lines = (text || "").split(/\r?\n/).map((candidate) => candidate.trim());
        const line = lines.find((candidate) => candidate.startsWith(nodeName + "[") || candidate.startsWith(nodeName + "("));
        const arrow = lines.find((candidate) => candidate.endsWith(" " + nodeName) && candidate.includes("-.->"));
        const bubble = line ? ((arrow || "").match(/data-behind='([^']+)'/) || [])[1] || "none" : null;
        observed.devOrgNodes[mode][orgId] = bubble;
        if (String(bubble) !== String(want)) {
          failures.push(`the ${mode} diagram shows ${line ? "the node of " + orgId + " with chip " + bubble : "no node for " + orgId}, expected ${want === null ? "no node" : want}`);
        }
      }
    }
  }
  if (expected.checkLinks === true) {
    const { host } = readRemote();
    const withCheck = Object.entries(observed.branchChecks).filter(([, check]) => check);
    if (withCheck.length === 0) {
      failures.push("checkLinks: no branch has a major branch deployment check to link to");
    }
    for (const [branch, check] of withCheck) {
      let url = null;
      try {
        url = new URL(check.webUrl);
      } catch {
        url = null;
      }
      if (!url || !/^https?:$/.test(url.protocol)) {
        failures.push(`the check link of ${branch} is not an http(s) URL: ${check.webUrl}`);
      } else if (host && url.hostname.toLowerCase() !== host.toLowerCase()) {
        failures.push(`the check link of ${branch} (${check.webUrl}) is not on the repository host ${host}`);
      }
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

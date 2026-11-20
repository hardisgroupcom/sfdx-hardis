/**
 * The orgs of the command screenshots.
 *
 * The harness runs with a home folder of its own (`<run dir>/home`), which holds the
 * authorization of ONE Dev Hub and of the scratch orgs created from it, and nothing else: the
 * commands that list or pick orgs only ever see those, never the other orgs of the machine.
 *
 * - devhub: a connected orgfarm Developer Edition org that is a Dev Hub (SFDX_HARDIS_SHOTS_DEVHUB
 *   picks one). It only gets read-only commands.
 * - showcase: a scratch org created from it, with the Helios metadata deployed and seeded, reused
 *   while it has more than 3 days left. Most commands run against it.
 * - throwaway: a scratch org created for the run when a selected spec changes its org (purge,
 *   freeze, deploy...), and deleted at the end.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { log, output, sfJson } from "./shell.mjs";

export const ALIASES = {
  devhub: "hardis-shots-devhub",
  showcase: "hardis-shots-showcase",
  throwaway: "hardis-shots-throwaway",
};

// What the images show instead of the real values
const FICTIONAL = {
  devhub: { username: "devhub@helios-solar.demo", alias: "helios-devhub", host: "helios-solar", name: "Romain Lefebvre", email: "romain.lefebvre@helios-solar.demo" },
  showcase: { username: "admin@helios-solar.demo", alias: "helios-dev", host: "helios-solar-dev", name: "Victor Martin", email: "victor.martin@helios-solar.demo" },
  throwaway: { username: "test@helios-solar.demo", alias: "helios-test", host: "helios-solar-test", name: "Mariia Kowalska", email: "mariia.kowalska@helios-solar.demo" },
};

/** The environment of every sf call of the run: the home folder of the run. */
export function homeEnv(home) {
  return {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    SF_DISABLE_TELEMETRY: "true",
    SF_AUTOUPDATE_DISABLE: "true",
    SFDX_HARDIS_SKIP_UPDATE_CHECK: "true",
  };
}

/**
 * Picks the Dev Hub: SFDX_HARDIS_SHOTS_DEVHUB when set, else the one of the previous run when it
 * is still connected and has the slots this run needs, else the first connected orgfarm Dev Hub
 * with `neededSlots` scratch orgs left today and as many active slots.
 */
export function pickDevHub({ neededSlots = 1, previousUsername = null } = {}) {
  const list = sfJson(["org", "list"]);
  const all = [...(list.nonScratchOrgs || []), ...(list.devHubs || [])];
  const unique = [...new Map(all.map((org) => [org.username, org])).values()];
  const wanted = process.env.SFDX_HARDIS_SHOTS_DEVHUB;
  if (wanted) {
    const org = unique.find((candidate) => candidate.username === wanted || candidate.alias === wanted);
    if (!org) {
      throw new Error(`SFDX_HARDIS_SHOTS_DEVHUB=${wanted} is not an authenticated org`);
    }
    return org;
  }
  const candidates = unique
    .filter((org) => org.isDevHub && /orgfarm/i.test(org.instanceUrl || "") && org.connectedStatus === "Connected")
    .sort((a, b) => Number(b.username === previousUsername) - Number(a.username === previousUsername));
  if (candidates.length === 0) {
    throw new Error("No connected orgfarm Dev Hub: authenticate one, or set SFDX_HARDIS_SHOTS_DEVHUB");
  }
  if (neededSlots === 0 && candidates[0].username === previousUsername) {
    return candidates[0];
  }
  for (const org of candidates) {
    const limits = sfJson(["org", "list", "limits", "--target-org", org.username], { allowFailure: true });
    const byName = Object.fromEntries((limits?.result || []).map((limit) => [limit.name, limit]));
    const daily = byName.DailyScratchOrgs?.remaining ?? 0;
    const active = byName.ActiveScratchOrgs?.remaining ?? 0;
    if (daily >= neededSlots && active >= neededSlots) {
      return org;
    }
    log(`Dev Hub ${org.alias || "(no alias)"} skipped: ${daily} scratch orgs left today, ${active} active slots, ${neededSlots} needed`);
  }
  throw new Error(`No orgfarm Dev Hub has ${neededSlots} scratch org(s) left`);
}

/**
 * Writes the home folder of the run: the key that decrypts the authorizations, the authorization
 * of the Dev Hub, and an alias file naming it. Scratch orgs created by earlier runs stay.
 */
export function prepareHome(home, devHub) {
  const realSfdx = path.join(os.homedir(), ".sfdx");
  const sfdx = path.join(home, ".sfdx");
  fs.mkdirSync(sfdx, { recursive: true });
  fs.mkdirSync(path.join(home, ".sf"), { recursive: true });
  fs.copyFileSync(path.join(realSfdx, "key.json"), path.join(sfdx, "key.json"));
  fs.copyFileSync(path.join(realSfdx, `${devHub.username}.json`), path.join(sfdx, `${devHub.username}.json`));
  const aliasFile = path.join(sfdx, "alias.json");
  const aliases = fs.existsSync(aliasFile) ? JSON.parse(fs.readFileSync(aliasFile, "utf8")) : { orgs: {} };
  aliases.orgs = aliases.orgs || {};
  aliases.orgs[ALIASES.devhub] = devHub.username;
  fs.writeFileSync(aliasFile, JSON.stringify(aliases, null, 2));
  sfJson(["config", "set", `target-dev-hub=${ALIASES.devhub}`, "--global"], { env: homeEnv(home), cwd: home });
}

/** Days left before a scratch org expires, or -1 when the alias names no usable org. */
export function scratchDaysLeft(env, alias) {
  const answer = sfJson(["org", "display", "--target-org", alias], { env, allowFailure: true });
  if (!answer || answer.status !== 0 || answer.result?.connectedStatus === "RefreshTokenAuthError") {
    return -1;
  }
  const expiration = answer.result?.expirationDate;
  if (!expiration) {
    return -1;
  }
  return (new Date(expiration).getTime() - Date.now()) / (24 * 3600 * 1000);
}

/**
 * Creates the scratch org of a kind (showcase or throwaway) from the workspace, deploys the
 * project and runs the seed. Returns true when it created one.
 */
export function ensureScratchOrg(kind, { env, workspace, seedDir, minDaysLeft }) {
  const alias = ALIASES[kind];
  const daysLeft = scratchDaysLeft(env, alias);
  if (daysLeft >= minDaysLeft) {
    log(`${kind} scratch org reused (${Math.floor(daysLeft)} days left)`);
    return false;
  }
  if (daysLeft >= 0) {
    sfJson(["org", "delete", "scratch", "--target-org", alias, "--no-prompt"], { env, allowFailure: true });
  }
  const username = `admin.${kind}.${Date.now()}@helios-solar.demo`;
  log(`Creating the ${kind} scratch org...`);
  sfJson(
    [
      "org",
      "create",
      "scratch",
      "--definition-file",
      "config/project-scratch-def.json",
      "--alias",
      alias,
      "--target-dev-hub",
      ALIASES.devhub,
      "--duration-days",
      // 2 days: its expiration is a date read as midnight UTC, a 1-day org would look expired the
      // afternoon it was created and be created again by the next run
      kind === "showcase" ? "30" : "2",
      "--username",
      username,
      "--wait",
      "30",
    ],
    { env, cwd: workspace }
  );
  log(`Deploying the Helios project to the ${kind} scratch org...`);
  sfJson(["project", "deploy", "start", "--source-dir", "force-app", "--target-org", alias, "--wait", "60", "--ignore-conflicts"], {
    env,
    cwd: workspace,
  });
  seedOrg(alias, { env, workspace, seedDir });
  return true;
}

/** Runs the seed folder against an org: the permission sets, then the Apex scripts, in name order. */
export function seedOrg(alias, { env, workspace, seedDir }) {
  for (const permissionSet of listFiles(path.join(workspace, "force-app"), ".permissionset-meta.xml")) {
    const name = path.basename(permissionSet).replace(".permissionset-meta.xml", "");
    sfJson(["org", "assign", "permset", "--name", name, "--target-org", alias], { env, cwd: workspace, allowFailure: true });
  }
  // The records of the course: accounts, contacts, opportunities, installations, panel batches
  const helios = path.join(workspace, "scripts", "data", "HeliosBaseline");
  if (fs.existsSync(path.join(helios, "export.json"))) {
    log(`Seed the Helios records on ${alias}`);
    const answer = sfJson(["sfdmu", "run", "--sourceusername", "csvfile", "--targetusername", alias, "--path", helios, "--noprompt"], {
      env,
      cwd: workspace,
      allowFailure: true,
    });
    if (answer?.status !== 0) {
      log(`  SFDMU seed failed: ${String(answer?.message || "").slice(0, 300)}`);
    }
  }
  for (const script of listFiles(path.join(seedDir, "apex"), ".apex").sort()) {
    log(`Seed ${path.basename(script)} on ${alias}`);
    const answer = sfJson(["apex", "run", "--file", script, "--target-org", alias], { env, cwd: workspace, allowFailure: true });
    if (answer?.status !== 0 || answer?.result?.success === false) {
      log(`  seed script failed: ${(answer?.result?.compileProblem || answer?.result?.exceptionMessage || answer?.message || "").slice(0, 300)}`);
    }
  }
  for (const plan of listFiles(path.join(seedDir, "data"), "-plan.json").sort()) {
    log(`Seed data ${path.basename(plan)} on ${alias}`);
    sfJson(["data", "import", "tree", "--plan", plan, "--target-org", alias], { env, cwd: workspace, allowFailure: true });
  }
}

export function deleteScratchOrg(kind, env) {
  sfJson(["org", "delete", "scratch", "--target-org", ALIASES[kind], "--no-prompt"], { env, allowFailure: true });
}

/**
 * The values no image may show, and what it shows instead: usernames, org ids, hosts and the
 * people of the orgs of the run home, the git identity of the machine, and the local paths.
 */
export function buildMaskRules({ env, runDir, workspace }) {
  const rules = [];
  const add = (find, replace) => {
    if (find && String(find).length >= 3 && find !== replace) {
      rules.push({ find: String(find), replace });
    }
  };
  const list = sfJson(["org", "list"], { env, allowFailure: true })?.result || {};
  const orgs = [...(list.nonScratchOrgs || []), ...(list.devHubs || []), ...(list.scratchOrgs || []), ...(list.other || [])];
  const seen = new Set();
  for (const org of orgs) {
    if (!org.username || seen.has(org.username)) {
      continue;
    }
    seen.add(org.username);
    const kind = Object.keys(ALIASES).find((key) => ALIASES[key] === org.alias) || "devhub";
    const fictional = FICTIONAL[kind];
    add(org.username, fictional.username);
    add(org.alias, fictional.alias);
    if (org.orgId) {
      const fakeId = kind === "showcase" ? "00D0b00000HeliosEA" : kind === "throwaway" ? "00D0b00000HelioTEA" : "00D0b00000HelioHEA";
      add(org.orgId, fakeId);
      add(org.orgId.slice(0, 15), fakeId.slice(0, 15));
    }
    const host = (org.instanceUrl || "").replace(/^https:\/\//, "").split(".my.salesforce.com")[0];
    if (host && host.includes("-")) {
      add(host, fictional.host);
      // The same org on its lightning and setup domains
      add(host.split(".")[0], fictional.host);
    }
    const user = sfJson(["data", "query", "--query", `SELECT Name, Email FROM User WHERE Username = '${org.username}'`, "--target-org", org.username], {
      env,
      allowFailure: true,
    });
    const record = user?.result?.records?.[0];
    if (record) {
      add(record.Email, fictional.email);
      add(record.Name, fictional.name);
    }
    // The Dev Hub is a shared org with real people: every one of its users gets a fictional
    // name, so a report that lists them (a query on several orgs) shows none of them
    if (kind === "devhub") {
      const users = sfJson(["data", "query", "--query", "SELECT Name, Username, Email FROM User WHERE UserType = 'Standard' LIMIT 2000", "--target-org", org.username], {
        env,
        allowFailure: true,
      });
      (users?.result?.records || []).forEach((devHubUser, index) => {
        const name = fictionalPerson(index);
        const login = name.toLowerCase().replace(/[^a-z]+/g, ".");
        add(devHubUser.Username, `${login}@helios-solar.demo`);
        add(devHubUser.Email, `${login}@helios-solar.demo`);
        // Names of system users that every org has stay as they are
        if (devHubUser.Name && devHubUser.Name.length >= 5 && !/^(User User|Integration User|Platform Integration User|Automated Process|Security User|Chatter Expert|Data\.com Clean|Insights Integration|SalesforceIQ Integration)$/i.test(devHubUser.Name)) {
          add(devHubUser.Name, name);
        }
      });
    }
  }
  // The git identity of the machine, which commits and some reports show
  const gitName = output("git", ["config", "--global", "user.name"]);
  const gitEmail = output("git", ["config", "--global", "user.email"]);
  add(gitEmail, "victor.martin@helios-solar.demo");
  add(gitName, "Victor Martin");
  // Local paths, with both separators, longest first so the run folder goes before the home
  const paths = [
    [workspace, "C:\\projects\\helios-solar"],
    [runDir, "C:\\projects"],
    [os.homedir(), "C:\\Users\\victor"],
  ];
  for (const [real, shown] of paths) {
    add(real, shown);
    add(real.replace(/\\/g, "/"), shown.replace(/\\/g, "/"));
    add(real.replace(/\\/g, "\\\\"), shown.replace(/\\/g, "\\\\"));
  }
  add(os.userInfo().username.length >= 4 ? `\\Users\\${os.userInfo().username}` : "", "\\Users\\victor");
  return rules.sort((a, b) => b.find.length - a.find.length);
}

/** A fictional first and last name, different for the first 400 indexes. */
function fictionalPerson(index) {
  const first = ["Ana", "Bruno", "Clara", "Dimitri", "Elena", "Felix", "Greta", "Hugo", "Ines", "Jonas", "Karin", "Leon", "Marta", "Nils", "Olga", "Pavel", "Rosa", "Sven", "Tania", "Ugo"];
  const last = ["Arnaud", "Berger", "Costa", "Dumont", "Ekberg", "Fontaine", "Garnier", "Holm", "Ivanova", "Jansen", "Keller", "Lindqvist", "Moreau", "Novak", "Olsen", "Petit", "Quist", "Rossi", "Silva", "Teller"];
  return `${first[index % first.length]} ${last[Math.floor(index / first.length) % last.length]}`;
}

function listFiles(dir, suffix) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(full, suffix);
    }
    return entry.name.endsWith(suffix) ? [full] : [];
  });
}

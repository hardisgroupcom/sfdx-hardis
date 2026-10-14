/**
 * Where the run happens. Nothing is hardcoded: every path is derived from this
 * file's own location, which is
 * <sfdx-hardis>/.claude/skills/training-e2e/scripts/, and every one of them can
 * be overridden with an environment variable.
 *
 *   HARDIS  the sfdx-hardis working copy (four levels up from here)
 *   COURSE  the course source, never worked in as a learner
 *   RUN     the learner's clone: this is where the labs happen
 *   MONRUN  the monitoring repository Lab 3.8 creates
 *   FORK    <login>/sfdx-hardis-training, the learner's fork
 *   MONREPO <login>/sfdx-hardis-training-monitoring
 *   LOGS    where the logs of this run are written
 *   EMAIL   the fictional address the External Client Apps are created with
 *
 * The sibling layout (COURSE, RUN, MONRUN next to HARDIS) is the same one the
 * training-impact and training-update skills already assume.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const slash = (p) => p.replace(/\\/g, "/");

export const HERE = slash(path.dirname(fileURLToPath(import.meta.url)));
export const HARDIS = slash(process.env.SFDX_HARDIS_DIR || path.resolve(HERE, "..", "..", "..", ".."));
const SIBLING = (name) => slash(path.resolve(HARDIS, "..", name));

export const COURSE = slash(process.env.COURSE || SIBLING("sfdx-hardis-training"));
export const RUN = slash(process.env.RUN || SIBLING("training-run"));
export const MONRUN = slash(process.env.MONRUN || SIBLING("training-monitoring"));
export const LOGS = slash(process.env.LOGS || SIBLING("training-e2e"));
export const EMAIL = process.env.TRAINING_EMAIL || "release.manager@heliostraining.invalid";

export const login =
  process.env.GH_LOGIN ||
  spawnSync("gh", ["api", "user", "-q", ".login"], { encoding: "utf8", shell: true }).stdout.trim();

export const UPSTREAM = process.env.UPSTREAM || "hardisgroupcom/sfdx-hardis-training";
export const FORK = process.env.FORK || `${login}/sfdx-hardis-training`;
// From FORK's owner, not from the login, so an overridden FORK takes the
// monitoring repository with it. Same rule as env.sh.
export const MONREPO =
  process.env.MONREPO || `${FORK.split("/")[0]}/sfdx-hardis-training-monitoring`;
export const PANEL = path.join(HERE, "panel.mjs");

// node tick.mjs <pr> <orgBranch> [--all]
// Ticks, in every comment of the Pull Request, the pending pre-deployment manual
// action checkboxes of that org branch: what a person does by clicking the box in
// GitHub, where the markdown of the comment changes from [ ] to [x].
// Post-deployment boxes are left alone, because nobody has done them before the
// merge. --all ticks them too.
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { FORK } from "./env.mjs";

const [pr, org, option] = process.argv.slice(2);
if (!pr || !org) {
  console.error("usage: node tick.mjs <pr> <orgBranch> [--all]");
  process.exit(1);
}
const R = FORK;
const gh = (args, input) => execFileSync("gh", args, { encoding: "utf8", input, maxBuffer: 1 << 26 });
// A branch name can hold characters a regular expression reads as operators
const escaped = org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phase = option === "--all" ? "" : "[^>]*\\bwhen:pre-deploy\\b";
// The marker reads: <!-- sfdx-hardis-manual-action id:<id> org:<branch> pr:<n> when:<phase> -->
const box = new RegExp(`- \\[ \\] (<!-- sfdx-hardis-manual-action [^>]*\\borg:${escaped} ${phase}[^>]*-->)`, "g");

const comments = JSON.parse(gh(["api", `repos/${R}/issues/${pr}/comments`, "--paginate"]));
let n = 0;
for (const c of comments) {
  const body = c.body.replace(box, "- [x] $1");
  if (body !== c.body) {
    const f = path.join(os.tmpdir(), `tick-${c.id}.md`);
    fs.writeFileSync(f, body);
    gh(["api", "-X", "PATCH", `repos/${R}/issues/comments/${c.id}`, "-F", `body=@${f}`, "-q", ".id"]);
    fs.rmSync(f, { force: true });
    n++;
  }
}
console.log(`ticked ${org} in ${n} comment(s) of #${pr}`);

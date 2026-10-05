// node tick.mjs <pr> <orgBranch> : ticks, in every comment of the PR, the manual action checkboxes of that org branch
// (what a person does by clicking the checkbox in GitHub: the comment's markdown changes from [ ] to [x])
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { FORK } from "./env.mjs";
const [pr, org] = process.argv.slice(2);
const R = FORK;
const gh = (args, input) => execFileSync("gh", args, { encoding: "utf8", input, maxBuffer: 1 << 26 });
const comments = JSON.parse(gh(["api", `repos/${R}/issues/${pr}/comments`, "--paginate"]));
let n = 0;
for (const c of comments) {
  const re = new RegExp(`- \\[ \\] (<!-- sfdx-hardis-manual-action [^>]* org:${org} )`, "g");
  const body = c.body.replace(re, "- [x] $1");
  if (body !== c.body) {
    const f = path.join(os.tmpdir(), `tick-${c.id}.md`);
    fs.writeFileSync(f, body);
    gh(["api", "-X", "PATCH", `repos/${R}/issues/comments/${c.id}`, "-F", `body=@${f}`, "-q", ".id"]);
    n++;
  }
}
console.log(`ticked ${org} in ${n} comment(s) of #${pr}`);

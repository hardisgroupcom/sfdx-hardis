import * as fs from "fs-extra";
import * as path from "path";

export function isSfdxProject(cwd=process.cwd()) {
  return fs.existsSync(path.join(cwd, "sfdx-project.json"))
}

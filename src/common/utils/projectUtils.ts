import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import { execCommand, uxLog } from ".";

export function isSfdxProject(cwd = process.cwd()) {
  return fs.existsSync(path.join(cwd, "sfdx-project.json"));
}

export async function createBlankSfdxProject(cwd = process.cwd(), debug = false) {
  uxLog(this, c.cyan("Creating blank SFDX project..."));
  const projectCreateCommand = 'sfdx force:project:create --projectname "sfdx-hardis-blank-project"';
  await execCommand(projectCreateCommand, this, {
    cwd: cwd,
    fail: true,
    debug: debug,
    output: true,
  });
}

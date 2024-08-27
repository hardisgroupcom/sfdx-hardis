import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import { getConfig } from "../../config/index.js";
import { uxLog } from "../utils";
import { KeyValueProviderInterface } from "../utils/keyValueUtils";

export class LocalTestProvider implements KeyValueProviderInterface {
  name = "localtest";
  description = "Writes in a local file (just for tests, can not work in CI)";
  poolStorageLocalFileName = null;

  async initialize() {
    await this.managePoolStorageLocalFileName();
    return this.poolStorageLocalFileName !== null;
  }

  async getValue(key: string | null = null) {
    await this.managePoolStorageLocalFileName(key);
    if (fs.existsSync(this.poolStorageLocalFileName)) {
      return fs.readJsonSync(this.poolStorageLocalFileName);
    }
    return {};
  }

  async setValue(key: string | null = null, value: any) {
    await this.managePoolStorageLocalFileName(key);
    await fs.writeFile(this.poolStorageLocalFileName, JSON.stringify(value, null, 2), "utf8");
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async updateActiveScratchOrg(_scratchOrg: any, _keyValues: any) {
    return null;
  }

  async managePoolStorageLocalFileName(key: string | null = null) {
    if (this.poolStorageLocalFileName == null) {
      if (key === null) {
        const config = await getConfig("user");
        const projectName = config.projectName || "default";
        key = `pool_${projectName}`;
      }
      this.poolStorageLocalFileName = path.join(os.homedir(), `poolStorage_${key}.json`);
      uxLog(this, c.grey("Local test storage file: " + this.poolStorageLocalFileName));
    }
  }

  async userSetup() {
    return true;
  }

  async userAuthenticate() {
    // No authentication for testing local files
    return true;
  }
}

import { SfError } from "@salesforce/core";
import axios from "axios";
import * as c from "chalk";
import { getConfig, setConfig } from "../../config/index.js";
import { uxLog } from "../utils";
import { KeyValueProviderInterface } from "../utils/keyValueUtils";
import { prompts } from "../utils/prompts";

export class KeyValueXyzProvider implements KeyValueProviderInterface {
  name = "keyvalue.xyz";
  description = "keyvalue.xyz external service (api token, no auth). Seems down for now.";
  keyValueUrl = null;

  async initialize() {
    await this.manageKeyValueXyzAuth(null);
    return this.keyValueUrl !== null;
  }

  async getValue(key: string | null = null) {
    await this.manageKeyValueXyzAuth(key);
    const response = await axios({
      method: "get",
      url: this.keyValueUrl,
      responseType: "json",
    });
    return response.status === 200 ? response.data || {} : null;
  }

  async setValue(key: string | null = null, value: any) {
    await this.manageKeyValueXyzAuth(key);
    await axios({
      method: "post",
      url: this.keyValueUrl,
      responseType: "json",
      data: value,
    });
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async updateActiveScratchOrg(_scratchOrg: any, _keyValues: any) {
    return null;
  }

  async manageKeyValueXyzAuth(key: string | null = null) {
    if (this.keyValueUrl == null) {
      const config = await getConfig("user");
      const apiKey = config.keyValueXyzApiKey || process.env.KEY_VALUE_XYZ_API_KEY;
      if (apiKey === null) {
        throw new SfError(c.red("You need to define a keyvalue.xyz apiKey in config.keyValueXyzApiKey or env var KEY_VALUE_XYZ_API_KEY"));
      }
      if (key === null) {
        const projectName = config.projectName || "default";
        key = `pool_${projectName}`;
      }
      this.keyValueUrl = `https://api.keyvalue.xyz/${apiKey}/${key}`;
      uxLog(this, c.grey("keyvalue.xyz url: " + this.keyValueUrl));
    }
  }

  async userSetup() {
    const config = await getConfig("user");
    const projectName = config.projectName || "default";
    const keyValueUrl = `https://api.keyvalue.xyz/new/pool_${projectName}`;
    const resp = await axios({
      method: "post",
      url: keyValueUrl,
      responseType: "json",
    });
    const keyValueXyzApiKey = resp.data;
    await setConfig("user", { keyValueXyzApiKey: keyValueXyzApiKey });
    uxLog(this, c.cyan("Created new keyvalue.xyz API key and stored in local untracked config"));
    uxLog(this, c.yellow(`In CI config, set protected variable ${c.bold(c.green("KEY_VALUE_XYZ_API_KEY = " + keyValueXyzApiKey))}`));
    return true;
  }

  async userAuthenticate() {
    const config = await getConfig("user");
    const response = await prompts([
      {
        type: "text",
        name: "keyValueXyzApiKey",
        message: c.cyanBright("Please input keyvalue.xyz API KEY (ask the value to your tech lead or look in CI variable KEY_VALUE_XYZ_API_KEY )"),
        initial: config.keyValueXyzApiKey || null,
      },
    ]);
    await setConfig("user", { keyValueXyzApiKey: response.keyValueXyzApiKey });
    return true;
  }
}

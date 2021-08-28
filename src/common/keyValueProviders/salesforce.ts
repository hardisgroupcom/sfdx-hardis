import { Connection } from "@salesforce/core";
import axios from "axios";
import * as c from "chalk";
import * as crypto from "crypto";
import { getConfig, setConfig } from "../../config";
import { uxLog } from "../utils";
import { KeyValueProviderInterface } from "../utils/keyValueUtils";
import { setPoolStorage } from "../utils/poolUtils";
import { prompts } from "../utils/prompts";

export class KvdbIoProvider implements KeyValueProviderInterface {
  name = "Salesforce Custom Metadata (secured auth)";
  description = "Use a custom metadata on a Salesforce org (usually DevHub) to store scratch org pool tech info";

  conn: Connection = null;

  async initialize(options) {
    await this.manageSfdcOrgAuth(options);
    return this.conn !== null
  }

  async getValue(key: string | null = null) {
    await this.manageSfdcOrgAuth(key);
    const response = await axios({
      method: "get",
      responseType: "json",
      headers: {
      },
    });
    return response.status === 200 ? response.data || {} : null;
  }

  async setValue(key: string | null = null, value: any) {
    await this.manageSfdcOrgAuth(key);
    const resp = await axios({
      method: "post",
      responseType: "json",
      data: JSON.stringify(value),
      headers: {
      },
    });
    return resp.status === 200;
  }

  async manageSfdcOrgAuth(options: any = {}) {
    if (this.conn == null) {
      console.log("wesh");
    }
  }

  async userSetup() {
    const config = await getConfig("user");
    const projectName = config.projectName || "default";
    const randomSecretKey = crypto.randomBytes(48).toString("hex");
    const kvdbIoUrl = `https://kvdb.io/`;
    const resp = await axios({
      method: "post",
      url: kvdbIoUrl,
      responseType: "json",
      data: {
        email: `${projectName}@hardis-scratch-org-pool.com`,
        secret_key: randomSecretKey,
      },
    });
    const kvdbIoBucketId = resp.data;
    await setConfig("user", { kvdbIoSecretKey: randomSecretKey, kvdbIoBucketId: kvdbIoBucketId });
    await setPoolStorage({});
    uxLog(this, c.cyan("Created new kvdb.io bucket and stored in local untracked config"));
    uxLog(
      this,
      c.yellow(
        `In future CI config, set protected variables ${c.bold(c.green("KVDB_IO_SECRET_KEY = " + randomSecretKey))} and ${c.bold(
          c.green("KVDB_IO_BUCKET_ID = " + kvdbIoBucketId)
        )}`
      )
    );
    return true;
  }

  async userAuthenticate() {
    const config = await getConfig("user");
    const response = await prompts([
      {
        type: "text",
        name: "kvdbIoBucketId",
        message: c.cyanBright("Please input kvdb.io BUCKET ID (ask the value to your tech lead or look in CI variable KVDB_IO_BUCKET_ID )"),
        initial: config.kvdbIoSecretKey || null,
      },
      {
        type: "text",
        name: "kvdbIoSecretKey",
        message: c.cyanBright("Please input kvdb.io BUCKET SECRET KEY (ask the value to your tech lead or look in CI variable KVDB_IO_SECRET_KEY )"),
        initial: config.kvdbIoSecretKey || null,
      },
    ]);
    await setConfig("user", { kvdbIoBucketId: response.kvdbIoBucketId, kvdbIoSecretKey: response.kvdbIoSecretKey,  });
    return true;
  }
}

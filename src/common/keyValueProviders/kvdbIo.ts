import { SfdxError } from "@salesforce/core";
import axios from "axios";
import * as c from "chalk";
import * as crypto from "crypto";
import { getConfig, setConfig } from "../../config";
import { uxLog } from "../utils";
import { KeyValueProviderInterface } from "../utils/keyValueUtils";
import { setPoolStorage } from "../utils/poolUtils";
import { prompts } from "../utils/prompts";

export class KvdbIoProvider implements KeyValueProviderInterface {
  name = "kvdb.io";
  description = "kvdb.io external service (api token, auth with Bearer). Requires paid plan, or renewing config every 2 weeks";
  kvdbIoUrl = null;
  kvdbIoSecretKey = null;

  async initialize() {
    await this.manageKvdbIoAuth(null);
    return this.kvdbIoUrl !== null && this.kvdbIoSecretKey !== null;
  }

  async getValue(key: string | null = null) {
    await this.manageKvdbIoAuth(key);
    const response = await axios({
      method: "get",
      url: this.kvdbIoUrl,
      responseType: "json",
      headers: {
        Authorization: "Bearer " + this.kvdbIoSecretKey,
      },
    });
    return response.status === 200 ? response.data || {} : null;
  }

  async setValue(key: string | null = null, value: any) {
    await this.manageKvdbIoAuth(key);
    const resp = await axios({
      method: "post",
      url: this.kvdbIoUrl,
      responseType: "json",
      data: JSON.stringify(value),
      headers: {
        Authorization: "Bearer " + this.kvdbIoSecretKey,
      },
    });
    return resp.status === 200;
  }

  async manageKvdbIoAuth(key: string | null = null) {
    if (this.kvdbIoUrl == null) {
      const config = await getConfig("user");
      const kvdbIoBucketId = config.kvdbIoBucketId || process.env.KVDB_IO_BUCKET_ID;
      if (kvdbIoBucketId == null) {
        throw new SfdxError(c.red("You need to define an kvdb.io apiKey in config.kvdbIoBucketId or CI env var KVDB_IO_BUCKET_ID"));
      }
      const kvdbIoSecretKey = config.kvdbIoSecretKey || process.env.KVDB_IO_SECRET_KEY;
      if (kvdbIoSecretKey == null) {
        throw new SfdxError(c.red("You need to define an kvdb.io secretKey in config.kvdbIoSecretKey or CI env var KVDB_IO_SECRET_KEY"));
      }
      if (key == null) {
        const projectName = config.projectName || "default";
        key = `pool_${projectName}`;
      }
      this.kvdbIoUrl = `https://kvdb.io/${kvdbIoBucketId}/${key}`;
      this.kvdbIoSecretKey = kvdbIoSecretKey;
      uxLog(this, c.grey("kvdb.io url: " + this.kvdbIoUrl));
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

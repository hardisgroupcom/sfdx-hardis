import { SfdxError } from "@salesforce/core";
import * as Keyv from "keyv";
import * as c from "chalk";
import { getConfig, setConfig } from "../../config";
import { uxLog } from "../utils";
import { KeyValueProviderInterface } from "../utils/keyValueUtils";
import { setPoolStorage } from "../utils/poolUtils";
import { prompts } from "../utils/prompts";

export class RedisProvider implements KeyValueProviderInterface {
  name = "redis";
  description = "redis external service (redis secure db authentication): Recommended";
  keyv = null;
  redisKey = null;
  authError = false;
  inProgress = false;

  async initialize() {
    await this.manageRedisAuth(null);
    return this.keyv !== null;
  }

  async getValue(key: string | null = null) {
    await this.manageRedisAuth(key);
    this.inProgress = true;
    const value = await this.keyv.get(this.redisKey);
    this.inProgress = false;
    return value;
  }

  async setValue(key: string | null = null, value: any) {
    await this.manageRedisAuth(key);
    this.inProgress = true;
    await this.keyv.set(this.redisKey, value);
    this.inProgress = false;
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async manageRedisAuth(_key: string | null = null) {
    if (this.keyv == null) {
      const config = await getConfig("user");
      const redisAuthUrl = config.redisAuthUrl || process.env.REDIS_AUTH_URL;
      if (redisAuthUrl == null) {
        throw new SfdxError(c.red("You need to define an redis auth URL config.redisAuthUrl or CI env var REDIS_AUTH_URL"));
      }
      if (this.redisKey == null) {
        const projectName = config.projectName || "default";
        this.redisKey = `pool${projectName}`;
      }
      this.keyv = new Keyv(redisAuthUrl, { disable_resubscribing: true, autoResubscribe: false, maxRetriesPerRequest: 10 });
      this.keyv.on("error", (err) => {
        if (this.authError === false) {
          this.keyv = null;
          this.authError = true;
          uxLog(this, "[pool]" + c.red("Redis connection Error :" + err));
        }
      });
      uxLog(this, c.grey("Authenticated to Redis"));
      // Disconnect every 5 seconds to avoid to prevent sfdx command to exit
      await this.scheduleEndRedisConnection();
    }
  }

  async scheduleEndRedisConnection() {
    setTimeout(async () => {
      if (this.inProgress === false) {
        if (this.keyv?.opts?.store?.redis) {
          // Kill redis connection
          this.keyv.opts.store.redis.disconnect();
          this.keyv = null ;
        }
      } else {
        // If a get or a set is in progress, retry later
        await this.scheduleEndRedisConnection();
      }
    }, 3000);
  }

  async userSetup() {
    const config = await getConfig("user");
    const projectName = config.projectName || "default";

    uxLog(this, c.cyan(`You need a redis account. You can create one for free at ${c.bold("https://redis.com/try-free/")}`));
    uxLog(
      this,
      c.cyan("Create a database that you can name scratchPool, then build auth URL by appending default user password and public endpoint")
    );
    uxLog(this, c.cyan(`Model: redis://default:PASSWORD@PUBLICENDPOINT or redis://USERNAME:PASSWORD@PUBLICENDPOINT`));
    const response = await prompts([
      {
        type: "text",
        name: "redisAuthUrl",
        message: c.cyanBright(
          "Please enter authentication URL for Redis remote database (exemple: redis://myusername:mypassword@redis-17702.c212.eu-central-1-1.ec2.cloud.redislabs.com:18702 )"
        ),
        initial: config.redisAuthUrl || null,
      },
    ]);
    const redisAuthUrl = response.redisAuthUrl;
    await setConfig("user", { redisAuthUrl: redisAuthUrl });
    await setPoolStorage({});
    uxLog(this, c.cyan(`Initialized scratch org pool storage for ${projectName} on Redis`));
    uxLog(this, c.yellow(`In CI config, set protected variable ${c.bold(c.green("REDIS_AUTH_URL = " + redisAuthUrl))}}`));
    return true;
  }

  async userAuthenticate() {
    const config = await getConfig("user");
    const response = await prompts([
      {
        type: "text",
        name: "redisAuthUrl",
        message: c.cyanBright(
          "Please enter authentication URL for Redis remote database (exemple: redis://username:password@redis-17702.c212.eu-central-1-1.ec2.cloud.redislabs.com:18702 )"
        ),
        initial: config.redisAuthUrl || null,
      },
    ]);
    const redisAuthUrl = response.redisAuthUrl;
    await setConfig("user", { redisAuthUrl: redisAuthUrl });
    return true;
  }
}

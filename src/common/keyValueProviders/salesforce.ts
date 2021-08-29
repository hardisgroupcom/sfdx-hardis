import { Connection } from "@salesforce/core";
import * as c from "chalk";
import * as he from "he";
import * as path from "path";
import { getConfig } from "../../config";
import { uxLog } from "../utils";
import { deployMetadatas } from "../utils/deployUtils";
import { KeyValueProviderInterface } from "../utils/keyValueUtils";
import { setPoolStorage } from "../utils/poolUtils";

export class SalesforceProvider implements KeyValueProviderInterface {
  name = "salesforce";
  description = "Use a custom object on a Salesforce org (usually DevHub) to store scratch org pool tech info";

  conn: Connection = null;
  recordName = null;

  async initialize(options) {
    await this.manageSfdcOrgAuth(options);
    return this.conn !== null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getValue(_key: string | null = null) {
    await this.manageSfdcOrgAuth();
    // Single record upsert
    const queryRes = await this.conn.query(`SELECT Id,Name,ValueText__c FROM SfdxHardisKeyValueStore__c WHERE Name='${this.recordName}' LIMIT 1`);
    const valueText = queryRes.records[0] ? (queryRes.records[0] as any).ValueText__c || "" : "";
    if (valueText.length > 5) {
      return valueText.includes("&quot") ? JSON.parse(he.decode(valueText)) : JSON.parse(valueText);
    }
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setValue(_key: string | null = null, value: any) {
    await this.manageSfdcOrgAuth();
    // Single record upsert
    const queryRes = await this.conn.query(`SELECT Id,Name,ValueText__c FROM SfdxHardisKeyValueStore__c WHERE Name='${this.recordName}' LIMIT 1`);
    if (queryRes.records[0]) {
      const recordId = (queryRes.records[0] as any).Id;
      const queryUpdateRes = await this.conn.sobject("SfdxHardisKeyValueStore__c").update({
        Id: recordId,
        Name: this.recordName,
        ValueText__c: JSON.stringify(value),
      });
      return queryUpdateRes.success === true;
    } else {
      const queryCreateRes = await this.conn.sobject("SfdxHardisKeyValueStore__c").create({
        Name: this.recordName,
        ValueText__c: JSON.stringify(value),
      });
      return queryCreateRes.success === true;
    }
  }

  async manageSfdcOrgAuth(options: any = {}) {
    const config = await getConfig("project");
    if (this.conn == null) {
      if (options.devHubConn) {
        this.conn = options.devHubConn;
      }
      const projectName = config.projectName || "default";
      this.recordName = `ScratchOrgPool_${projectName}`;
    }
  }

  async userSetup(options: any) {
    // Deploy KeyValueStore object on DevHub org
    try {
      await deployMetadatas({
        deployDir: path.join(path.join(__dirname, "../../../defaults/utils/sfdxHardisKeyValueStore", ".")),
        soap: true,
        targetUsername: options.devHubConn.options.authInfo.fields.username,
      });
    } catch (e) {
      uxLog(
        this,
        c.red(`Unable to deploy CustomObject SfdxHardisKeyValueStore__c
You mut create manually an Custom Object SfdxHardisKeyValueStore__c:
- API Name: SfdxHardisKeyValueStore__c
- Field SfdxHardisKeyValueStore__c.ValueText__c of type TextArea (long) (with maximum size 131072 chars)
      `)
      );
      throw e;
    }
    // Initialize storage
    await setPoolStorage({}, options);
    uxLog(this, c.green("Created KeyValue storage on Salesforce org"));
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async userAuthenticate(options) {
    if (options.devHubConn) {
      return true;
    }
    return false;
  }
}

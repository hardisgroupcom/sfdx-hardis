import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { SfError } from "@salesforce/core";
import c from "chalk";
import { MetadataUtils } from "../../../common/metadata-utils/index.js";
import { isCI, uxLog } from "../../../common/utils/index.js";
import { promptOrgUsernameDefault } from "../../../common/utils/orgUtils.js";
import { wrapSfdxCoreCommand } from "../../../common/utils/wrapUtils.js";

export class SourceRetrieve extends SfCommand<any> {
  public static readonly description = `sfdx-hardis wrapper for sfdx force:source:retrieve

- If no retrieve constraint is sent, as assisted menu will request the list of metadatas to retrieve
- If no org is selected , an assisted menu will request the user to choose one

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_retrieve)
`;
  public static readonly examples = [];
  public static readonly requiresProject = true;
  public static readonly flagsConfig: FlagsConfig = {
    apiversion: flags.builtin({
      /* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
      // @ts-ignore force char override for backward compat
      char: "a",
    }),
    sourcepath: flags.array({
      char: "p",
      description: "sourcePath",
      longDescription: "sourcePath",
      exclusive: ["manifest", "metadata"],
    }),
    wait: Flags.integer({
      char: "w",
      description: "wait",
      longDescription: "wait",
    }),
    manifest: flags.filepath({
      char: "x",
      description: "manifest",
      longDescription: "manifest",
      exclusive: ["metadata", "sourcepath"],
    }),
    metadata: flags.array({
      char: "m",
      description: "metadata",
      longDescription: "metadata",
      exclusive: ["manifest", "sourcepath"],
    }),
    packagenames: flags.array({
      char: "n",
      description: "packagenames",
    }),
    tracksource: Flags.boolean({
      char: "t",
      description: "tracksource",
    }),
    forceoverwrite: Flags.boolean({
      char: "f",
      description: "forceoverwrite",
      dependsOn: ["tracksource"],
    }),
    verbose: flags.builtin({
      description: "verbose",
    }),
    debug: Flags.boolean({
      char: "d",
      default: false,
      description: "debugMode",
    }),
    websocket: Flags.string({
      description: "websocket",
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public async run(): Promise<any> {
    uxLog(this, c.red("This command will be removed by Salesforce in November 2024."));
    uxLog(this, c.red("Please migrate to command sf hardis project retrieve start"));
    uxLog(this, c.red("See https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_mig_deploy_retrieve.htm"));
    const args = this.argv;
    // Manage user selection for metadatas
    if (!isCI && !flags.sourcepath && !flags.manifest && !flags.metadata && !flags.packagenames) {
      const metadatas = await MetadataUtils.promptMetadataTypes();
      const metadataArg = metadatas.map((metadataType: any) => metadataType.xmlName).join(",");
      args.push(...["-m", `"${metadataArg}"`]);
    }
    // Manage user selection for org
    if (!isCI && !flags.targetusername) {
      let orgUsername = this.org.getUsername();
      orgUsername = await promptOrgUsernameDefault(this, orgUsername, { devHub: false, setDefault: false });
      if (orgUsername) {
        args.push(...["--targetusername", `"${orgUsername}"`]);
      } else {
        throw new SfError(c.yellow("For technical reasons, run again this command and select your org in the list :)"));
      }
    }
    return await wrapSfdxCoreCommand("sfdx force:source:retrieve", args, this, flags.debug);
  }
}

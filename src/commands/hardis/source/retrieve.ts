import { flags, FlagsConfig, SfdxCommand } from "@salesforce/command";
import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import { MetadataUtils } from "../../../common/metadata-utils";
import { isCI } from "../../../common/utils";
import { promptOrgUsernameDefault } from "../../../common/utils/orgUtils";
import { wrapSfdxCoreCommand } from "../../../common/utils/wrapUtils";

export class SourceRetrieve extends SfdxCommand {
  public static readonly description = `sfdx-hardis wrapper for sfdx force:source:retrieve

- If no retrieve constraint is sent, as assisted menu will request the list of metadatas to retrieve
- If no org is selected , an assisted menu will request the user to choose one

[See documentation of Salesforce command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_retrieve)
`;
  public static readonly examples = [];
  public static readonly requiresProject = true;
  public static readonly requiresUsername = true;
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
    wait: flags.minutes({
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
    tracksource: flags.boolean({
      char: "t",
      description: "tracksource",
    }),
    forceoverwrite: flags.boolean({
      char: "f",
      description: "forceoverwrite",
      dependsOn: ["tracksource"],
    }),
    verbose: flags.builtin({
      description: "verbose",
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: "debugMode",
    }),
    websocket: flags.string({
      description: "websocket",
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  public async run(): Promise<any> {
    const args = this.argv;
    // Manage user selection for metadatas
    if (!isCI && !this.flags.sourcepath && !this.flags.manifest && !this.flags.metadata && !this.flags.packagenames) {
      const metadatas = await MetadataUtils.promptMetadataTypes();
      const metadataArg = metadatas.map((metadataType: any) => metadataType.xmlName).join(",");
      args.push(...["-m", `"${metadataArg}"`]);
    }
    // Manage user selection for org
    if (!isCI && !this.flags.targetusername) {
      let orgUsername = this.org.getUsername();
      orgUsername = await promptOrgUsernameDefault(this, orgUsername, { devHub: false, setDefault: false });
      if (orgUsername) {
        args.push(...["--targetusername", `"${orgUsername}"`]);
      } else {
        throw new SfdxError(c.yellow("For technical reasons, run again this command and select your org in the list :)"));
      }
    }
    return await wrapSfdxCoreCommand("sfdx force:source:retrieve", args, this, this.flags.debug);
  }
}

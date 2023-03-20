/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as appRootPath from "app-root-path";
import * as axios1 from "axios";
import * as c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";
// import * as packages from '../../../../defaults/packages.json'
import { MetadataUtils } from "../../../common/metadata-utils";
import { isCI, uxLog } from "../../../common/utils";
import { managePackageConfig } from "../../../common/utils/orgUtils";
import { prompts } from "../../../common/utils/prompts";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

const axios = axios1.default;

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class PackageVersionInstall extends SfdxCommand {
  public static title = "Install packages in an org";

  public static description = `Install a package in an org using its id (starting with **04t**)

Assisted menu to propose to update \`installedPackages\` property in \`.sfdx-hardis.yml\`
`;

  public static examples = ["$ sfdx hardis:package:install"];

  // public static args = [{name: 'file'}];

  protected static flagsConfig = {
    package: flags.string({
      char: "p",
      description: "Package Version Id to install (04t...)",
    }),
    debug: flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: flags.string({
      description: messages.getMessage("websocket"),
    }),
    installationkey: flags.string({
      char: "k",
      default: null,
      description: messages.getMessage("packageInstallationKey"),
    }),
    skipauth: flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static requiresDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  /* jscpd:ignore-end */

  protected allPackagesFileName = path.join(appRootPath.toString(), "defaults/packages.json");
  protected sfdxProjectJsonFileName = path.join(process.cwd(), "sfdx-project.json");

  public async run(): Promise<AnyJson> {
    const packagesRaw = await fs.readFile(this.allPackagesFileName, "utf8");
    const packages = JSON.parse(packagesRaw);
    const packageId = this.flags.package || null;
    const packagesToInstall = [];
    // If no package Id is sent, ask user what package he/she wants to install
    if (!isCI && (packageId == null || !packageId.startsWith("04t"))) {
      const allPackages = packages.map((pack) => ({
        title: `${c.yellow(pack.name)} - ${pack.repoUrl || "Bundle"}`,
        value: pack,
      }));
      allPackages.push({ title: "Other", value: "other" });
      const packageResponse = await prompts({
        type: "select",
        name: "value",
        message: c.cyanBright(`Please select the package you want to install on org  ${c.green(this.org.getUsername())}`),
        choices: allPackages,
        initial: 0,
      });
      if (packageResponse.value === "other") {
        const packageDtlResponse = await prompts([
          {
            type: "text",
            name: "value",
            message: c.cyanBright(
              "What is the id of the Package Version to install ? (starting with 04t)\nYou can find it using tooling api request " +
                c.bold("Select Id,SubscriberPackage.Name,SubscriberPackageVersionId from InstalledSubscriberPackage")
            ),
          },
          {
            type: "text",
            name: "installationkey",
            message: c.cyanBright("Enter the password for this package (leave empty if package is not protected by a password)"),
          },
        ]);
        const pckg: { SubscriberPackageVersionId?: string; installationkey?: string } = {
          SubscriberPackageVersionId: packageDtlResponse.value,
        };
        if (packageDtlResponse.installationkey) {
          pckg.installationkey = packageDtlResponse.installationkey;
        }
        packagesToInstall.push(pckg);
      } else if (packageResponse.value.bundle) {
        // Package bundle selected
        const packagesToAdd = packageResponse.value.packages.map((packageId) => {
          return packages.filter((pckg) => pckg.package === packageId)[0];
        });
        packagesToInstall.push(...packagesToAdd);
      } else {
        // Single package selected
        packagesToInstall.push(packageResponse.value.package);
      }
    } else {
      const pckg: { SubscriberPackageVersionId: string; installationkey?: string } = {
        SubscriberPackageVersionId: packageId,
      };
      if (this.flags.installationkey) {
        pckg.installationkey = this.flags.installationkey;
      }
      packagesToInstall.push(pckg);
    }

    // Complete packages with remote information
    const packagesToInstallCompleted = await Promise.all(
      packagesToInstall.map(async (pckg) => {
        if (pckg.SubscriberPackageVersionId == null) {
          const configResp = await axios.get(pckg.configUrl);
          const packageAliases = configResp.data.packageAliases || [];
          pckg.SubscriberPackageName = pckg.package;
          if (pckg.package.includes("@")) {
            pckg.SubscriberPackageVersionId = packageAliases[pckg.package];
          } else {
            // use last occurrence of package alias
            for (const packageAlias of Object.keys(packageAliases)) {
              if (packageAlias.startsWith(pckg.package)) {
                pckg.SubscriberPackageName = packageAlias;
                pckg.SubscriberPackageVersionId = packageAliases[packageAlias];
              }
            }
          }
        }
        return pckg;
      })
    );
    // Install packages
    await MetadataUtils.installPackagesOnOrg(packagesToInstallCompleted, null, this, "install");
    const installedPackages = await MetadataUtils.listInstalledPackages(null, this);
    uxLog(this, c.italic(c.grey("New package list on org:\n" + JSON.stringify(installedPackages, null, 2))));

    if (!isCI) {
      // Manage package install config storage
      await managePackageConfig(installedPackages, packagesToInstallCompleted);
    }

    /* disabled until sfdx multiple package deployment is working >_<
        // Post install actions
        if (!isCI && fs.existsSync(this.sfdxProjectJsonFileName)) {
 
            const postInstallResponse = await prompts([
                {
                    type: 'confirm',
                    name: 'retrieve',
                    message: c.cyanBright('Do you want to retrieve installed package sources in your local branch ?'),
                    initial: true
                },
                {
                    type: 'confirm',
                    name: 'sfdxProject',
                    message: c.cyanBright('Do you want to update your sfdx-project.json ? (advice: yes)'),
                    initial: true
                }
            ]);
            // Retrieve package sources if requested
            if (postInstallResponse.retrieve === true) {
                for (const pckg of packagesToInstallCompleted) {
                    const retrieveCommand = 'sfdx force:source:retrieve' +
                    ` -n ${pckg.key}` +
                    // ` -p ./force-app/main/default` + // let's try without it
                    ' -w 60';
                    try {
                        await execCommand(retrieveCommand, this, { output: true, fail: true, debug: debugMode });
                    } catch (e) {
                        // Ugly workaround but it's a sfdx bug...
                        uxLog(this, c.yellow(`Error while retrieving ${c.bold(pckg.key)} but it may have worked anyway`));
                        if (fs.existsSync(path.join('.', pckg.key))) {
                            await fs.remove(path.join('.', pckg.key));
                        }
                    }
                }
            }
            // Update sfdx-project.json with new unlocked packages folder references, so it is taken in account with force:source:push and force:source:pull
            if (postInstallResponse.sfdxProject === true) {
                const sfdxProjectRaw = await fs.readFile(this.sfdxProjectJsonFileName, 'utf8');
                const sfdxProject = JSON.parse(sfdxProjectRaw);
                let updated = false;
                for (const installedPackage of installedPackages) {
                    const matchInstalled = packagesToInstallCompleted.filter(pckg => pckg.key === installedPackage.SubscriberPackageName);
                    const matchLocal = sfdxProject.packageDirectories.filter(packageDirectory => installedPackage.SubscriberPackageName === packageDirectory.path);
                    if (matchInstalled.length > 0 && matchLocal.length === 0) {
                        sfdxProject.packageDirectories.push({path: installedPackage.SubscriberPackageName});
                        updated = true;
                    }
                }
                if (updated) {
                    await fs.writeFile(this.sfdxProjectJsonFileName, JSON.stringify(sfdxProject, null, 2));
                    uxLog(this, c.cyan('[config] Updated sfdx-project.json to add new package folders'));
                }
            }
        }
        */

    // Return an object to be displayed with --json
    return { outputString: "Installed package(s)" };
  }
}

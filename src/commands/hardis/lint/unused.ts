/* jscpd:ignore-start */
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import * as glob from "glob-promise";
import { uxLog } from "../../../common/utils";
import * as fs from "fs-extra";
//TODO getConfig Unused how to use this ?
// import { getConfig } from "../../../config";
import * as xml2js from "xml2js";
// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);
// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class Unused extends SfdxCommand {
	public static title = "check permission access";
	public static description = "Check if elements(apex class and field) are at least in one permission set";
	public static examples = [
		"$ sfdx hardis:lint:access",
		'$ sfdx hardis:lint:access -e "ApexClass:ClassA, CustomField:Account.CustomField"',
		'$ sfdx hardis:lint:access -i "PermissionSet:permissionSetA, Profile"',
	];
/* jscpd:ignore-start */
	protected static flagsConfig = {
		debug: flags.boolean({
			char: "d",
			default: false,
			description: messages.getMessage("debugMode"),
		}),
		websocket: flags.string({
			description: messages.getMessage("websocket"),
		}),
		skipauth: flags.boolean({
			description: "Skip authentication check when a default username is required",
		}),
	};
	/* jscpd:ignore-end */

	// Comment this out if your command does not require an org username
	protected static requiresUsername = false;
	// Comment this out if your command does not support a hub org username
	protected static supportsDevhubUsername = false;
	// Set this to true if your command requires a project workspace; 'requiresProject' is false by default
	protected static requiresProject = true;

	private parser: xml2js.Parser;
	private directories =[
		"force-app/main/default/lwc",
		"force-app/main/default/flows",
		"force-app/main/default/classes",
		"force-app/main/default/email",
		"force-app/main/default/aura",
		"force-app/main/default/flexipages",
		"force-app/main/default/quickActions",
		"force-app/main/default/objects",
		"force-app/main/default/pages",
		"force-app/main/default/staticresources"
	];
	private objectFieldsDirectory = "force-app/main/default/objects/**/fields/*.*";
	private permissionsetsDirectory = "force-app/main/default/permissionsets/**/*.*";
	private filePath = "force-app/main/default/labels/CustomLabels.labels-meta.xml";


	public async run(): Promise<AnyJson> {
		// const config = await getConfig("user");
		this.parser = new xml2js.Parser();
		const [unusedLabels, nonReferencedFields, draftFiles] = await Promise.all([
			this.verifyLabels(),
			this.verifyFields(),
			this.verifyFlows(),
		]);
		const reports = {
			"Unused Labels Report": unusedLabels,
			"Non-referenced Fields Report": nonReferencedFields,
			"Flow Draft Status Report": draftFiles
		};

		let comment = ':warning: :warning: :warning: :warning: \n\n';
		for (const [title, items] of Object.entries(reports)) {
			if (items.length > 0) {
				comment += `**${title}** \n\nThe following have not been put to use:\n\n${items.map(item => `- :${this.getEmojiForReport(title)}: ${item}`).join('\n')}\n\n`;
			}
		}
		if (Object.values(reports).some(items => items.length > 0)) {
			comment += 'Please consider revisiting them.\n\n:warning: :warning: :warning: :warning:';
		}

		//TODO REMOVE just for debug
		uxLog(this,comment);

		//TODO post comment with gitProvider class ?

		return {};
	}

	private reportEmojis = new Map<string, string>([
		["Unused Labels Report", "label"],
		["Non-referenced Fields Report", "memo"],
		["Flow Draft Status Report", "zap"],
	]);


	private getEmojiForReport(reportTitle: string): string {
		return this.reportEmojis.get(reportTitle) || "label";
	}

	private async verifyFields(): Promise<string[]> {
		const nonReferencedFields = [];
		const ignoreNames = ['Activity'];
		const ignoreSuffixes = ['__mdt', '__e'];
		const fieldFiles = await glob(this.objectFieldsDirectory);
		const filteredFieldFiles = fieldFiles.filter(file => {
			const objectName = file.split('/').slice(-3, -2)[0];
			return !ignoreNames.includes(objectName) && !ignoreSuffixes.some(suffix => objectName.endsWith(suffix));
		});

		const fieldContentsPromises = filteredFieldFiles.map(fieldFile => fs.readFile(fieldFile, 'utf-8'));
		const fieldContents = await Promise.all(fieldContentsPromises);
		const fieldResults = await Promise.all(fieldContents.map(content => this.parser.parseStringPromise(content)));

		for (let i = 0; i < fieldResults.length; i++) {
			const fieldResult = fieldResults[i];
			if (fieldResult && fieldResult.CustomField && fieldResult.CustomField.fullName && fieldResult.CustomField.fullName[0].endsWith("__c")) {
				if (fieldResult.CustomField.type) {
					const fieldType = fieldResult.CustomField.type[0];
					const isFieldRequired = fieldResult.CustomField.required && fieldResult.CustomField.required[0] === 'true';
					if (fieldType !== 'MasterDetail' && !isFieldRequired) {
						const fieldFile = filteredFieldFiles[i];
						const objectName = fieldFile.split('/').slice(-3, -2)[0];
						const fullFieldName = `${objectName}.${fieldResult.CustomField.fullName[0]}`;
						const isFieldReferenced = await this.checkFieldPresenceInPermissionSets(fullFieldName);
						if (!isFieldReferenced) {
							nonReferencedFields.push(fullFieldName);
						}
					}
				}
			}
		}
		return nonReferencedFields;
	}

	private async checkFieldPresenceInPermissionSets(fullFieldName: string): Promise<boolean> {
		const permissionFiles = await glob(this.permissionsetsDirectory);
		for (const file of permissionFiles) {
			const content = await fs.readFile(file, 'utf-8');
			if (content.includes(`<field>${fullFieldName}</field>`)) {
				return true;
			}
		}
		return false;
	}

	private async verifyLabels(): Promise<string[]> {
		const unusedLabels = [];
		fs.readFile(this.filePath, 'utf-8', (errorReadingFile, data) => {
			if (errorReadingFile) throw errorReadingFile;

			xml2js.parseString(data, (errorParseString, result) => {
				if (errorParseString) throw errorParseString;

				const labelsArray = result.CustomLabels.labels.map(label => label.fullName[0]);
				const files = [];
				this.directories.forEach(directory => {
					const directoryFiles = glob.sync(`${directory}/**/*.*`);
					directoryFiles.forEach(file => {
						const content = fs.readFileSync(file, 'utf-8').toLowerCase();
						files.push(content);
					});
				});

				labelsArray.forEach(label => {
					const labelLower = `label.${label.toLowerCase()}`;
					const cLower = `c.${label.toLowerCase()}`;
					const found = files.some(content => content.includes(labelLower) || content.includes(cLower));
					if (!found) {
						unusedLabels.push(label);
					}
				});
			});
		});
		return unusedLabels;
	}

	private async verifyFlows(): Promise<string[]> {
		const flowDirectoryFiles = await glob("force-app/main/default/flows/**/*.*");
		const fileContentsPromises = flowDirectoryFiles.map(file => fs.readFile(file, 'utf-8'));
		const fileContents = await Promise.all(fileContentsPromises);
		return flowDirectoryFiles.filter((file, i) => fileContents[i].includes("<status>Draft</status>"));
	}
}

import * as child from 'child_process';
import * as fs from 'fs-extra';
import * as util from 'util';
import * as xml2js from 'xml2js' ;
const exec = util.promisify(child.exec);

let pluginsStdout = null ;

// Install plugin if not present
export async function checkSfdxPlugin(pluginName: string): Promise<{installed: boolean, message: string}> {
    let installed = false ;
    if (pluginsStdout == null) {
        const pluginsRes = await exec('sfdx plugins');
        pluginsStdout = pluginsRes.stdout;
    }
    if (!pluginsStdout.includes(pluginName)) {
        await exec(`sfdx plugins:install ${pluginName}`);
        installed = true;
    }
    return {
        installed,
        message: (installed) ?
            `[sfdx-hardis] Installed sfdx plugin ${pluginName}` :
            `[sfdx-hardis] sfdx plugin ${pluginName} is already installed`
    };
}

// Filter package XML
export async function filterPackageXml(packageXmlFile: string, packageXmlFileOut: string, removeMetadatas: string[]):
                                        Promise<{updated: boolean, message: string}> {
    let updated = false ;
    let message = `[sfdx-hardis] ${packageXmlFileOut} not updated`;
    const initialFileContent = fs.readFileSync(packageXmlFile);
    const manifest = await xml2js.parseStringPromise(initialFileContent);
    manifest.Package.types = manifest.Package.types.filter((type: any) => !removeMetadatas.includes(type.name[0]));
    const builder = new xml2js.Builder();
    const updatedFileContent = builder.buildObject(manifest);
    if (updatedFileContent !== initialFileContent) {
        fs.writeFileSync(packageXmlFileOut, updatedFileContent);
        updated = true;
        message = `[sfdx-hardis] ${packageXmlFile} has been filtered to ${packageXmlFileOut}`;
    }
    return {
        updated,
        message
      };
}

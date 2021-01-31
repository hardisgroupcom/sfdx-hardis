import { cosmiconfig } from 'cosmiconfig';
const moduleName = 'sfdx-hardis';

export const getConfig = async () => {
    const configExplorer = await cosmiconfig(moduleName, {
        searchPlaces: [
            'package.json',
            `.${moduleName}rc`,
            `.${moduleName}rc.json`,
            `.${moduleName}.json`,
            `.${moduleName}rc.yaml`,
            `.${moduleName}.yaml`,
            `.${moduleName}rc.yml`,
            `.${moduleName}.yml`,
            `.${moduleName}rc.js`,
            `.${moduleName}rc.cjs`,
            `${moduleName}.config.js`,
            `${moduleName}.config.cjs`
    ]}).search();
    const config = (configExplorer != null) ? configExplorer.config : {};
    return config ;
};

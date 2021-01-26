import * as sfdx from 'sfdx-node';

export const hook = async (options: any) => {
    if (options.Command && options.Command.requiresUsername === true) {
        const orgInfoResult = await sfdx.org.display();
        if (!(orgInfoResult && orgInfoResult.connectedStatus && orgInfoResult.connectedStatus.includes('Connected'))) {
            console.log('You must be connected to an org to perform this command. Please login in the open web browser');
            const loginResult = await sfdx.auth.webLogin({setdefaultusername: true});
            if (loginResult?.instanceUrl != null) {
                console.log(`Successfully logged to ${loginResult.instanceUrl} with username ${loginResult.username}\nYou have have to run again the command`);
            } else {
                console.error('You must be logged to an org to perform this action');
            }
        }
    }
};

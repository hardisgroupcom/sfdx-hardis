export class UtilsNotifs {

    public static isSlackAvailable() {
        if( process.env.SLACK_TOKEN) {
            return true;
        }
        return false;
    }

    public static markdownLink( label: string,url: string) {
        return `<${url}|*${label}*>`
    }

}
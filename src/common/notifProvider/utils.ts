export class UtilsNotifs {

    public static isSlackAvailable() {
        if (process.env.SLACK_TOKEN) {
            return true;
        }
        return false;
    }

    public static isMsTeamsAvailable() {
        if (process.env.MS_TEAMS_WEBHOOK_URL) {
            return true;
        }
        return false;
    }

    public static markdownLink(label: string, url: string) {
        return `<${url}|*${label}*>`
    }

    public static prefixWithSeverityEmoji(text: string, severity: 'critical' | 'error' | 'warning' | 'info' | 'success' | null) {
        const emojis = {
            "critical": '💥',
            "error": '❌',
            "warning": '⚠️',
            "info": 'ℹ️',
            "success": '✅'
        }
        const emoji = emojis[severity] || emojis["info"];
        return `${emoji} ${text}`;
    }

}
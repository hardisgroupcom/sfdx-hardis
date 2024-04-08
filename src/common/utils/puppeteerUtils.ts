import * as puppeteer from "puppeteer";

export class PuppeteerWrapper {

    public browser: puppeteer.Browser;
    public page: puppeteer.Page;
    private instanceUrl: string;
    private accessToken: string;
    private options: any;

    constructor(instanceUrl: string, accessToken: string, options = {}) {
        this.instanceUrl = instanceUrl;
        this.accessToken = accessToken;
        this.options = options;
    }

    async start() {
        this.browser = await puppeteer.launch({
            args: ["--no-sandbox",
                "--disable-setuid-sandbox",
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ],
            headless: !(this.options.debug === true),
        });
        this.page = await this.browser.newPage();
    }

    async login() {
        // Build login url
        const loginUrl = `${this.instanceUrl}/secur/frontdoor.jsp?sid=${this.accessToken}`;
        // Process login page
        await this.page.goto(loginUrl, { waitUntil: ["domcontentloaded", "networkidle0"] });
        await this.page.waitForNavigation();
        return this.page;
    }

    async waitForSelectorInFrameOrPage(page: puppeteer.Page, selector: string): Promise<puppeteer.Page | puppeteer.Frame> {
        await page.waitForSelector(`pierce/iframe[name^=vfFrameId], ${selector}`);
        const frameElementHandle = await page.$(`pierce/iframe[name^=vfFrameId]`);
        let frameOrPage: puppeteer.Page | puppeteer.Frame = page;
        if (frameElementHandle) {
            const frame = await page.waitForFrame(
                async (f) => f.name().startsWith('vfFrameId') && f.url()?.length > 0 && f.url() !== 'about:blank'
            );
            frameOrPage = frame;
        }
        await frameOrPage.waitForSelector(selector);
        return frameOrPage;
    }

}


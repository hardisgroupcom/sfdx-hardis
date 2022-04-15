import { SfdxError } from "@salesforce/core";
import * as puppeteer from 'puppeteer-core';

export async function restoreListViewMine(listViewFileName: string, conn: any, options: any = { debug: false }) {
    // Build start URL to see the listview
    const m = listViewFileName.match(/objects\/(.*)\/listViews\/(.*)\.listView-meta\.xml/gi);
    if (!m) {
        throw new SfdxError(`Unable to find list view object and name in ${listViewFileName}`)
    }
    const objectName = m[1];
    const listViewName = m[2];
    const baseUrl = conn.getConnection().instanceUrl;
    const setupObjectUrl = `${baseUrl}/lightning/o/${objectName}/list?filterName=${listViewName}`;
    // Open ListView url in org
    const browser = await puppeteer.launch({ headless: !(options.debug === true) });
    const page = await browser.newPage();
    await page.goto(setupObjectUrl);
    // Open ListView settings
    await page.click(".listViewManagerHeaderButton .filterButton");
    await page.click(`//*[@innerHTML="Filter by Owner"]`);
    await page.click(`//*[@value="Mine"]`);
    await page.click(`//*[@innerHTML="Done"]`);
    await page.click(`.slds-button .slds-button_brand .saveButton .headerButton`)
    await browser.close();
}
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import * as puppeteer from 'puppeteer';
import * as yaml from 'js-yaml';
import { uxLog } from './index.js';
import { SfError } from '@salesforce/core';

const listViewRegex = /objects\/(.*)\/listViews\/(.*)\.listView-meta\.xml/gi;

export async function restoreListViewMine(listViewStrings: Array<string>, conn: any, options: any = { debug: false }) {
  const listViewItems: any[] = [];
  for (const listViewStr of listViewStrings) {
    // Format Object:ListViewName
    const splits = listViewStr.split(':');
    if (splits.length === 2) {
      listViewItems.push({ object: splits[0], listViewName: splits[1] });
    } else {
      // sfdx file path format
      listViewRegex.lastIndex = 0;
      const m = listViewRegex.exec(listViewStr);
      if (!m) {
        uxLog(
          this,
          c.red(
            `Unable to find list view object and name from ${listViewStr}. Use format ${c.bold(
              'Object:ListViewName'
            )} , or ${c.bold('.../objects/OBJECT/listViews/LISTVIEWNAME.listview-meta.xml')}`
          )
        );
        continue;
      }
      listViewItems.push({ object: m[1], listViewName: m[2] });
    }
  }

  // Build login url
  const instanceUrl = conn.instanceUrl;
  const loginUrl = `${instanceUrl}/secur/frontdoor.jsp?sid=${conn.accessToken}`;

  // Start puppeteer
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: !(options.debug === true),
  });
  const page = await browser.newPage();

  // Process login page
  await page.goto(loginUrl, { waitUntil: ['domcontentloaded', 'networkidle0'] });

  const success: any[] = [];
  const failed: any[] = [];
  const unnecessary: any[] = [];

  // Restore list views with Mine option
  for (const listView of listViewItems) {
    const objectName = listView.object;
    const listViewName = listView.listViewName;

    // Build start URL to see the listview
    const instanceUrl = conn.instanceUrl;
    const setupObjectUrl = `${instanceUrl}/lightning/o/${objectName}/list?filterName=${listViewName}`;

    try {
      // Open ListView url in org
      const navigationPromise = page.waitForNavigation();
      await page.goto(setupObjectUrl);
      await navigationPromise;

      // Open ListView settings
      const filterButton = await page.waitForSelector('.filterButton');
      if (filterButton) {
        await filterButton.click();
      } else {
        throw new SfError('Puppeteer: .filterButton not found');
      }

      // Open Filter by owner popup
      const filterByOwnerButtons = await page.waitForSelector("xpath///div[contains(text(), 'Filter by Owner')]");
      if (filterByOwnerButtons) {
        await filterByOwnerButtons.click();
      } else {
        throw new SfError('Puppeteer: .filterByOwnerButtons not found');
      }

      // Select Mine value
      const mineValue = await page.waitForSelector('input[value="mine"]');
      if (mineValue) {
        const mineValueClickableLabel = await mineValue.$('following-sibling::*');
        if (mineValueClickableLabel) {
          await mineValueClickableLabel[0].click();
        }
      } else {
        throw new SfError('Puppeteer: input[value="mine"] not found');
      }

      // Click done
      const doneButtons = await page.waitForSelector("xpath///span[contains(text(), 'Done')]");
      if (doneButtons) {
        await doneButtons.click();
      } else {
        throw new SfError('Puppeteer: Done button not found');
      }

      // Save
      try {
        const saveButton = await page.waitForSelector('.saveButton', { timeout: 3000 });
        if (saveButton) {
          await saveButton.click();
        } else {
          throw new SfError('Puppeteer: .saveButton not found');
        }
      } catch {
        unnecessary.push(`${objectName}:${listViewName}`);
        uxLog(
          this,
          c.yellow(
            `Unable to hit save button, but it's probably because ${objectName}.${listViewName} was already set to "Mine"`
          )
        );
        continue;
      }

      // Confirmed saved toast
      await page.waitForSelector("xpath///span[contains(text(), 'List view updated.')]");
      success.push(`${objectName}:${listViewName}`);
      uxLog(this, c.green(`Successfully set ${objectName}.${listViewName} as "Mine"`));
    } catch (e) {
      // Unexpected puppeteer error
      failed.push(`${objectName}:${listViewName}`);
      uxLog(this, c.red(`Puppeteer error while processing ${objectName}:${listViewName}: ${(e as Error).message}`));
    }
  }
  // Close puppeteer browser
  await browser.close();
  return { success, failed, unnecessary };
}

// List all yml files in config/branches and build list of major orgs from them
export async function listMajorOrgs() {
  const majorOrgs: any[] = [];
  const branchConfigPattern = '**/config/branches/.sfdx-hardis.*.yml';
  const configFiles = await glob(branchConfigPattern);
  for (const configFile of configFiles) {
    const props = yaml.load(fs.readFileSync(configFile, 'utf-8')) || {};
    listViewRegex.lastIndex = 0;
    const branchNameRegex = /\.sfdx-hardis\.(.*)\.yml/gi;
    const m = branchNameRegex.exec(configFile);
    if (m) {
      props.branchName = m[1];
    }
    majorOrgs.push(props);
  }
  return majorOrgs;
}

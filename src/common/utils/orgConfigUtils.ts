import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import puppeteer, { Browser } from 'puppeteer-core';
import sortArray from 'sort-array';
import * as chromeLauncher from 'chrome-launcher';
import * as yaml from 'js-yaml';
import { uxLog } from './index.js';
import { Connection, SfError } from '@salesforce/core';
import { DescribeSObjectResult } from '@jsforce/jsforce-node';

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

  // Get chrome/chromium executable path
  let chromeExecutablePath = process.env?.PUPPETEER_EXECUTABLE_PATH || "";
  if (chromeExecutablePath === "" || !fs.existsSync(chromeExecutablePath)) {
    const chromePaths = chromeLauncher.Launcher.getInstallations();
    if (chromePaths && chromePaths.length > 0) {
      chromeExecutablePath = chromePaths[0];
    }
  }

  // Start puppeteer
  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: !(options.debug === true),
      executablePath: chromeExecutablePath
    });
  } catch (e: any) {
    uxLog(this, c.red("List View with Mine has not been restored: Error while trying to launch puppeteer (Browser simulator)"));
    uxLog(this, c.red(e.message));
    uxLog(this, c.red("You might need to set variable PUPPETEER_EXECUTABLE_PATH with the target of a Chrome/Chromium path. example: /usr/bin/chromium-browser"));
    return { error: e };
  }
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
    const props = (yaml.load(fs.readFileSync(configFile, 'utf-8')) || {}) as any;
    listViewRegex.lastIndex = 0;
    const branchNameRegex = /\.sfdx-hardis\.(.*)\.yml/gi;
    const m = branchNameRegex.exec(configFile);
    if (m) {
      props.branchName = m[1];
    }
    majorOrgs.push(props);
  }
  // Clumsy sorting but not other way :/
  const majorOrgsSorted: any = [];
  // Main
  for (const majorOrg of majorOrgs) {
    if (isProduction(majorOrg?.branchName || "")) {
      majorOrg.level = majorOrg.level || 100;
      majorOrgsSorted.push(majorOrg);
    }
  }
  // Preprod
  for (const majorOrg of majorOrgs) {
    if (isPreprod(majorOrg?.branchName || "")) {
      majorOrg.level = majorOrg.level || 90;
      majorOrgsSorted.push(majorOrg);
    }
  }
  // uat run
  for (const majorOrg of majorOrgs) {
    if (isUatRun(majorOrg?.branchName || "")) {
      majorOrg.level = majorOrg.level || 80;
      majorOrgsSorted.push(majorOrg);
    }
  }
  // uat
  for (const majorOrg of majorOrgs) {
    if (isUat(majorOrg?.branchName || "")) {
      majorOrg.level = majorOrg.level || 70;
      majorOrgsSorted.push(majorOrg);
    }
  }
  // integration
  for (const majorOrg of majorOrgs) {
    if (isIntegration(majorOrg?.branchName || "")) {
      majorOrg.level = majorOrg.level || 50;
      majorOrgsSorted.push(majorOrg);
    }
  }
  // Add remaining major branches
  for (const majorOrg of sortArray(majorOrgs, { by: ['branchName'], order: ['asc'] }) as any[]) {
    if (majorOrgsSorted.filter(org => org.branchName === majorOrg.branchName).length === 0) {
      majorOrg.level = majorOrg.level || 40;
      majorOrgsSorted.push(majorOrg);
    }
  }
  const completedMajorOrgs = majorOrgsSorted.map((majorOrg: any) => {
    if (majorOrg?.mergeTargets?.length > 0) {
      return majorOrg;
    }
    majorOrg.mergeTargets = guessMatchingMergeTargets(majorOrg.branchName, majorOrgs);
    return majorOrg;
  });
  return completedMajorOrgs;
}

function guessMatchingMergeTargets(branchName: string, majorOrgs: any[]): string[] {
  if (isProduction(branchName)) {
    return [];
  }
  else if (isPreprod(branchName)) {
    return majorOrgs.filter(org => isProduction(org.branchName)).map(org => org.branchName);
  }
  else if (isUat(branchName)) {
    return majorOrgs.filter(org => isPreprod(org.branchName)).map(org => org.branchName);
  }
  else if (isUatRun(branchName)) {
    return majorOrgs.filter(org => isPreprod(org.branchName)).map(org => org.branchName);
  }
  else if (isIntegration(branchName)) {
    return majorOrgs.filter(org => isUat(org.branchName)).map(org => org.branchName);
  }
  uxLog(this, c.yellow(`Unable to guess merge targets for ${branchName}.
Please set them manually in config/branches/.sfdx-hardis.${branchName}.yml
Example:
mergeTargets:
  - preprod
`));
  return [];
}

export function isProduction(branchName) {
  return branchName.toLowerCase().startsWith("prod") || branchName.toLowerCase().startsWith("main");
}

export function isPreprod(branchName) {
  return branchName.toLowerCase().startsWith("preprod") || branchName.toLowerCase().startsWith("staging");
}

export function isUat(branchName) {
  return (branchName.toLowerCase().startsWith("uat") || branchName.toLowerCase().startsWith("recette")) && !branchName.toLowerCase().includes("run");
}

export function isIntegration(branchName) {
  return branchName.toLowerCase().startsWith("integ");
}

export function isUatRun(branchName) {
  return (branchName.toLowerCase().startsWith("uat") || branchName.toLowerCase().startsWith("recette")) && branchName.toLowerCase().includes("run");
}

export async function checkSfdxHardisTraceAvailable(conn: Connection) {
  let traceObject: DescribeSObjectResult;
  try {
    traceObject = await conn.sobject("SfdxHardisTrace__c").describe();
  } catch (e: any) {
    throw new SfError("You need a Custom Setting of type List (activate through Schema Settings), named SfdxHardisTrace__c, with Type__c and Key__c fields (both string, length 80)\n" + e.message);
  }
  const traceObjectFields = traceObject.fields;
  if (traceObjectFields.filter(field => field.name === "Type__c").length === 0) {
    throw new SfError("You need a field Type__c (string, length 80) on SfdxHardisTrace__c in target org");
  }
  if (traceObjectFields.filter(field => field.name === "Key__c").length === 0) {
    throw new SfError("You need a field Key__c (string, length 80) on SfdxHardisTrace__c in target org");
  }
}
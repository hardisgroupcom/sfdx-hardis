import { countRegexMatches, uxLog } from "./index.js";
import c from "chalk";
import readFilesRecursive from "fs-readdir-recursive";
import * as path from "path";
import * as fs from "fs";
import { getPullRequestScopedSfdxHardisConfig } from "./pullRequestUtils.js";
import { CommonPullRequestInfo } from "../gitProvider/index.js";
import { t } from './i18n.js';

function findSubstringInFile(filePath: string, substring: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const content = data.toLowerCase();
      substring = substring.toLowerCase();
      resolve(content.indexOf(substring) !== -1);
    });
  });
}

// Detect all test classes under the repository
export async function getApexTestClasses(classRegexFilter: string = "", excludeSeeAllData = false) {
  const pathToBrowser = process.cwd();
  uxLog("log", this, c.grey(t('findingAllRepositoryApexTestsIn', { pathToBrowser: c.bold(pathToBrowser) })));

  // Find all APEX classes
  const testClasses: any[] = [];
  const allFiles = await readFilesRecursive(pathToBrowser)
    .filter((file) => !file.includes("node_modules") && file.includes("classes") && file.endsWith(".cls"))
    .map((file) => {
      return { fullPath: file, fileName: path.basename(file) };
    });

  // Detect test classes
  for (const entry of allFiles) {
    const isTestClass = await findSubstringInFile(entry.fullPath, "@IsTest");
    if (isTestClass) {
      const className = entry.fileName.substring(0, entry.fileName.length - 4);
      // Check if need to exclude SeeAllData=true
      if (excludeSeeAllData === true && (await findSubstringInFile(entry.fullPath, "SeeAllData=true"))) {
        uxLog("log", this, c.grey(t('filteredClassBecauseIsContainsSeealldataTrue', { className })));
        continue;
      }
      // Check if regex filter
      if (await matchRegexFilter(classRegexFilter, className)) {
        testClasses.push(className);
      }
    }
  }

  uxLog("log", this, c.grey(t('foundApexTests', { testClasses: c.bold(testClasses.join()) })));
  return testClasses;
}

export async function selectTestClassesFromPullRequests(pullRequests: CommonPullRequestInfo[], allAvailableTestClasses: string[]) {
  const selectedTestClasses: Set<string> = new Set<string>();
  const checkTestClassesExistence = allAvailableTestClasses && allAvailableTestClasses.length > 0;
  for (const pr of pullRequests) {
    const prConfigParsed = await getPullRequestScopedSfdxHardisConfig(pr);
    if (prConfigParsed && prConfigParsed['deploymentApexTestClasses'] && Array.isArray(prConfigParsed['deploymentApexTestClasses'])) {
      const prTestClasses = prConfigParsed['deploymentApexTestClasses'] as string[];
      for (const testClass of prTestClasses) {
        if (!checkTestClassesExistence) {
          selectedTestClasses.add(testClass);
        }
        else if (checkTestClassesExistence && allAvailableTestClasses.includes(testClass)) {
          selectedTestClasses.add(testClass);
        } else {
          uxLog("warning", this, c.yellow(t('testClassFromPrIsNotAvailable', { testClass, pr: pr.idStr })));
        }
      }
    }
  }
  return Array.from(selectedTestClasses).sort((a, b) => a.localeCompare(b));
}

async function matchRegexFilter(classRegexFilter: string, className: string) {
  if (classRegexFilter && classRegexFilter !== "") {
    if ((await countRegexMatches(new RegExp(classRegexFilter), className)) > 0) {
      return true;
    }
    uxLog("log", this, c.grey(t('filteredClassBecauseNotMatchingRegexp', { className, classRegexFilter })));
    return false;
  }
  return true;
}

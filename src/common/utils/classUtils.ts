import { uxLog } from ".";
import * as c from "chalk";
import * as readFilesRecursive from "fs-readdir-recursive";
import * as path from "path";
import * as fs from 'fs';

function findSubstringInFile(filePath: string, substring: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
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
export async function getApexTestClasses() {
  const pathToBrowser = process.cwd();
  uxLog(this, c.grey(`Finding all repository APEX tests in ${c.bold(pathToBrowser)}`));

  // Find all APEX classes
  const testClasses = [];
  const allFiles = await readFilesRecursive(pathToBrowser)
    .filter((file) => !file.includes("node_modules") && file.includes("classes") && file.endsWith(".cls"))
    .map((file) => {
      return { fullPath: file, fileName: path.basename(file) };
    });

  // Detect test classes
  for (const entry of allFiles) {
    const isTestClass = await findSubstringInFile(entry.fullPath, '@IsTest');
    if(isTestClass) {
      const className = entry.fileName.substring(0,entry.fileName.length - 4);
      testClasses.push(className);
    }
  }

  uxLog(this, c.grey(`Found APEX tests: ${c.bold(testClasses.join())}`));
  return testClasses;
}
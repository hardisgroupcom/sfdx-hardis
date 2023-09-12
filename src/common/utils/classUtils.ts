import { uxLog } from ".";
import * as c from "chalk";

// Detect all test classes under the repository
export async function getTestClasses() {
  uxLog(this, c.grey("Finding all repository test classes"));
  return [];
}
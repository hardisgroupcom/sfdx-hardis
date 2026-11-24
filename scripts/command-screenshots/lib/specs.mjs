/**
 * The specs of the command screenshots: one YAML file per command under specs/, at the path of
 * the command id without its "hardis" topic (hardis:org:diagnose:unusedusers is
 * specs/org/diagnose/unusedusers.yml).
 */
import fs from "fs";
import path from "path";
import YAML from "yaml";

export const ORG_KINDS = ["showcase", "devhub", "throwaway", "none"];
export const MODES = ["live", "replay"];

/** Every spec of the folder, with the file it comes from. */
export function loadSpecs(specsDir) {
  const specs = [];
  for (const file of listYamlFiles(specsDir)) {
    const spec = YAML.parse(fs.readFileSync(file, "utf8")) || {};
    spec.file = file;
    specs.push(spec);
  }
  return specs;
}

/**
 * The problems of a spec, as sentences: a spec with problems is not run. `knownCommandIds`, when
 * given, is the list of the commands of the plugin.
 */
export function validateSpec(spec, specsDir, knownCommandIds = null) {
  const problems = [];
  const where = path.relative(specsDir, spec.file);
  // hello:world is a command of the plugin too, with a page of its own
  if (!spec.command || !(String(spec.command).startsWith("hardis:") || knownCommandIds?.includes(spec.command))) {
    problems.push(`${where}: "command" must be a command id of the plugin`);
    return problems;
  }
  const expected = specFileOf(specsDir, spec.command);
  if (path.resolve(expected) !== path.resolve(spec.file)) {
    problems.push(`${where}: the spec of ${spec.command} must be ${path.relative(specsDir, expected)}`);
  }
  if (knownCommandIds && !knownCommandIds.includes(spec.command)) {
    problems.push(`${where}: ${spec.command} is not a command of sfdx-hardis`);
  }
  if (spec.skip) {
    return problems;
  }
  if (!spec.run || !String(spec.run).startsWith(`sf ${spec.command}`)) {
    problems.push(`${where}: "run" must start with "sf ${spec.command}"`);
  }
  if (spec.org && !ORG_KINDS.includes(spec.org)) {
    problems.push(`${where}: "org" must be one of ${ORG_KINDS.join(", ")}`);
  }
  if (spec.mode && !MODES.includes(spec.mode)) {
    problems.push(`${where}: "mode" must be one of ${MODES.join(", ")}`);
  }
  for (const answer of spec.answers || []) {
    if (!answer.q) {
      problems.push(`${where}: every answer needs "q", a regular expression on the question`);
    }
    if (answer.choice === undefined && !("value" in answer)) {
      problems.push(`${where}: the answer to /${answer.q}/ needs "choice" or "value"`);
    }
  }
  return problems;
}

/** The specs whose command matches one of the patterns (ids, "org:diagnose:*", "*"). */
export function selectSpecs(specs, patterns) {
  if (!patterns || patterns.length === 0) {
    return specs;
  }
  const matchers = patterns.map(toMatcher);
  return specs.filter((spec) => matchers.some((matcher) => matcher(spec.command)));
}

/** The specs file of a command id. */
export function specFileOf(specsDir, commandId) {
  return path.join(specsDir, ...commandPathParts(commandId)) + ".yml";
}

/** "hardis:org:diagnose:unusedusers" -> "org-diagnose-unusedusers" */
export function slugOf(commandId) {
  return commandPathParts(commandId).join("-");
}

/** "hardis:org:diagnose:unusedusers" -> ["org", "diagnose", "unusedusers"] */
export function commandPathParts(commandId) {
  const parts = String(commandId).split(":");
  return parts[0] === "hardis" ? parts.slice(1) : parts;
}

function toMatcher(pattern) {
  // "org:diagnose:*" stands for "hardis:org:diagnose:*", "hello:world" for itself
  const toRegex = (text) =>
    new RegExp(
      "^" +
        text
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$"
    );
  const regexes = pattern.startsWith("hardis:") || pattern === "*" ? [toRegex(pattern)] : [toRegex(pattern), toRegex(`hardis:${pattern}`)];
  return (commandId) => regexes.some((regex) => regex.test(commandId));
}

function listYamlFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listYamlFiles(full);
      }
      return entry.name.endsWith(".yml") ? [full] : [];
    })
    .sort();
}

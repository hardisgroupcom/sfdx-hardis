// Base class of the replacement rule types. A rule type says which part of a file it works on and
// how it changes it. The engine (engine/ruleEngine.ts) finds the files of the deployment, resolves
// the value of the rule for the target org and writes the files; index.ts picks the class of a rule.

import { MergedReplacementRule, ReplacementFileResult, ReplacementTarget } from './utils/types.js';

export interface ReplacementOutcome {
  // Elements or text matches found in the file
  found: number;
  // How many of them were changed or removed
  changed: number;
  status: ReplacementFileResult['status'];
  detail?: string;
}

export interface ReplacementTextOutcome extends ReplacementOutcome {
  content: string;
}

export interface ReplacementRulePrepareOptions {
  target: ReplacementTarget;
  conn?: any;
  targetUsername?: string | null;
  commandThis?: any;
  // Package.xml files of the deployment. None: every file of the package directories
  packageXmlFiles?: string[];
}

export abstract class ReplacementRuleRoot {
  public readonly rule: MergedReplacementRule;
  // text: the raw content of any file, before the XML rules of the same file. xml: the parsed document of an .xml file
  public abstract readonly scope: 'text' | 'xml';

  public constructor(rule: MergedReplacementRule) {
    this.rule = rule;
  }

  /** True when the rule writes a value: its values, its single value, or a secret */
  public needsValue(): boolean {
    return false;
  }

  /** Called once per run, before the files, for what the rule must learn about the target org */
  public async prepare(options: ReplacementRulePrepareOptions): Promise<void> {
    void options;
  }

  /** Change the raw content of a file (scope text) */
  public applyToText(content: string, value: string | null): ReplacementTextOutcome {
    void content;
    void value;
    throw new Error(`Rule ${this.rule.id} does not work on text`);
  }

  /** Change the parsed XML document of a file (scope xml) */
  public applyToXml(doc: any, value: string | null, target: ReplacementTarget): ReplacementOutcome {
    void doc;
    void value;
    void target;
    throw new Error(`Rule ${this.rule.id} does not work on XML`);
  }
}

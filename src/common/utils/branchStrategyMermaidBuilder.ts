import sortArray from "sort-array";
import { prettifyFieldName } from "./flowVisualiser/nodeFormatUtils.js";
import { isIntegration, isPreprod, isProduction } from "./orgConfigUtils.js";


export class BranchStrategyMermaidBuilder {
  private branchesAndOrgs: any[];
  private gitBranches: any[];
  private salesforceOrgs: any[] = [];
  private gitLinks: any[] = [];
  private deployLinks: any[] = [];
  private sbDevLinks: any[] = [];
  private retrofitLinks: any[] = [];
  private mermaidLines: string[] = [];

  constructor(branchesAndOrgs: any[]) {
    this.branchesAndOrgs = branchesAndOrgs;
  }

  public build(options: { format: "list" | "string", withMermaidTag: boolean }): string | string[] {
    this.listGitBranchesAndLinks();
    this.listSalesforceOrgsAndLinks();
    this.generateMermaidLines();
    if (options.withMermaidTag) {
      this.mermaidLines.unshift("```mermaid");
      this.mermaidLines.push("```");
    }
    return options.format === "list" ? this.mermaidLines : this.mermaidLines.join("\n");
  }

  private listGitBranchesAndLinks(): void {
    const branchesWhoAreMergeTargets: string[] = [];
    const branchesMergingInPreprod: string[] = [];
    this.gitBranches = this.branchesAndOrgs.map((branchAndOrg) => {
      const nodeName = branchAndOrg.branchName + "Branch"
      for (const mergeTarget of branchAndOrg.mergeTargets || []) {
        if (!branchesWhoAreMergeTargets.includes(mergeTarget)) {
          branchesWhoAreMergeTargets.push(mergeTarget);
        }
        if (isPreprod(mergeTarget)) {
          branchesMergingInPreprod.push(branchAndOrg.branchName);
        }
        this.gitLinks.push({
          source: nodeName,
          target: mergeTarget + "Branch",
          type: "gitMerge",
          label: "Merge"
        });
      }
      return {
        name: branchAndOrg.branchName,
        nodeName: nodeName,
        label: branchAndOrg.branchName,
        class: isProduction(branchAndOrg.branchName) ? "gitMain" : "gitMajor",
        level: branchAndOrg.level
      };
    });
    // Create feature branches for branches that are not merge targets
    const noMergeTargetBranchAndOrg = this.branchesAndOrgs.filter((branchAndOrg) => !branchesWhoAreMergeTargets.includes(branchAndOrg.branchName));
    if (branchesMergingInPreprod.length < 2 && !noMergeTargetBranchAndOrg.find((branchAndOrg) => isPreprod(branchAndOrg.branchName))) {
      noMergeTargetBranchAndOrg.push(this.branchesAndOrgs.find((branchAndOrg) => isPreprod(branchAndOrg.branchName)));
    }
    for (const branchAndOrg of noMergeTargetBranchAndOrg) {
      const nameBase = isPreprod(branchAndOrg.branchName) ? "hotfix" : "feature";
      const level = branchAndOrg.level - 1
      const nameBase1 = nameBase + "1";
      const nodeName1 = nameBase + "Branch" + "1"
      this.gitBranches.push({
        name: nameBase1,
        nodeName: nodeName1,
        label: nameBase1,
        class: "gitFeature",
        level: level
      });
      this.gitLinks.push({
        source: nodeName1,
        target: this.gitBranches.find((gitBranch) => gitBranch.name === branchAndOrg.branchName)?.nodeName || "ERROR",
        type: "gitMerge",
        label: "Merge"
      });
      const nameBase2 = nameBase + "2";
      const nodeName2 = nameBase + "Branch" + "2"
      this.gitBranches.push({
        name: nameBase2,
        nodeName: nodeName2,
        label: nameBase2,
        class: "gitFeature",
        level: level
      });
      this.gitLinks.push({
        source: nodeName2,
        target: this.gitBranches.find((gitBranch) => gitBranch.name === branchAndOrg.branchName)?.nodeName || "ERROR",
        type: "gitMerge",
        label: "Merge",
        level: level
      });
    }
    const mainBranch = this.branchesAndOrgs.find((branchAndOrg) => isProduction(branchAndOrg.branchName));
    const preprodBranch = this.branchesAndOrgs.find((branchAndOrg) => isPreprod(branchAndOrg.branchName));
    const integrationBranch = this.branchesAndOrgs.find((branchAndOrg) => isIntegration(branchAndOrg.branchName));
    if (mainBranch && preprodBranch && integrationBranch) {
      this.retrofitLinks.push({
        source: mainBranch.branchName + "Branch",
        target: integrationBranch.branchName + "Branch",
        type: "gitMerge",
        label: "Retrofit from RUN to BUILD"
      });
    }
    // Sort branches & links
    this.gitBranches = sortArray(this.gitBranches, { by: ['level', 'name'], order: ['asc', 'asc'] });
    this.gitLinks = sortArray(this.gitLinks, { by: ['level', 'source'], order: ['asc', 'asc'] });
  }

  private listSalesforceOrgsAndLinks(): any {
    for (const gitBranch of this.gitBranches) {
      const branchAndOrg = this.branchesAndOrgs.find((branchAndOrg) => branchAndOrg.branchName === gitBranch.name);
      if (branchAndOrg) {
        // Major org
        const nodeName = branchAndOrg.branchName + "Org";
        this.salesforceOrgs.push({
          name: branchAndOrg.branchName,
          nodeName: branchAndOrg.branchName + "Org",
          label: isProduction(branchAndOrg.branchName) ? "Production Org" : prettifyFieldName(branchAndOrg.branchName) + " Org",
          class: gitBranch.class === "gitMain" ? "salesforceProd" : gitBranch.class === "gitMajor" ? "salesforceMajor" : "salesforceDev",
          level: branchAndOrg.level
        });
        this.deployLinks.push({
          source: gitBranch.nodeName,
          target: nodeName,
          type: "sfDeploy",
          label: "Deploy to Org",
          level: branchAndOrg.level
        });
      }
      else {
        const nodeName = gitBranch.name + "Org";
        this.salesforceOrgs.push({
          name: gitBranch.name,
          nodeName: nodeName,
          label: "Dev " + prettifyFieldName(gitBranch.name),
          class: "salesforceDev",
          level: gitBranch.level
        });
        this.sbDevLinks.push({
          source: nodeName,
          target: gitBranch.nodeName,
          type: "sfPushPull",
          label: "Push / Pull",
          level: gitBranch.level
        });
      }
    }
    // Sort orgs & links
    this.salesforceOrgs = sortArray(this.salesforceOrgs, { by: ['level', 'name'], order: ['desc', 'asc'] });
    this.deployLinks = sortArray(this.deployLinks, { by: ['level', 'source'], order: ['desc', 'asc'] });
    this.sbDevLinks = sortArray(this.sbDevLinks, { by: ['level', 'source'], order: ['asc', 'asc'] });
  }

  private generateMermaidLines() {
    this.mermaidLines.push("flowchart LR");
    this.mermaidLines.push("");

    // Git branches
    this.mermaidLines.push(this.indent("subgraph GitBranches [Git Branches]", 1));
    this.mermaidLines.push(this.indent("direction TB", 2));
    for (const gitBranch of this.gitBranches) {
      this.mermaidLines.push(this.indent(`${gitBranch.nodeName}["${gitBranch.label}"]:::${gitBranch.class}`, 2));
    }
    this.mermaidLines.push(this.indent("end", 1));
    this.mermaidLines.push("");

    // Salesforce orgs
    this.mermaidLines.push(this.indent("subgraph SalesforceOrgs [Salesforce Orgs]", 1));
    this.mermaidLines.push(this.indent("direction TB", 2));
    for (const salesforceOrg of this.salesforceOrgs.filter((salesforceOrg) => ["salesforceProd", "salesforceMajor"].includes(salesforceOrg.class))) {
      this.mermaidLines.push(this.indent(`${salesforceOrg.nodeName}(["${salesforceOrg.label}"]):::${salesforceOrg.class}`, 2));
    }
    this.mermaidLines.push(this.indent("end", 1));
    this.mermaidLines.push("");

    // Salesforce dev orgs
    this.mermaidLines.push(this.indent("subgraph SalesforceDevOrgs [Salesforce Orgs BUILD]", 1));
    this.mermaidLines.push(this.indent("direction TB", 2));
    for (const salesforceOrg of this.salesforceOrgs.filter((salesforceOrg) => salesforceOrg.name.startsWith("feature"))) {
      this.mermaidLines.push(this.indent(`${salesforceOrg.nodeName}(["${salesforceOrg.label}"]):::${salesforceOrg.class}`, 2));
    }
    this.mermaidLines.push(this.indent("end", 1));
    this.mermaidLines.push("");

    // Salesforce dev orgs run
    this.mermaidLines.push(this.indent("subgraph SalesforceDevOrgsRun [Salesforce Orgs RUN]", 1));
    this.mermaidLines.push(this.indent("direction TB", 2));
    for (const salesforceOrg of this.salesforceOrgs.filter((salesforceOrg) => salesforceOrg.name.startsWith("hotfix"))) {
      this.mermaidLines.push(this.indent(`${salesforceOrg.nodeName}(["${salesforceOrg.label}"]):::${salesforceOrg.class}`, 2));
    }
    this.mermaidLines.push(this.indent("end", 1));
    this.mermaidLines.push("");

    // Links
    this.addLinks(this.gitLinks);
    this.addLinks(this.deployLinks);
    this.addLinks(this.sbDevLinks);
    this.addLinks(this.retrofitLinks);

    // Classes and styles
    this.mermaidLines.push(...this.listClassesAndStyles());
  }

  private addLinks(links) {
    for (const link of links) {
      if (link.type === "gitMerge") {
        this.mermaidLines.push(this.indent(`${link.source} -->|"${link.label}"| ${link.target}`, 1));
      } else if (link.type === "sfDeploy") {
        this.mermaidLines.push(this.indent(`${link.source} -. ${link.label} .-> ${link.target}`, 1));
      } else if (link.type === "sfPushPull") {
        this.mermaidLines.push(this.indent(`${link.source} <-. ${link.label} .-> ${link.target}`, 1));
      }
    }
    this.mermaidLines.push("");
  }

  listClassesAndStyles(): string[] {
    const classesAndStyles = `    classDef salesforceDev fill:#A9E8F8,stroke:#004E8A,stroke-width:2px,color:black,font-weight:bold,border-radius:10px;
    classDef salesforceMajor fill:#0088CE,stroke:#004E8A,stroke-width:2px,color:white,font-weight:bold,border-radius:10px;
    classDef salesforceProd fill:blue,stroke:#004E8A,stroke-width:2px,color:white,font-weight:bold,border-radius:10px;
    classDef gitMajor fill:#FFC107,stroke:#D84315,stroke-width:2px,color:black,font-weight:bold,border-radius:10px;
    classDef gitMain fill:#FF6F61,stroke:#FF6F00,stroke-width:2px,color:black,font-weight:bold,border-radius:10px;
    classDef gitFeature fill:#B5EAD7,stroke:#2E7D32,stroke-width:2px,color:black,font-weight:bold,border-radius:10px;
    
    style GitBranches fill:#F4F4F9,stroke:#7C4DFF,stroke-width:1px;
    style SalesforceOrgs fill:#E8F5E9,stroke:#1B5E20,stroke-width:1px;
    style SalesforceDevOrgs fill:#E1F5FE,stroke:#0288D1,stroke-width:1px;
    style SalesforceDevOrgsRun fill:#F3E5F5,stroke:#6A1B9A,stroke-width:1px;
`
    return classesAndStyles.split("\n");
  }

  private indent(str: string, number: number): string {
    return '    '.repeat(number) + str;
  }
}
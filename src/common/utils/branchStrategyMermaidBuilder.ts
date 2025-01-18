import sortArray from "sort-array";
import { prettifyFieldName } from "./flowVisualiser/nodeFormatUtils.js";
import { isIntegration, isPreprod, isProduction } from "./orgConfigUtils.js";


export class BranchStrategyMermaidBuilder {
  private branchesAndOrgs: any[];
  private gitBranches: any[];
  private salesforceOrgs: any[] = [];
  private salesforceDevOrgsGroup: string[] = [];
  private gitLinks: any[] = [];
  private deployLinks: any[] = [];
  private sbDevLinks: any[] = [];
  private retrofitLinks: any[] = [];
  private mermaidLines: string[] = [];
  private featureBranchNb: number = 0;

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
      this.salesforceDevOrgsGroup.push(branchAndOrg.branchName);
      this.addFeatureBranch(nameBase, level, branchAndOrg);
      this.addFeatureBranch(nameBase, level, branchAndOrg);
    }
    // Add retrofit link only if it does not mess with the diagram display :/
    if (branchesMergingInPreprod.length < 2) {
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
    }
    // Sort branches & links
    this.gitBranches = sortArray(this.gitBranches, { by: ['level', 'name'], order: ['asc', 'asc'] });
    this.gitLinks = sortArray(this.gitLinks, { by: ['level', 'source'], order: ['asc', 'asc'] });
  }

  private addFeatureBranch(nameBase: string, level: number, branchAndOrg: any) {
    this.featureBranchNb++;
    const nameBase1 = nameBase + this.featureBranchNb;
    const nodeName1 = nameBase + "Branch" + this.featureBranchNb;
    this.gitBranches.push({
      name: nameBase1,
      nodeName: nodeName1,
      label: nameBase1,
      class: "gitFeature",
      level: level,
      group: branchAndOrg.branchName
    });
    this.gitLinks.push({
      source: nodeName1,
      target: this.gitBranches.find((gitBranch) => gitBranch.name === branchAndOrg.branchName)?.nodeName || "ERROR",
      type: "gitMerge",
      label: "Merge"
    });
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
          level: gitBranch.level,
          group: gitBranch.group
        });
        this.sbDevLinks.push({
          source: nodeName,
          target: gitBranch.nodeName,
          type: "sfPushPull",
          label: "Push / Pull",
          level: gitBranch.level,
        });
      }
    }
    // Sort orgs & links
    this.salesforceOrgs = sortArray(this.salesforceOrgs, { by: ['level', 'name'], order: ['desc', 'asc'] });
    this.deployLinks = sortArray(this.deployLinks, { by: ['level', 'source'], order: ['desc', 'asc'] });
    this.sbDevLinks = sortArray(this.sbDevLinks, { by: ['level', 'source'], order: ['asc', 'asc'] });
  }

  private generateMermaidLines() {
    /* jscpd:ignore-start */
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
    this.mermaidLines.push(this.indent("subgraph SalesforceOrgs [Salesforce Major Orgs]", 1));
    this.mermaidLines.push(this.indent("direction TB", 2));
    for (const salesforceOrg of this.salesforceOrgs.filter((salesforceOrg) => ["salesforceProd", "salesforceMajor"].includes(salesforceOrg.class))) {
      this.mermaidLines.push(this.indent(`${salesforceOrg.nodeName}(["<b>${salesforceOrg.label}</b>"]):::${salesforceOrg.class}`, 2));
    }
    this.mermaidLines.push(this.indent("end", 1));
    this.mermaidLines.push("");

    // Salesforce dev orgs
    for (const devOrgsGroup of this.salesforceDevOrgsGroup) {
      this.mermaidLines.push(this.indent(`subgraph SalesforceDevOrgs${devOrgsGroup} [Salesforce Dev Orgs]`, 1));
      this.mermaidLines.push(this.indent("direction TB", 2));
      for (const salesforceOrg of this.salesforceOrgs.filter((salesforceOrg) => salesforceOrg.group === devOrgsGroup && (salesforceOrg.name.startsWith("feature") || salesforceOrg.name.startsWith("hotfix")))) {
        this.mermaidLines.push(this.indent(`${salesforceOrg.nodeName}(["${salesforceOrg.label}"]):::${salesforceOrg.class}`, 2));
      }
      this.mermaidLines.push(this.indent("end", 1));
      this.mermaidLines.push("");
    }

    // Links
    this.addLinks(this.gitLinks);
    this.addLinks(this.deployLinks);
    this.addLinks(this.sbDevLinks);
    this.addLinks(this.retrofitLinks);

    // Classes and styles
    this.mermaidLines.push(...this.listClassesAndStyles());
    for (const salesforceDevOrgsGroup of this.salesforceDevOrgsGroup) {
      this.mermaidLines.push(`style SalesforceDevOrgs${salesforceDevOrgsGroup} fill:#EBF6FF,color:#000000,stroke:#0077B5,stroke-width:1px;`);
    }
    /* jscpd:ignore-end */
    const allLinks = [...this.gitLinks, ...this.deployLinks, ...this.sbDevLinks, ...this.retrofitLinks];
    let pos = 0;
    const positions: any = {}
    for (const link of allLinks) {
      if (!positions[link.type]) {
        positions[link.type] = [];
      }
      positions[link.type].push(pos);
      pos++;
    }
    const linksDef = this.listLinksDef();
    for (const key of Object.keys(positions)) {
      const styleDef = linksDef[key];
      this.mermaidLines.push(`linkStyle ${positions[key].join(",")} ${styleDef}`);
    }
  }

  private addLinks(links) {
    for (const link of links) {
      if (link.type === "gitMerge") {
        this.mermaidLines.push(this.indent(`${link.source} ==>|"${link.label}"| ${link.target}`, 1));
      } else if (link.type === "sfDeploy") {
        this.mermaidLines.push(this.indent(`${link.source} -. ${link.label} .-> ${link.target}`, 1));
      } else if (link.type === "sfPushPull") {
        this.mermaidLines.push(this.indent(`${link.source} <-. ${link.label} .-> ${link.target}`, 1));
      }
    }
    this.mermaidLines.push("");
  }

  listClassesAndStyles(): string[] {
    const classesAndStyles = `    classDef salesforceDev fill:#9BC3FF,stroke:#2B65D9,stroke-width:2px,color:#000000,font-weight:bold,border-radius:10px;
    classDef salesforceMajor fill:#67B7D1,stroke:#004D66,stroke-width:2px,color:#FFFFFF,font-weight:bold,border-radius:10px;
    classDef salesforceProd fill:#4C98C3,stroke:#003B5A,stroke-width:2px,color:#FFFFFF,font-weight:bold,border-radius:10px;
    classDef gitMajor fill:#FFCA76,stroke:#E65C00,stroke-width:2px,color:#000000,font-weight:bold,border-radius:10px;
    classDef gitMain fill:#F97B8B,stroke:#CC2936,stroke-width:2px,color:#000000,font-weight:bold,border-radius:10px;
    classDef gitFeature fill:#B0DE87,stroke:#2D6A4F,stroke-width:2px,color:#000000,font-weight:bold,border-radius:10px;
    
    style GitBranches fill:#F4F5F9,color:#000000,stroke:#8B72B2,stroke-width:1px;
    style SalesforceOrgs fill:#F1F7F5,color:#000000,stroke:#468C70,stroke-width:1px;
`
    return classesAndStyles.split("\n");
  }

  private listLinksDef(): any {
    return {
      "gitMerge": "stroke:#4B0082,stroke-width:4px,color:#4B0082,background-color:transparent;",
      "sfDeploy": "stroke:#4169E1,stroke-width:2px,color:#4169E1,background-color:transparent;",
      "sfPushPull": "stroke:#5F9EA0,stroke-width:2px,color:#5F9EA0,background-color:transparent;"
    }
  }

  private indent(str: string, number: number): string {
    return '    '.repeat(number) + str;
  }
}
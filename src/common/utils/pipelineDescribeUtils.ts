import { t } from './i18n.js';
import { getPromotionBranchConfig, isPromotionStepAllowed, PromotionStep } from './promotionBranchUtils.js';

export interface PipelineBranch {
  name: string;
  level: number;
  instanceUrl: string | null;
  targetUsername: string | null;
  /** Branches this one is merged into (mergeTargets of its config file, or guessed from its name) */
  mergeTargets: string[];
  /** True when mergeTargets is not declared in the config file of the branch and was guessed from the branch names */
  mergeTargetsGuessed: boolean;
  /** Branches merged into this one, computed from the mergeTargets of the others */
  mergeSources: string[];
}

export interface PipelineStep {
  source: string;
  target: string;
  /** True when a promotion branch (subset of the User Stories) may be assembled on this step */
  promotionBranchAllowed: boolean;
}

export interface PipelineDescription {
  developmentBranch: string;
  availableTargetBranches: string[];
  branches: PipelineBranch[];
  steps: PipelineStep[];
  /** Major branches no other major branch is merged into: where the pipeline starts */
  entryBranches: string[];
  /** Major branches merged into no other one: where the pipeline ends (ex: production) */
  finalBranches: string[];
  promotionBranches: {
    enabled: boolean;
    allowedSteps: PromotionStep[];
  };
  warnings: string[];
  /**
   * What to tell the user when merge targets had to be guessed from branch names, null otherwise.
   * Written for a coding agent reading the JSON result: it names the files to complete.
   */
  mergeTargetsRecommendation: string | null;
}

/**
 * Describe the pipeline of a project as a graph: its major branches, and the steps between them.
 * Nothing here assumes integration -> uat -> preprod -> main: a branch can have several merge
 * targets (a core model feeding several production orgs), and there can be several entry branches.
 *
 * majorOrgs is the result of listMajorOrgs(), config the project configuration.
 */
export function buildPipelineDescription(majorOrgs: any[], config: any): PipelineDescription {
  const promotionConfig = getPromotionBranchConfig(config);
  const promotionUsable = promotionConfig.enabled && promotionConfig.allowedSteps.length > 0;
  const branchNames = majorOrgs.map((majorOrg) => majorOrg.branchName);
  const warnings: string[] = [];

  const branches: PipelineBranch[] = majorOrgs.map((majorOrg) => {
    const mergeTargets = listMergeTargets(majorOrg);
    for (const mergeTarget of mergeTargets) {
      if (!branchNames.includes(mergeTarget)) {
        warnings.push(t('pipelineDescribeWarningTargetWithoutConfig', { target: mergeTarget, branch: majorOrg.branchName }));
      }
    }
    if (majorOrg.mergeTargetsGuessed === true) {
      warnings.push(
        mergeTargets.length > 0
          ? t('pipelineDescribeWarningTargetsGuessed', { branch: majorOrg.branchName, targets: mergeTargets.join(', ') })
          : t('pipelineDescribeWarningTargetsNotGuessed', { branch: majorOrg.branchName }),
      );
    }
    return {
      name: majorOrg.branchName,
      level: majorOrg.level,
      instanceUrl: majorOrg.instanceUrl || null,
      targetUsername: majorOrg.targetUsername || null,
      mergeTargets,
      mergeTargetsGuessed: majorOrg.mergeTargetsGuessed === true,
      mergeSources: majorOrgs
        .filter((otherOrg) => otherOrg.branchName !== majorOrg.branchName && listMergeTargets(otherOrg).includes(majorOrg.branchName))
        .map((otherOrg) => otherOrg.branchName),
    };
  });

  const steps: PipelineStep[] = branches.flatMap((branch) =>
    branch.mergeTargets.map((mergeTarget) => ({
      source: branch.name,
      target: mergeTarget,
      promotionBranchAllowed: promotionUsable && isPromotionStepAllowed(promotionConfig.allowedSteps, branch.name, mergeTarget),
    })),
  );

  const guessedBranches = branches.filter((branch) => branch.mergeTargetsGuessed).map((branch) => branch.name);

  return {
    developmentBranch: config?.developmentBranch || 'integration',
    availableTargetBranches: Array.isArray(config?.availableTargetBranches) ? config.availableTargetBranches : [],
    branches,
    steps,
    entryBranches: branches.filter((branch) => branch.mergeSources.length === 0).map((branch) => branch.name),
    finalBranches: branches.filter((branch) => branch.mergeTargets.length === 0).map((branch) => branch.name),
    promotionBranches: {
      enabled: promotionConfig.enabled,
      allowedSteps: promotionConfig.allowedSteps,
    },
    warnings,
    mergeTargetsRecommendation: guessedBranches.length > 0
      ? t('pipelineDescribeMergeTargetsRecommendation', {
        branches: guessedBranches.join(', '),
        files: guessedBranches.map((branch) => `config/branches/.sfdx-hardis.${branch}.yml`).join(', '),
      })
      : null,
  };
}

/**
 * The rows of the table shown to a human, from the entry branches to the final ones.
 */
export function buildPipelineBranchRows(description: PipelineDescription): any[] {
  return [...description.branches]
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map((branch) => ({
      Branch: branch.name,
      Org: branch.instanceUrl || branch.targetUsername || '',
      'Merged into': branch.mergeTargets.join(', ') + (branch.mergeTargetsGuessed && branch.mergeTargets.length > 0 ? ' (guessed)' : ''),
      'Receives from': branch.mergeSources.join(', '),
    }));
}

function listMergeTargets(majorOrg: any): string[] {
  return Array.isArray(majorOrg?.mergeTargets) ? majorOrg.mergeTargets.filter((mergeTarget: any) => typeof mergeTarget === 'string' && mergeTarget !== '') : [];
}

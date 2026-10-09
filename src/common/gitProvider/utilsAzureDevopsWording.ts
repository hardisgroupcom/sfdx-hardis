// Azure DevOps lets only the author of a Pull Request comment, or a project administrator, edit it.
// The comments of sfdx-hardis are written by the pipeline, most often with its job token (the
// project build service): for anyone else, the box of a manual action cannot be ticked. The
// sentences that ask to tick a box (utilsPrCommentLayout.ts and deploymentActionsStateUtils.ts
// write them) name the VS Code extension instead, in the comments written on Azure DevOps.

const TICK_A_BOX_REGEX = /Tick a box once (?:it|the action) is done in the org: the next sfdx-hardis job records it\./g;
const MARK_AS_DONE_IN_VS_CODE =
  'Once it is done in the org, mark it as done with the **Mark as done** button of the Deployment Actions tab of the Pull Request in VS Code (sfdx-hardis extension), or with `sf hardis:project:action:set-status`: the next sfdx-hardis job reads it. On Azure DevOps a box of this comment can only be ticked by its author or by a project administrator.';
const TICK_THEIR_BOXES = 'Do the steps below in the org, tick their boxes, then run the validation again.';
const MARK_THEM_AS_DONE =
  'Do the steps below in the org, mark them as done with the **Mark as done** button of the Deployment Actions tab of the Pull Request in VS Code (sfdx-hardis extension), then run the validation again.';

/** Rewords, in a comment written on Azure DevOps, the sentences that ask to tick a box. */
export function toAzureDevopsWording(body: string): string {
  if (!body) {
    return body;
  }
  return body.replace(TICK_A_BOX_REGEX, MARK_AS_DONE_IN_VS_CODE).replace(TICK_THEIR_BOXES, MARK_THEM_AS_DONE);
}

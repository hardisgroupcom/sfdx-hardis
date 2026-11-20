// The sentences of the Pull Request comments that ask to tick the box of a manual action. They are
// written by the comment builders, and reworded at the door of the providers where a box cannot be
// ticked by everyone (Azure DevOps) or by anyone (Bitbucket Cloud). One place for both sides: a
// sentence changed here is changed for the builders and for the rewording alike.

export const TICK_HINT_FOR_AN_ACTION = 'Tick a box once the action is done in the org: the next sfdx-hardis job records it.';
export const TICK_HINT_FOR_A_STEP = 'Tick a box once it is done in the org: the next sfdx-hardis job records it.';
export const TICK_THEN_VALIDATE_AGAIN = 'Do the steps below in the org, tick their boxes, then run the validation again.';
export const ONLY_BOXES_ARE_EDITED = 'Only the boxes are meant to be edited in this comment.';

/**
 * Rewords the sentences above in a comment body, every occurrence of each. A replacement left out
 * keeps the sentence as it is written.
 */
export function rewordTickSentences(
  body: string,
  replacements: { tickHint?: string; tickThenValidateAgain?: string; onlyBoxesAreEdited?: string },
): string {
  let result = body;
  if (replacements.tickHint !== undefined) {
    result = result.split(TICK_HINT_FOR_AN_ACTION).join(replacements.tickHint).split(TICK_HINT_FOR_A_STEP).join(replacements.tickHint);
  }
  if (replacements.tickThenValidateAgain !== undefined) {
    result = result.split(TICK_THEN_VALIDATE_AGAIN).join(replacements.tickThenValidateAgain);
  }
  if (replacements.onlyBoxesAreEdited !== undefined) {
    result = result.split(ONLY_BOXES_ARE_EDITED).join(replacements.onlyBoxesAreEdited);
  }
  return result;
}

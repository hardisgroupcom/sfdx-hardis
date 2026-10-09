import { expect } from 'chai';
import { toAzureDevopsWording } from '../../../../src/common/gitProvider/utils/utilsAzureDevopsWording.js';
import { toBitbucketMarkup } from '../../../../src/common/gitProvider/utils/utilsBitbucketMarkup.js';
import {
  ONLY_BOXES_ARE_EDITED,
  rewordTickSentences,
  TICK_HINT_FOR_A_STEP,
  TICK_HINT_FOR_AN_ACTION,
  TICK_THEN_VALIDATE_AGAIN,
} from '../../../../src/common/gitProvider/utils/utilsPrCommentWording.js';

// The comment builders and the rewording of each provider share these sentences: whatever they become,
// a provider where a box cannot be ticked must not be left asking to tick one.
describe('Sentences of the Pull Request comments that ask to tick a box', () => {
  const sentences = [TICK_HINT_FOR_AN_ACTION, TICK_HINT_FOR_A_STEP, TICK_THEN_VALIDATE_AGAIN];

  it('are all reworded on Bitbucket, where nobody can tick a box', () => {
    for (const sentence of sentences) {
      expect(toBitbucketMarkup(sentence), sentence).to.not.match(/\btick\b/i);
    }
    expect(toBitbucketMarkup(ONLY_BOXES_ARE_EDITED)).to.not.contain('boxes');
  });

  it('are all reworded on Azure DevOps, where only the author of a comment can', () => {
    for (const sentence of sentences) {
      expect(toAzureDevopsWording(sentence), sentence).to.contain('**Mark as done** button');
    }
  });

  it('rewords every occurrence, and leaves a sentence with no replacement as it is', () => {
    const body = `${TICK_HINT_FOR_A_STEP}\n\n${TICK_HINT_FOR_AN_ACTION}\n\n${TICK_HINT_FOR_A_STEP}\n\n${TICK_THEN_VALIDATE_AGAIN}`;

    const reworded = rewordTickSentences(body, { tickHint: 'Use the button.' });

    expect(reworded).to.equal(`Use the button.\n\nUse the button.\n\nUse the button.\n\n${TICK_THEN_VALIDATE_AGAIN}`);
  });
});

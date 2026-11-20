import { expect } from 'chai';
import { toAzureDevopsWording } from '../../../../src/common/gitProvider/utils/utilsAzureDevopsWording.js';

// On Azure DevOps only the author of a comment or a project administrator can tick its boxes: the
// comments name the Mark as done button of the VS Code extension.
describe('Azure DevOps wording of Pull Request comments', () => {
  it('names the Mark as done button in the Deployment Actions comment', () => {
    const body = 'Tick a box once the action is done in the org: the next sfdx-hardis job records it. Rerun a failed action with `sf hardis:project:action:run`.';

    const sent = toAzureDevopsWording(body);

    expect(sent).to.not.contain('Tick a box');
    expect(sent).to.contain('**Mark as done** button of the Deployment Actions tab of the Pull Request in VS Code');
    expect(sent).to.contain('`sf hardis:project:action:set-status`');
    expect(sent).to.contain('only be ticked by its author or by a project administrator');
    expect(sent).to.contain('Rerun a failed action with `sf hardis:project:action:run`.');
  });

  it('names it in the validation and deployment comments too', () => {
    expect(toAzureDevopsWording('_Tick a box once it is done in the org: the next sfdx-hardis job records it._')).to.contain('**Mark as done** button');
    expect(toAzureDevopsWording('Do the steps below in the org, tick their boxes, then run the validation again.')).to.equal(
      'Do the steps below in the org, mark them as done with the **Mark as done** button of the Deployment Actions tab of the Pull Request in VS Code (sfdx-hardis extension), then run the validation again.',
    );
  });

  it('leaves the rest of a comment as it is, and does not change a text sent twice', () => {
    const body = '- [ ] <!-- sfdx-hardis-manual-action id:a org:uat pr:1 when:pre-deploy --> Step\n\n| Action | uat |\n|---|---|\n| Step | to do |';

    expect(toAzureDevopsWording(body)).to.equal(body);
    const once = toAzureDevopsWording('Tick a box once it is done in the org: the next sfdx-hardis job records it.');
    expect(toAzureDevopsWording(once)).to.equal(once);
  });
});

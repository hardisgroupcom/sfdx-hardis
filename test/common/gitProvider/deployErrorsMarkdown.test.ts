import { expect } from 'chai';
// Load the barrel first: gitProvider modules take part in a pre-existing import cycle, and
// entering through a leaf module of it throws.
import '../../../src/common/gitProvider/index.js';
import { deployErrorsToMarkdown } from '../../../src/common/gitProvider/utils/utilsMarkdown.js';

describe('deployErrorsToMarkdown component name', () => {
  const tip = { label: 'Custom field not found', docUrl: 'https://example.invalid', message: 'tip' };

  it('puts the whole name of a component holding a space in bold', () => {
    const md = deployErrorsToMarkdown([
      {
        error: {
          fullName: 'Installation__c-Installation Layout',
          message: 'Error Installation__c-Installation Layout In field: field - no CustomField named Installation__c.Crew_Workload__c found',
        },
        tip,
      },
    ]);
    expect(md).to.include(
      '<summary>⛔ <b>Installation__c-Installation Layout</b> In field: field - no CustomField named Installation__c.Crew_Workload__c found</summary>'
    );
  });

  it('puts the first word in bold when the component name is not known', () => {
    const md = deployErrorsToMarkdown([{ error: { message: 'Error Helios_Delivery_Manager In field: x' }, tip }]);
    expect(md).to.include('<summary>⛔ <b>Helios_Delivery_Manager</b> In field: x</summary>');
  });

  it('leaves a message that is not a component error as it is', () => {
    const md = deployErrorsToMarkdown([{ error: { message: 'Connect Timeout Error (x)' }, tip }]);
    expect(md).to.include('<summary>⛔ Connect Timeout Error (x)</summary>');
  });
});

import { expect } from 'chai';
import { handleFilterItems } from '../../../src/common/utils/flowVisualiser/nodeFormatUtils.js';

describe('Flow node format - filters', () => {
  it('keeps the value of an Is Null filter, since Is Null false means "is not null"', () => {
    const node: any = {
      filterLogic: 'and',
      filters: [
        { field: 'Crew_Size__c', operator: 'IsNull', value: { booleanValue: 'false' } },
        { field: 'Panels_Required__c', operator: 'IsNull', value: { booleanValue: 'true' } },
      ],
    };
    const table = handleFilterItems(node, []);
    expect(table).to.contain('|Crew_Size__c|Is Null|False|');
    expect(table).to.contain('|Panels_Required__c|Is Null|True|');
  });
});

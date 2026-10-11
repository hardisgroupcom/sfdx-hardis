import { expect } from 'chai';
import { handleFilterItems, stringifyIsNullValue } from '../../../src/common/utils/flowVisualiser/nodeFormatUtils.js';

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

  it('shows a reference compared with Is Null as the reference, not as False', () => {
    expect(stringifyIsNullValue({ elementReference: '$GlobalConstant.True' }, '', [])).to.equal('True');
    expect(stringifyIsNullValue({ elementReference: '$GlobalConstant.False' }, '', [])).to.equal('False');
    expect(stringifyIsNullValue({ elementReference: 'crew' }, '', [])).to.equal('crew');
    expect(stringifyIsNullValue({ elementReference: 'crew' }, '', ['crew'])).to.equal('[crew](#crew)');
    expect(stringifyIsNullValue({ booleanValue: true }, '', [])).to.equal('True');
    expect(stringifyIsNullValue(undefined, '', [])).to.equal('<!-- -->');
  });
});

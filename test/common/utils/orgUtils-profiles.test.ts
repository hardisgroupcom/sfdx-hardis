import { expect } from 'chai';
import { getInitialProfileSelection } from '../../../src/common/utils/orgUtils.js';

describe('getInitialProfileSelection', () => {
  const choices = [
    { title: 'Administrateur système', value: 'id-admin' },
    { title: 'Helios Crew', value: 'id-crew' },
    { title: 'Standard User', value: 'id-standard' },
  ];
  const admin = ['System Administrator', 'Administrateur Système'];

  it('pre-selects the profile whose name matches, whatever its case', () => {
    expect(getInitialProfileSelection(choices, admin)).to.equal('id-admin');
  });

  it('returns every match for a multiselect', () => {
    expect(getInitialProfileSelection(choices, ['helios crew', 'Standard User'], true)).to.deep.equal(['id-crew', 'id-standard']);
  });

  it('returns undefined when nothing matches or nothing is asked', () => {
    expect(getInitialProfileSelection(choices, ['Chatter Free User'])).to.equal(undefined);
    expect(getInitialProfileSelection(choices)).to.equal(undefined);
    expect(getInitialProfileSelection(choices, undefined, true)).to.equal(undefined);
  });

  it('keeps the value of the choice, a record included', () => {
    const record = { Id: '00e1', Name: 'System Administrator' };
    expect(getInitialProfileSelection([{ title: 'System Administrator', value: record }], admin)).to.equal(record);
  });
});

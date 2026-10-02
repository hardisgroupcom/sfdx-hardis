import { expect } from 'chai';
import {
  HIDDEN_APEX_BODY,
  parseApexClassName,
  pickApexClassToSchedule,
} from '../../../src/common/actionsProvider/scheduleBatchAction.js';

describe('parseApexClassName', () => {
  it('reads a class of the project as a name without namespace', () => {
    expect(parseApexClassName('CrewCapacityBatch')).to.deep.equal({ namespace: '', name: 'CrewCapacityBatch' });
  });

  it('splits the namespace of a managed package class from its name', () => {
    expect(parseApexClassName(' acme.NightlyScheduler ')).to.deep.equal({ namespace: 'acme', name: 'NightlyScheduler' });
  });
});

describe('pickApexClassToSchedule', () => {
  const own = { Name: 'NightlyScheduler', NamespacePrefix: null, ManageableState: 'unmanaged', Body: 'public class NightlyScheduler implements Schedulable {' };
  const managed = { Name: 'NightlyScheduler', NamespacePrefix: 'acme', ManageableState: 'installed', Body: 'global class NightlyScheduler implements System.Schedulable {' };
  const unlocked = { Name: 'NightlyScheduler', NamespacePrefix: null, ManageableState: 'installedEditable', Body: 'public class NightlyScheduler implements Schedulable {' };

  it('picks the class of the org when no namespace is given', () => {
    expect(pickApexClassToSchedule([managed, own], '')).to.equal(own);
  });

  it('picks the class of the package when its namespace is given', () => {
    expect(pickApexClassToSchedule([own, managed], 'ACME')).to.equal(managed);
  });

  it('never picks a namespaced package class by its bare name', () => {
    expect(pickApexClassToSchedule([managed], '')).to.equal(null);
  });

  it('picks a class of a package without namespace by its bare name', () => {
    expect(pickApexClassToSchedule([unlocked], '')).to.equal(unlocked);
  });

  it('finds nothing when the namespace matches no class', () => {
    expect(pickApexClassToSchedule([own, managed], 'other')).to.equal(null);
  });

  it('still returns a managed class that is not global, so the caller can say why it is refused', () => {
    const hidden = { ...managed, Body: HIDDEN_APEX_BODY };
    expect(pickApexClassToSchedule([hidden], 'acme')).to.equal(hidden);
  });
});

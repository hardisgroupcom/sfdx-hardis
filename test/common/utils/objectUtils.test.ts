import { expect } from 'chai';
import { setDeepValue } from '../../../src/common/utils/objectUtils.js';

describe('setDeepValue()', () => {
  it('sets a top-level key', () => {
    const obj: any = {};
    setDeepValue(obj, 'key', 'value');
    expect(obj.key).to.equal('value');
  });

  it('sets a two-level nested key', () => {
    const obj: any = {};
    setDeepValue(obj, 'a.b', 42);
    expect(obj.a.b).to.equal(42);
  });

  it('sets a three-level nested key', () => {
    const obj: any = {};
    setDeepValue(obj, 'a.b.c', 'deep');
    expect(obj.a.b.c).to.equal('deep');
  });

  it('creates intermediate objects for missing keys', () => {
    const obj: any = {};
    setDeepValue(obj, 'x.y.z', true);
    expect(obj).to.deep.equal({ x: { y: { z: true } } });
  });

  it('does not overwrite existing sibling keys', () => {
    const obj: any = { a: { existing: 1 } };
    setDeepValue(obj, 'a.new', 2);
    expect(obj.a.existing).to.equal(1);
    expect(obj.a.new).to.equal(2);
  });

  it('merges objects when the target key already holds an object', () => {
    const obj: any = { nav: { hardis: { org: { 'existing-cmd': 'existing-cmd.md' } } } };
    setDeepValue(obj, 'nav.hardis.org', { 'new-cmd': 'new-cmd.md' });
    expect(obj.nav.hardis.org['existing-cmd']).to.equal('existing-cmd.md');
    expect(obj.nav.hardis.org['new-cmd']).to.equal('new-cmd.md');
  });

  it('overwrites a primitive with a new value', () => {
    const obj: any = { a: { b: 'old' } };
    setDeepValue(obj, 'a.b', 'new');
    expect(obj.a.b).to.equal('new');
  });

  it('overwrites an object with a primitive', () => {
    const obj: any = { a: { b: { nested: true } } };
    setDeepValue(obj, 'a.b', 'scalar');
    expect(obj.a.b).to.equal('scalar');
  });

  it('replaces a non-object intermediate value with an object', () => {
    const obj: any = { a: 'primitive' };
    setDeepValue(obj, 'a.b', 'value');
    expect(obj.a.b).to.equal('value');
  });

  it('handles the nav-building pattern used in doc plugin generate', () => {
    const commandsNav: any = { 'Commands Reference': 'commands.md' };
    setDeepValue(commandsNav, 'hardis.org', { create: 'hardis/org/create.md' });
    setDeepValue(commandsNav, 'hardis.org', { delete: 'hardis/org/delete.md' });
    setDeepValue(commandsNav, 'hardis.scratch', { create: 'hardis/scratch/create.md' });

    expect(commandsNav['Commands Reference']).to.equal('commands.md');
    expect(commandsNav.hardis.org.create).to.equal('hardis/org/create.md');
    expect(commandsNav.hardis.org.delete).to.equal('hardis/org/delete.md');
    expect(commandsNav.hardis.scratch.create).to.equal('hardis/scratch/create.md');
  });
});

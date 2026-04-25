import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { buildAction, findActionById, readActions, writeActions } from '../../../../../src/common/utils/actionUtils.js';

describe('hardis:project:action:reorder - unit logic', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sfdx-hardis-action-reorder-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(tmpDir);
  });

  function singleMove(actions: any[], actionId: string, position: number): any[] {
    const { index } = findActionById(actions, actionId);
    const [action] = actions.splice(index, 1);
    const insertAt = Math.max(0, Math.min(actions.length, position - 1));
    actions.splice(insertAt, 0, action);
    return actions;
  }

  function fullReorder(actions: any[], orderStr: string): any[] {
    const orderedIds = orderStr.split(',').map(id => id.trim()).filter(id => id);
    const existingIds = new Set(actions.map(a => a.id));
    const providedIds = new Set(orderedIds);

    const missingIds = [...existingIds].filter(id => !providedIds.has(id));
    if (missingIds.length > 0) throw new Error(`Missing IDs: ${missingIds.join(', ')}`);

    const extraIds = orderedIds.filter(id => !existingIds.has(id));
    if (extraIds.length > 0) throw new Error(`Extra IDs: ${extraIds.join(', ')}`);

    if (orderedIds.length !== providedIds.size) throw new Error('Duplicate IDs');

    const actionMap = new Map(actions.map(a => [a.id, a]));
    return orderedIds.map(id => actionMap.get(id)!);
  }

  describe('single move', () => {
    it('moves action to first position', async () => {
      const actions = [
        buildAction({ id: 'a', label: 'A', type: 'command', command: 'a' }),
        buildAction({ id: 'b', label: 'B', type: 'command', command: 'b' }),
        buildAction({ id: 'c', label: 'C', type: 'command', command: 'c' }),
      ];
      await writeActions('project', 'pre-deploy', actions);

      let current = await readActions('project', 'pre-deploy');
      current = singleMove(current, 'c', 1);
      await writeActions('project', 'pre-deploy', current);

      const result = await readActions('project', 'pre-deploy');
      expect(result.map(a => a.id)).to.deep.equal(['c', 'a', 'b']);
    });

    it('moves action to last position', async () => {
      const actions = [
        buildAction({ id: 'a', label: 'A', type: 'command', command: 'a' }),
        buildAction({ id: 'b', label: 'B', type: 'command', command: 'b' }),
        buildAction({ id: 'c', label: 'C', type: 'command', command: 'c' }),
      ];
      await writeActions('project', 'pre-deploy', actions);

      let current = await readActions('project', 'pre-deploy');
      current = singleMove(current, 'a', 3);
      await writeActions('project', 'pre-deploy', current);

      const result = await readActions('project', 'pre-deploy');
      expect(result.map(a => a.id)).to.deep.equal(['b', 'c', 'a']);
    });

    it('clamps position to valid range', () => {
      const actions = [
        buildAction({ id: 'a', label: 'A', type: 'command', command: 'a' }),
        buildAction({ id: 'b', label: 'B', type: 'command', command: 'b' }),
      ];

      // Position 0 should clamp to first
      const result1 = singleMove([...actions], 'b', 0);
      expect(result1.map(a => a.id)).to.deep.equal(['b', 'a']);

      // Position 100 should clamp to last
      const result2 = singleMove([...actions], 'a', 100);
      expect(result2.map(a => a.id)).to.deep.equal(['b', 'a']);
    });
  });

  describe('full reorder', () => {
    it('reorders all actions per provided ID list', () => {
      const actions = [
        buildAction({ id: 'x', label: 'X', type: 'command', command: 'x' }),
        buildAction({ id: 'y', label: 'Y', type: 'command', command: 'y' }),
        buildAction({ id: 'z', label: 'Z', type: 'command', command: 'z' }),
      ];

      const result = fullReorder(actions, 'z,x,y');
      expect(result.map(a => a.id)).to.deep.equal(['z', 'x', 'y']);
    });

    it('throws when provided IDs have missing IDs', () => {
      const actions = [
        buildAction({ id: 'x', label: 'X', type: 'command', command: 'x' }),
        buildAction({ id: 'y', label: 'Y', type: 'command', command: 'y' }),
      ];

      expect(() => fullReorder(actions, 'x')).to.throw('Missing');
    });

    it('throws when provided IDs have extra IDs', () => {
      const actions = [
        buildAction({ id: 'x', label: 'X', type: 'command', command: 'x' }),
      ];

      expect(() => fullReorder(actions, 'x,unknown')).to.throw('Extra');
    });

    it('throws when provided IDs have duplicates', () => {
      const actions = [
        buildAction({ id: 'x', label: 'X', type: 'command', command: 'x' }),
        buildAction({ id: 'y', label: 'Y', type: 'command', command: 'y' }),
      ];

      expect(() => fullReorder(actions, 'x,x')).to.throw();
    });
  });
});

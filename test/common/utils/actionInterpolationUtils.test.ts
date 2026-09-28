import { expect } from 'chai';
import {
  ActionInterpolationError,
  ActionOutputsRegistry,
  ActionSkipReasons,
  InterpolationScope,
  interpolateActionFields,
  interpolateString,
} from '../../../src/common/utils/actionInterpolationUtils.js';
import { PipelineContext } from '../../../src/common/utils/pipelineContextUtils.js';

function buildScope(options: {
  outputs?: Record<string, Record<string, any>>;
  skipReasons?: Record<string, string>;
  pipeline?: Partial<PipelineContext>;
} = {}): InterpolationScope {
  const outputs: ActionOutputsRegistry = new Map(Object.entries(options.outputs || {}));
  const skipReasons: ActionSkipReasons = new Map(Object.entries(options.skipReasons || {}));
  return {
    outputs,
    skipReasons,
    pipeline: { targetBranch: 'integration', prId: '482', checkOnly: 'false', ...options.pipeline } as PipelineContext,
  };
}

describe('actionInterpolationUtils', () => {
  describe('interpolateString', () => {
    it('resolves an action output reference', () => {
      const scope = buildScope({ outputs: { findAcc: { accountId: '001xx000003DHPl' } } });
      const result = interpolateString('--record-id ${{ actions.findAcc.outputs.accountId }}', scope);
      expect(result).to.equal('--record-id 001xx000003DHPl');
    });

    it('resolves a pipeline variable reference', () => {
      const scope = buildScope();
      expect(interpolateString('Deploying to ${{ pipeline.targetBranch }}', scope)).to.equal('Deploying to integration');
    });

    it('resolves several references in one string', () => {
      const scope = buildScope({ outputs: { a: { x: '1' }, b: { y: '2' } } });
      const result = interpolateString('${{ actions.a.outputs.x }}-${{ actions.b.outputs.y }}-${{ pipeline.prId }}', scope);
      expect(result).to.equal('1-2-482');
    });

    it('tolerates spacing inside the braces', () => {
      const scope = buildScope({ outputs: { a: { x: 'ok' } } });
      expect(interpolateString('${{actions.a.outputs.x}}', scope)).to.equal('ok');
      expect(interpolateString('${{    actions.a.outputs.x    }}', scope)).to.equal('ok');
    });

    it('JSON-encodes an object output so it survives a command line', () => {
      const scope = buildScope({ outputs: { a: { payload: { id: 1 } } } });
      expect(interpolateString('${{ actions.a.outputs.payload }}', scope)).to.equal('{"id":1}');
    });

    it('resolves an empty pipeline variable to an empty string rather than failing', () => {
      const scope = buildScope({ pipeline: { prId: '' } });
      expect(interpolateString('[${{ pipeline.prId }}]', scope)).to.equal('[]');
    });

    // The whole point of only resolving known namespaces: a project already using ${{ }} for
    // its own templating must keep working with no escape and no migration.
    it('leaves an unknown namespace untouched', () => {
      const scope = buildScope();
      expect(interpolateString('echo "${{ MY_TEMPLATE }}"', scope)).to.equal('echo "${{ MY_TEMPLATE }}"');
    });

    it('leaves a near-miss namespace untouched', () => {
      const scope = buildScope({ outputs: { a: { x: '1' } } });
      expect(interpolateString('${{ action.a.outputs.x }}', scope)).to.equal('${{ action.a.outputs.x }}');
      expect(interpolateString('${{ pipelines.targetBranch }}', scope)).to.equal('${{ pipelines.targetBranch }}');
    });

    it('returns the value unchanged when it carries no reference', () => {
      expect(interpolateString('plain value', buildScope())).to.equal('plain value');
    });

    it('fails when the producing action never ran', () => {
      const scope = buildScope();
      expect(() => interpolateString('${{ actions.missing.outputs.x }}', scope))
        .to.throw(ActionInterpolationError, /missing/);
    });

    it('fails with the skip reason when the producing action produced nothing', () => {
      const scope = buildScope({ skipReasons: { findAcc: 'branch not targeted' } });
      expect(() => interpolateString('${{ actions.findAcc.outputs.accountId }}', scope))
        .to.throw(ActionInterpolationError, /branch not targeted/);
    });

    it('fails when the action ran but did not return that output', () => {
      const scope = buildScope({ outputs: { findAcc: { otherId: '1' } } });
      expect(() => interpolateString('${{ actions.findAcc.outputs.accountId }}', scope))
        .to.throw(ActionInterpolationError, /accountId/);
    });

    it('fails on an unknown pipeline variable', () => {
      expect(() => interpolateString('${{ pipeline.nope }}', buildScope()))
        .to.throw(ActionInterpolationError, /nope/);
    });
  });

  describe('interpolateActionFields', () => {
    it('resolves command, customUsername and every parameter value', () => {
      const scope = buildScope({ outputs: { a: { id: '42' } } });
      const action = {
        command: 'sf data update record --record-id ${{ actions.a.outputs.id }}',
        customUsername: 'deploy+${{ pipeline.targetBranch }}@acme.com',
        parameters: {
          channel: '#${{ pipeline.targetBranch }}',
          items: ['ApexClass:${{ actions.a.outputs.id }}', 'Layout:Fixed'],
          nested: { inner: '${{ actions.a.outputs.id }}' },
          count: 3,
          flag: true,
        },
      };
      interpolateActionFields(action, scope);
      expect(action.command).to.equal('sf data update record --record-id 42');
      expect(action.customUsername).to.equal('deploy+integration@acme.com');
      expect(action.parameters.channel).to.equal('#integration');
      expect(action.parameters.items).to.deep.equal(['ApexClass:42', 'Layout:Fixed']);
      expect(action.parameters.nested).to.deep.equal({ inner: '42' });
      // Non-string values pass through untouched
      expect(action.parameters.count).to.equal(3);
      expect(action.parameters.flag).to.equal(true);
    });

    it('does nothing on an action without interpolatable fields', () => {
      const action: any = { type: 'manual' };
      interpolateActionFields(action, buildScope());
      expect(action).to.deep.equal({ type: 'manual' });
    });

    it('propagates the failure of a single parameter', () => {
      const action = { parameters: { channel: '${{ actions.missing.outputs.x }}' } };
      expect(() => interpolateActionFields(action, buildScope())).to.throw(ActionInterpolationError);
    });
  });
});

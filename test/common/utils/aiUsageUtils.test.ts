import { expect } from 'chai';
import {
  buildAiUsageQuery,
  CANDIDATE_AI_USAGE_MODELS,
  findModelName,
  mapUsageColumns,
  toAiUsageRow,
} from '../../../src/common/utils/aiUsageUtils.js';

// Schema captured from a live org running Agentforce with Flex Credits metering
// (AiAgentGenerativeAiUsage_std__dlm, 38 columns). Kept verbatim so the column-role mapping
// keeps working against the shape Salesforce actually publishes.
const REAL_AI_USAGE_COLUMNS = [
  'PromptCompletionTokenCount__c',
  'AiAgentSessionId__c',
  'PromptTotalTokenCount__c',
  'RequestIdentifier__c',
  'AiAgentInteractionId__c',
  'ModelProviderModelName__c',
  'PromptTemplateDeveloperName__c',
  'TelemetryTraceSpanId__c',
  'FeatureDescriptorName__c',
  'InternalOrganizationId__c',
  'IsBillableIndicator__c',
  'AiAgentToolIdentifier__c',
  'TierQualifierType__c',
  'UsageQuantity__c',
  'Id__c',
  'AgentDeveloperName__c',
  'DataSourceObjectId__c',
  'Timestamp__c',
  'AgentIdentifier__c',
  'UnitTypeCode__c',
  'AiAgentToolInvTargetCode__c',
  'ModelProviderName__c',
  'PromptTemplateIdentifier__c',
  'UsageTypeCode__c',
  'DataSourceId__c',
  'GenAiGatewayFeatureName__c',
  'GenAiGatewayModelName__c',
  'UserId__c',
  'PromptInputTokenCount__c',
  'InfraTenantIdentifier__c',
  'UserContext__c',
  'KQ_Id__c',
  'MeteringSkipReasonCode__c',
  'AgentTypeCode__c',
  'TelemetryTraceIdentifier__c',
  'IsMeteredIndicator__c',
  'AiAgentToolName__c',
  'ModelClassType__c',
].map((name) => ({ name, type: 'Varchar' }));

// DMO listing shape observed on the same org (trimmed to the relevant entries)
const REAL_DMO_NAMES = [
  'ssot__Account__dlm',
  'ssot__AiAgentInteraction__dlm',
  'ssot__AiAgentSession__dlm',
  'AiAgentGenerativeAiUsage_std__dlm',
  'GenAiGatewayRequest_std__dlm',
  'ssot__EngagementChannelUsage__dlm',
];

describe('aiUsageUtils', () => {
  describe('findModelName', () => {
    it('finds the real model name published by Salesforce', () => {
      const found = findModelName(
        REAL_DMO_NAMES,
        CANDIDATE_AI_USAGE_MODELS,
        /(generativeaiusage|aiagentusage|aiagentgenerativeai)/i
      );
      expect(found).to.equal('AiAgentGenerativeAiUsage_std__dlm');
    });

    it('falls back to the pattern when the exact name is unknown', () => {
      const found = findModelName(
        ['ssot__Account__dlm', 'AiAgentGenerativeAiUsage_v2__dlm'],
        CANDIDATE_AI_USAGE_MODELS,
        /(generativeaiusage|aiagentusage|aiagentgenerativeai)/i
      );
      expect(found).to.equal('AiAgentGenerativeAiUsage_v2__dlm');
    });

    it('returns null when no model is provisioned', () => {
      const found = findModelName(
        ['ssot__Account__dlm', 'ssot__Individual__dlm'],
        CANDIDATE_AI_USAGE_MODELS,
        /(generativeaiusage|aiagentusage|aiagentgenerativeai)/i
      );
      expect(found).to.equal(null);
    });
  });

  describe('mapUsageColumns', () => {
    const mapping = mapUsageColumns(REAL_AI_USAGE_COLUMNS);

    // The billed quantity is UsageQuantity__c, not any "credit"/"amount" spelling. Missing it
    // drops the command to its unaggregated fallback, so this assertion is the important one.
    it('maps the billed quantity column', () => {
      expect(mapping.credits).to.equal('UsageQuantity__c');
    });

    it('maps the agent column', () => {
      expect(mapping.agent).to.equal('AgentDeveloperName__c');
    });

    it('prefers the tool NAME over the tool identifier for the action column', () => {
      expect(mapping.action).to.equal('AiAgentToolName__c');
    });

    it('maps the metered flag, usage type and timestamp', () => {
      expect(mapping.metered).to.be.oneOf(['IsMeteredIndicator__c', 'IsBillableIndicator__c']);
      expect(mapping.usageType).to.equal('UsageTypeCode__c');
      expect(mapping.timestamp).to.equal('Timestamp__c');
    });

    it('never assigns the same column to two roles', () => {
      const used = Object.values(mapping);
      expect(used.length).to.equal(new Set(used).size);
    });

    it('leaves credits undefined when nothing resembles a quantity', () => {
      const mapped = mapUsageColumns([{ name: 'Foo__c', type: 'Varchar' }, { name: 'Bar__c', type: 'Varchar' }]);
      expect(mapped.credits).to.equal(undefined);
    });
  });

  describe('buildAiUsageQuery', () => {
    const info = {
      model: 'AiAgentGenerativeAiUsage_std__dlm',
      columns: REAL_AI_USAGE_COLUMNS,
      mapping: mapUsageColumns(REAL_AI_USAGE_COLUMNS),
    };

    it('builds an aggregate query against the real schema', () => {
      const query = buildAiUsageQuery(info, {}, 100) as string;
      expect(query).to.be.a('string');
      expect(query).to.contain('SUM(UsageQuantity__c) AS credits');
      expect(query).to.contain('COUNT(1) AS events');
      expect(query).to.contain('FROM AiAgentGenerativeAiUsage_std__dlm');
      expect(query).to.contain('GROUP BY');
      expect(query).to.contain('AgentDeveloperName__c');
      expect(query).to.contain('AiAgentToolName__c');
      expect(query).to.contain('LIMIT 100');
    });

    it('applies the date window on the discovered timestamp column', () => {
      const query = buildAiUsageQuery(info, { dateFrom: '2026-07-01T00:00:00.000Z' }, 100) as string;
      expect(query).to.contain("Timestamp__c >= TIMESTAMP '2026-07-01T00:00:00.000Z'");
    });

    it('returns null when no credits column was discovered, so the caller can degrade', () => {
      const query = buildAiUsageQuery(
        { model: 'X__dlm', columns: [{ name: 'Foo__c', type: 'Varchar' }], mapping: {} },
        {},
        100
      );
      expect(query).to.equal(null);
    });
  });

  describe('toAiUsageRow', () => {
    it('reads the aliased aggregate row', () => {
      const row = toAiUsageRow({
        agent: 'Agentforce_Employee_Agent',
        action: 'Invoke_LEA_API_179W5000000GHWL',
        usageType: 'Agentforce_CustomAction',
        metered: true as any,
        credits: 780,
        events: 780,
      });
      expect(row.agent).to.equal('Agentforce_Employee_Agent');
      expect(row.credits).to.equal(780);
      expect(row.events).to.equal(780);
    });

    it('tolerates null dimensions', () => {
      const row = toAiUsageRow({ agent: null, action: null, credits: 2551, events: 365 });
      expect(row.agent).to.equal('');
      expect(row.credits).to.equal(2551);
    });
  });
});

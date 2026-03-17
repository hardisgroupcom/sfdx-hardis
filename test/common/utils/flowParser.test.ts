import { expect } from 'chai';
import { parseFlow } from '../../../src/common/utils/flowVisualiser/flowParser.js';

describe('Flow Parser - Mermaid Label Sanitization', () => {

    it('Should sanitize flow labels with double quotes for Mermaid syntax', async () => {
        const flowXml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <description>Sends email notification</description>
        <name>test_action</name>
        <label>Send &quot;Duplicate Request&quot; email</label>
        <connector>
            <targetReference>END</targetReference>
        </connector>
    </actionCalls>
    <start>
        <connector>
            <targetReference>test_action</targetReference>
        </connector>
    </start>
    <label>Test Flow with Quotes</label>
    <processType>Flow</processType>
    <status>Active</status>
</Flow>`;

        const result = await parseFlow(flowXml, 'mermaid');

        // Extract the Mermaid diagram section
        const mermaidMatch = result.uml.match(/```mermaid\n([\s\S]*?)\n```/);
        if (!mermaidMatch) {
            throw new Error('Mermaid diagram block not found');
        }
        const mermaidDiagram = mermaidMatch[1];

        // Within the Mermaid diagram, quotes should be sanitized
        // The node definition line should have sanitized quotes
        expect(mermaidDiagram).to.include('Send #quot;Duplicate Request#quot; email');
    });

    it('Should sanitize decision labels with quotes', async () => {
        const flowXml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <decisions>
        <name>Check_Status</name>
        <label>Check &quot;Active&quot; Status</label>
        <rules>
            <name>Is_Active</name>
            <label>Status is &quot;Active&quot;</label>
            <connector>
                <targetReference>Action1</targetReference>
            </connector>
        </rules>
        <defaultConnector>
            <targetReference>Action2</targetReference>
        </defaultConnector>
        <defaultConnectorLabel>Not &quot;Active&quot;</defaultConnectorLabel>
    </decisions>
    <actionCalls>
        <name>Action1</name>
        <label>Action 1</label>
    </actionCalls>
    <actionCalls>
        <name>Action2</name>
        <label>Action 2</label>
    </actionCalls>
    <start>
        <connector>
            <targetReference>Check_Status</targetReference>
        </connector>
    </start>
    <label>Test Flow with Decision</label>
    <processType>Flow</processType>
    <status>Active</status>
</Flow>`;

        const result = await parseFlow(flowXml, 'mermaid');

        // Check that decision rule labels are sanitized
        expect(result.uml).to.include('Status is #quot;Active#quot;');
        // Check that default connector labels are sanitized
        expect(result.uml).to.include('Not #quot;Active#quot;');
        // Check that decision node labels are sanitized
        expect(result.uml).to.include('Check #quot;Active#quot; Status');
    });

    it('Should sanitize flow labels with single quotes', async () => {
        const flowXml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <name>test_action</name>
        <label>Don't skip this step</label>
        <connector>
            <targetReference>END</targetReference>
        </connector>
    </actionCalls>
    <start>
        <connector>
            <targetReference>test_action</targetReference>
        </connector>
    </start>
    <label>Test Flow</label>
    <processType>Flow</processType>
    <status>Active</status>
</Flow>`;

        const result = await parseFlow(flowXml, 'mermaid');

        expect(result.uml).to.include('Don#39;t skip this step');
    });

    it('Should sanitize flow labels with pipes and brackets', async () => {
        const flowXml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <name>test_action</name>
        <label>Process [Item] | Update {Record}</label>
        <connector>
            <targetReference>END</targetReference>
        </connector>
    </actionCalls>
    <start>
        <connector>
            <targetReference>test_action</targetReference>
        </connector>
    </start>
    <label>Test Flow</label>
    <processType>Flow</processType>
    <status>Active</status>
</Flow>`;

        const result = await parseFlow(flowXml, 'mermaid');

        expect(result.uml).to.include('Process #91;Item#93; #124; Update #123;Record#125;');
    });

    it('Should handle scheduled paths with quotes in labels', async () => {
        const flowXml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <name>test_action</name>
        <label>Test Action</label>
    </actionCalls>
    <start>
        <scheduledPaths>
            <name>Daily_Run</name>
            <label>Run "Daily" Schedule</label>
            <connector>
                <targetReference>test_action</targetReference>
            </connector>
        </scheduledPaths>
        <triggerType>Scheduled</triggerType>
    </start>
    <label>Test Scheduled Flow</label>
    <processType>AutoLaunchedFlow</processType>
    <status>Active</status>
</Flow>`;

        const result = await parseFlow(flowXml, 'mermaid');

        expect(result.uml).to.include('Run #quot;Daily#quot; Schedule');
    });

    it('Should handle empty or undefined labels gracefully', async () => {
        const flowXml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <name>test_action</name>
        <connector>
            <targetReference>END</targetReference>
        </connector>
    </actionCalls>
    <start>
        <connector>
            <targetReference>test_action</targetReference>
        </connector>
    </start>
    <label>Test Flow</label>
    <processType>Flow</processType>
    <status>Active</status>
</Flow>`;

        const result = await parseFlow(flowXml, 'mermaid');

        // Should not throw an error and should generate valid Mermaid
        expect(result.uml).to.be.a('string');
        expect(result.uml.length).to.be.greaterThan(0);
    });

});

describe('Flow Parser - Mermaid Theme Overrides', () => {
    const flowXml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <name>test_action</name>
        <label>Test Action</label>
        <connector>
            <targetReference>END</targetReference>
        </connector>
    </actionCalls>
    <decisions>
        <name>decision_1</name>
        <label>Decision 1</label>
        <defaultConnector>
            <targetReference>test_action</targetReference>
        </defaultConnector>
        <defaultConnectorLabel>Default</defaultConnectorLabel>
        <rules>
            <name>Rule_1</name>
            <label>Rule 1</label>
            <connector>
                <targetReference>test_action</targetReference>
            </connector>
        </rules>
    </decisions>
    <start>
        <connector>
            <targetReference>decision_1</targetReference>
        </connector>
    </start>
    <label>Theme Test Flow</label>
    <processType>Flow</processType>
    <status>Active</status>
</Flow>`;

    it('Should keep default Mermaid class colors when mermaidTheme is absent', async () => {
        const result = await parseFlow(flowXml, 'mermaid');

        expect(result.uml).to.include('classDef decisions fill:#FDEAF6,color:black,text-decoration:none,max-height:100px');
        expect(result.uml).to.include('classDef actionCalls fill:#D4E4FC,color:black,text-decoration:none,max-height:100px');
    });

    it('Should override only targeted node classes with nested mermaidTheme overrides', async () => {
        const result = await parseFlow(flowXml, 'mermaid', {
            mermaidTheme: {
                decisions: {
                    background: 'F88888',
                    color: 'white',
                },
            },
        });

        expect(result.uml).to.include('classDef decisions fill:#F88888,color:white,text-decoration:none,max-height:100px');
        expect(result.uml).to.include('classDef actionCalls fill:#D4E4FC,color:black,text-decoration:none,max-height:100px');
    });

    it('Should override stroke and Mermaid shape tokens with nested mermaidTheme overrides', async () => {
        const result = await parseFlow(flowXml, 'mermaid', {
            mermaidTheme: {
                actionCalls: {
                    stroke: 'E5E5E5',
                    strokeWidth: '2px',
                    mermaidOpen: '[[',
                    mermaidClose: ']]',
                },
            },
        });

        expect(result.uml).to.include('classDef actionCalls fill:#D4E4FC,color:black,stroke:#E5E5E5,stroke-width:2px,text-decoration:none,max-height:100px');
        expect(result.uml).to.include('test_action[["⚡ <em></em><br/>Test Action"]]:::actionCalls');
    });

    it('Should normalize flat mermaidTheme alias overrides', async () => {
        const result = await parseFlow(flowXml, 'mermaid', {
            mermaidTheme: {
                decisionColor: 'F44444',
                decisionTextColor: 'white',
            },
        });

        expect(result.uml).to.include('classDef decisions fill:#F44444,color:white,text-decoration:none,max-height:100px');
    });

    it('Should render recordRollbacks nodes when present in Flow metadata', async () => {
        const rollbackFlowXml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <recordRollbacks>
        <name>rollback_1</name>
        <label>Rollback Changes</label>
        <connector>
            <targetReference>END</targetReference>
        </connector>
    </recordRollbacks>
    <start>
        <connector>
            <targetReference>rollback_1</targetReference>
        </connector>
    </start>
    <label>Rollback Flow</label>
    <processType>Flow</processType>
    <status>Active</status>
</Flow>`;

        const result = await parseFlow(rollbackFlowXml, 'mermaid');

        expect(result.uml).to.include('rollback_1[("↩️ <em></em><br/>Rollback Changes")]:::recordRollbacks');
        expect(result.uml).to.include('rollback_1 --> END_rollback_1');
        expect(result.uml).to.include('classDef recordRollbacks fill:#FFF8C9,color:black,text-decoration:none,max-height:100px');
    });
});

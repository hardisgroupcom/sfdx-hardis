import { expect } from 'chai';
import { buildMermaidDockerCommand, getMermaidExtraClasses } from '../../../src/common/utils/mermaidUtils.js';

describe('Mermaid Utils - Theme Overrides', () => {
    it('Should keep default diff highlight classes when mermaidTheme is absent', () => {
        const result = getMermaidExtraClasses();

        expect(result).to.include('classDef actionCallsAdded fill:green,color:white,stroke-width:4px,text-decoration:none,max-height:100px');
        expect(result).to.include('classDef recordRollbacksAdded fill:green,color:white,stroke-width:4px,text-decoration:none,max-height:100px');
        expect(result).to.include('classDef actionCallsRemoved fill:red,color:white,stroke-width:4px,text-decoration:none,max-height:100px');
    });

    it('Should override diff highlight classes with nested mermaidTheme overrides', () => {
        const result = getMermaidExtraClasses({
            added: {
                background: '112233',
                color: 'black',
                strokeWidth: '6px',
            },
        });

        expect(result).to.include('classDef actionCallsAdded fill:#112233,color:black,stroke-width:6px,text-decoration:none,max-height:100px');
        expect(result).to.include('classDef actionCallsRemoved fill:red,color:white,stroke-width:4px,text-decoration:none,max-height:100px');
    });

    it('Should normalize flat diff alias overrides', () => {
        const result = getMermaidExtraClasses({
            addedColor: '445566',
            addedTextColor: 'black',
        });

        expect(result).to.include('classDef actionCallsAdded fill:#445566,color:black,stroke-width:4px,text-decoration:none,max-height:100px');
    });
});

describe('Mermaid Utils - Docker command', () => {
    it('Should run the mermaid-cli container as the user who wrote the files', () => {
        const result = buildMermaidDockerCommand('/work/docs', 'Flow.md', 'Flow.md', 0, 0);
        expect(result).to.equal('docker run --rm --user 0:0 -v "/work/docs:/data" ghcr.io/mermaid-js/mermaid-cli/mermaid-cli -i "Flow.md" -o "Flow.md"');
    });

    it('Should keep the image user when there is no uid (Windows)', () => {
        const result = buildMermaidDockerCommand('C:/work/docs', 'Flow.md', 'Flow.svg', undefined, undefined);
        expect(result).to.equal('docker run --rm -v "C:/work/docs:/data" ghcr.io/mermaid-js/mermaid-cli/mermaid-cli -i "Flow.md" -o "Flow.svg"');
    });
});

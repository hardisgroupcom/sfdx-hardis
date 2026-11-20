import { expect } from 'chai';
import * as xmldom from '@xmldom/xmldom';
import { compileXmlPath, describeXmlNode, removeXmlNode, selectXmlPath, validateXmlPath } from '../../../src/common/replacementRules/utils/xmlPath.js';
import { removeFlowEnds } from '../../../src/common/replacementRules/flowEndsBuiltInRule.js';
import { detailWithNames, formatChangedNames } from '../../../src/common/replacementRules/utils/changeNames.js';

const parse = (xml: string) => new xmldom.DOMParser().parseFromString(xml, 'text/xml');
const serialize = (doc: any) => new xmldom.XMLSerializer().serializeToString(doc);

describe('replacement rules - naming what a rule changed', () => {
  const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <objectPermissions>
        <allowRead>true</allowRead>
        <object>Account</object>
        <viewAllFields>false</viewAllFields>
    </objectPermissions>
    <userPermissions>
        <enabled>true</enabled>
        <name>ManageSandboxes</name>
    </userPermissions>
    <loginIpRanges>
        <description>secret office range</description>
        <endAddress>10.0.0.255</endAddress>
    </loginIpRanges>
    <custom>true</custom>
</Profile>`);

  it('names an element by its identifier, or by the identifier of the element holding it', () => {
    expect(describeXmlNode(selectXmlPath('Profile/userPermissions', doc)[0])).to.equal('userPermissions ManageSandboxes');
    expect(describeXmlNode(selectXmlPath('Profile/objectPermissions', doc)[0])).to.equal('objectPermissions Account');
    expect(describeXmlNode(selectXmlPath('Profile/objectPermissions/viewAllFields', doc)[0])).to.equal('objectPermissions Account: viewAllFields');
  });

  it('never shows the text of an element, only its path when nothing identifies it', () => {
    expect(describeXmlNode(selectXmlPath('Profile/custom', doc)[0])).to.equal('custom');
    expect(describeXmlNode(selectXmlPath('Profile/loginIpRanges/endAddress', doc)[0])).to.equal('loginIpRanges/endAddress');
    const named = describeXmlNode(selectXmlPath('Profile/loginIpRanges', doc)[0]);
    expect(named).to.equal('loginIpRanges');
    expect(named).to.not.include('secret');
  });

  it('never throws, whatever it is given', () => {
    expect(describeXmlNode(null)).to.equal('?');
    expect(describeXmlNode(undefined)).to.equal('?');
    expect(describeXmlNode({})).to.equal('?');
  });

  it('lists the names, capped with how many more', () => {
    expect(formatChangedNames(['a', 'b'])).to.equal('a, b');
    expect(formatChangedNames(['a', 'b', 'c', 'd'], 2)).to.equal('a, b, ... and 2 more');
    expect(formatChangedNames(Array.from({ length: 25 }, (_, index) => `p${index}`))).to.match(/^p0, .*p19, \.\.\. and 5 more$/);
    expect(detailWithNames('2 elements removed', [])).to.equal('2 elements removed');
    expect(detailWithNames('2 elements removed', ['x', 'y'])).to.equal('2 elements removed: x, y');
  });
});

describe('replacement rules - element paths', () => {
  it('compiles child, descendant, wildcard and predicate steps', () => {
    expect(compileXmlPath('NamedCredential/endpoint')).to.equal('/ns:NamedCredential/ns:endpoint');
    expect(compileXmlPath('//dayOfMonthToRun')).to.equal('//ns:dayOfMonthToRun');
    expect(compileXmlPath('Flow/screens//fields/styleProperties')).to.equal('/ns:Flow/ns:screens//ns:fields/ns:styleProperties');
    expect(compileXmlPath('Flow/*/group')).to.equal('/ns:Flow/*/ns:group');
    expect(compileXmlPath('Workflow/alerts[fullName=Escalation_Alert]/senderAddress')).to.equal(
      "/ns:Workflow/ns:alerts[ns:fullName='Escalation_Alert']/ns:senderAddress"
    );
    expect(compileXmlPath('Layout/excludeButtons[.=SmartFillEnrich]')).to.equal("/ns:Layout/ns:excludeButtons[.='SmartFillEnrich']");
    expect(compileXmlPath('A/b[name="it\'s"]')).to.equal(`/ns:A/ns:b[ns:name="it's"]`);
  });

  it('rejects invalid paths', () => {
    expect(validateXmlPath('')).to.not.equal(null);
    expect(validateXmlPath('A/')).to.not.equal(null);
    expect(validateXmlPath('A/b[name]')).to.not.equal(null);
    expect(validateXmlPath('A/b[name=x')).to.not.equal(null);
    expect(validateXmlPath('A b')).to.not.equal(null);
    expect(validateXmlPath('A/b')).to.equal(null);
  });

  it('selects and removes nodes of a metadata document', () => {
    const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<Workflow xmlns="http://soap.sforce.com/2006/04/metadata">
    <alerts>
        <fullName>Escalation_Alert</fullName>
        <senderAddress>a@example.com</senderAddress>
    </alerts>
    <alerts>
        <fullName>Other</fullName>
        <senderAddress>b@example.com</senderAddress>
    </alerts>
</Workflow>`);
    const nodes = selectXmlPath('Workflow/alerts[fullName=Escalation_Alert]/senderAddress', doc);
    expect(nodes).to.have.length(1);
    expect(nodes[0].textContent).to.equal('a@example.com');
    removeXmlNode(selectXmlPath('Workflow/alerts[fullName=Other]', doc)[0]);
    expect(serialize(doc)).to.not.include('Other');
    expect(selectXmlPath('//senderAddress', doc)).to.have.length(1);
  });
});

describe('replacement rules - user permissions', () => {
  it('removes one user permission of a Profile, and only that one', () => {
    const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<Profile xmlns="http://soap.sforce.com/2006/04/metadata">
    <custom>false</custom>
    <userPermissions>
        <enabled>true</enabled>
        <name>ApiEnabled</name>
    </userPermissions>
    <userPermissions>
        <enabled>true</enabled>
        <name>ViewSetup</name>
    </userPermissions>
</Profile>`);
    const nodes = selectXmlPath('Profile/userPermissions[name=ViewSetup]', doc);
    expect(nodes).to.have.length(1);
    removeXmlNode(nodes[0]);
    const xml = serialize(doc);
    expect(xml).to.not.include('ViewSetup');
    expect(xml).to.include('<name>ApiEnabled</name>');
    expect(xml).to.include('<custom>false</custom>');
  });
});

describe('replacement rules - Flow End elements', () => {
  it('removes the End elements and the connectors pointing to them', () => {
    const doc = parse(`<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <decisions>
        <name>Check</name>
        <defaultConnector>
            <targetReference>End_Default</targetReference>
        </defaultConnector>
        <rules>
            <name>Yes</name>
            <connector>
                <targetReference>Update_Case</targetReference>
            </connector>
        </rules>
    </decisions>
    <ends>
        <name>End_Default</name>
    </ends>
    <ends>
        <name>End_After_Update</name>
    </ends>
    <recordUpdates>
        <name>Update_Case</name>
        <connector>
            <targetReference>End_After_Update</targetReference>
        </connector>
        <faultConnector>
            <targetReference>End_Default</targetReference>
        </faultConnector>
    </recordUpdates>
</Flow>`);
    expect(removeFlowEnds(doc)).to.equal(2);
    const xml = serialize(doc);
    expect(xml).to.not.include('<ends>');
    expect(xml).to.not.include('End_Default');
    expect(xml).to.not.include('End_After_Update');
    expect(xml).to.include('<targetReference>Update_Case</targetReference>');
    expect(xml).to.not.include('defaultConnector');
    expect(xml).to.not.include('faultConnector');
  });

  it('does nothing on a flow without End elements', () => {
    const doc = parse('<Flow xmlns="http://soap.sforce.com/2006/04/metadata"><label>x</label></Flow>');
    expect(removeFlowEnds(doc)).to.equal(0);
  });
});

/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  determineMaxChunkSize,
  validateChunkSizeOverride,
  resolveEffectiveChunkSize,
  chunkArray,
  groupByType,
  splitMetadataEntries,
  isOutcomeFailed,
  buildMetadataXml,
  isCrudIncompatibleAdapter,
  isCrudIncompatibleTypeName,
  partitionCrudCompatibility,
  DEFAULT_MAX_CHUNK_SIZE,
  SPECIAL_MAX_CHUNK_SIZE,
} from '../../../src/common/metadata-utils/crudMetadataApi.js';

// Minimal RegistryAccess stub: maps a type name to its registry adapter strategy.
function fakeRegistry(adapterByType: Record<string, string | undefined>): any {
  return {
    getTypeByName(name: string) {
      if (!(name in adapterByType)) {
        throw new Error(`Missing metadata type definition in registry for type ${name}`);
      }
      const adapter = adapterByType[name];
      return adapter ? { strategies: { adapter } } : {};
    },
  };
}

describe('determineMaxChunkSize()', () => {
  it('returns 10 for a regular type', () => {
    expect(determineMaxChunkSize('Profile')).to.equal(DEFAULT_MAX_CHUNK_SIZE);
    expect(determineMaxChunkSize('PermissionSet')).to.equal(10);
  });

  it('returns 200 for CustomMetadata', () => {
    expect(determineMaxChunkSize('CustomMetadata')).to.equal(SPECIAL_MAX_CHUNK_SIZE);
  });

  it('returns 200 for CustomApplication', () => {
    expect(determineMaxChunkSize('CustomApplication')).to.equal(200);
  });
});

describe('validateChunkSizeOverride()', () => {
  it('accepts the minimum of 1', () => {
    expect(validateChunkSizeOverride(1)).to.equal(1);
  });

  it('accepts the absolute maximum of 200', () => {
    expect(validateChunkSizeOverride(200)).to.equal(200);
  });

  it('rejects 0', () => {
    expect(() => validateChunkSizeOverride(0)).to.throw();
  });

  it('rejects a negative value', () => {
    expect(() => validateChunkSizeOverride(-5)).to.throw();
  });

  it('rejects a non-integer', () => {
    expect(() => validateChunkSizeOverride(3.5)).to.throw();
  });

  it('rejects a value above the absolute maximum', () => {
    expect(() => validateChunkSizeOverride(201)).to.throw();
  });
});

describe('resolveEffectiveChunkSize()', () => {
  it('uses the type ceiling when no override is given', () => {
    expect(resolveEffectiveChunkSize('Profile', null)).to.equal(10);
    expect(resolveEffectiveChunkSize('CustomMetadata', null)).to.equal(200);
  });

  it('caps the override at the regular-type ceiling', () => {
    expect(resolveEffectiveChunkSize('Profile', 50)).to.equal(10);
  });

  it('honors an override within the special-type ceiling', () => {
    expect(resolveEffectiveChunkSize('CustomMetadata', 50)).to.equal(50);
  });

  it('caps the override at the special-type ceiling', () => {
    expect(resolveEffectiveChunkSize('CustomMetadata', 250)).to.equal(200);
  });

  it('uses a small override below the ceiling as-is', () => {
    expect(resolveEffectiveChunkSize('Profile', 3)).to.equal(3);
  });
});

describe('chunkArray()', () => {
  it('splits into chunks of the given size', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).to.deep.equal([[1, 2], [3, 4], [5]]);
  });

  it('returns a single chunk when size exceeds length', () => {
    expect(chunkArray([1, 2, 3], 10)).to.deep.equal([[1, 2, 3]]);
  });

  it('handles exact multiples', () => {
    expect(chunkArray([1, 2, 3, 4], 2)).to.deep.equal([[1, 2], [3, 4]]);
  });

  it('returns an empty array for empty input', () => {
    expect(chunkArray([], 5)).to.deep.equal([]);
  });

  it('throws when size is below 1', () => {
    expect(() => chunkArray([1, 2], 0)).to.throw();
  });
});

describe('groupByType()', () => {
  it('groups items by the computed key', () => {
    const items = [
      { type: 'Profile', name: 'Admin' },
      { type: 'PermissionSet', name: 'PS1' },
      { type: 'Profile', name: 'Standard' },
    ];
    const grouped = groupByType(items, (i) => i.type);
    expect(Object.keys(grouped)).to.deep.equal(['Profile', 'PermissionSet']);
    expect(grouped.Profile).to.have.length(2);
    expect(grouped.PermissionSet).to.have.length(1);
  });

  it('preserves insertion order within a group', () => {
    const grouped = groupByType(['Admin', 'Standard'], () => 'Profile');
    expect(grouped.Profile).to.deep.equal(['Admin', 'Standard']);
  });
});

describe('splitMetadataEntries()', () => {
  it('returns an empty array for undefined', () => {
    expect(splitMetadataEntries(undefined)).to.deep.equal([]);
  });

  it('passes through single entries', () => {
    expect(splitMetadataEntries(['Profile', 'PermissionSet'])).to.deep.equal(['Profile', 'PermissionSet']);
  });

  it('splits comma-joined entries', () => {
    expect(splitMetadataEntries(['Profile,PermissionSet'])).to.deep.equal(['Profile', 'PermissionSet']);
  });

  it('trims whitespace and drops empties', () => {
    expect(splitMetadataEntries(['Profile, , PermissionSet:Admin '])).to.deep.equal(['Profile', 'PermissionSet:Admin']);
  });

  it('preserves Type:Name and dotted members', () => {
    expect(splitMetadataEntries(['Profile:Admin', 'RecordType:Account.Business'])).to.deep.equal([
      'Profile:Admin',
      'RecordType:Account.Business',
    ]);
  });
});

describe('isOutcomeFailed()', () => {
  const withFailures = { successes: [], failures: [{ type: 'Profile', fullName: 'Admin', status: 'error' as const }] };
  const noFailures = { successes: [{ type: 'Profile', fullName: 'Admin', status: 'success' as const }], failures: [] };

  it('is true when there are failures and errors are not ignored', () => {
    expect(isOutcomeFailed(withFailures, false)).to.be.true;
  });

  it('is false when failures are ignored', () => {
    expect(isOutcomeFailed(withFailures, true)).to.be.false;
  });

  it('is false when there are no failures', () => {
    expect(isOutcomeFailed(noFailures, false)).to.be.false;
  });
});

describe('isCrudIncompatibleAdapter()', () => {
  it('flags content/binary/bundle adapters', () => {
    expect(isCrudIncompatibleAdapter('bundle')).to.be.true;
    expect(isCrudIncompatibleAdapter('matchingContentFile')).to.be.true;
    expect(isCrudIncompatibleAdapter('mixedContent')).to.be.true;
    expect(isCrudIncompatibleAdapter('digitalExperience')).to.be.true;
  });

  it('allows pure-XML adapters', () => {
    expect(isCrudIncompatibleAdapter('decomposed')).to.be.false;
    expect(isCrudIncompatibleAdapter('default')).to.be.false;
  });

  it('treats a missing adapter as compatible', () => {
    expect(isCrudIncompatibleAdapter(undefined)).to.be.false;
    expect(isCrudIncompatibleAdapter(null)).to.be.false;
  });
});

describe('isCrudIncompatibleTypeName()', () => {
  const registry = fakeRegistry({
    LightningComponentBundle: 'bundle',
    ApexClass: 'matchingContentFile',
    StaticResource: 'mixedContent',
    CustomObject: 'decomposed',
    Profile: undefined,
  });

  it('flags code/binary/bundle types', () => {
    expect(isCrudIncompatibleTypeName('LightningComponentBundle', registry)).to.be.true;
    expect(isCrudIncompatibleTypeName('ApexClass', registry)).to.be.true;
    expect(isCrudIncompatibleTypeName('StaticResource', registry)).to.be.true;
  });

  it('allows pure-XML types', () => {
    expect(isCrudIncompatibleTypeName('CustomObject', registry)).to.be.false;
    expect(isCrudIncompatibleTypeName('Profile', registry)).to.be.false;
  });

  it('treats an unknown type as compatible (lets the API surface the real error)', () => {
    expect(isCrudIncompatibleTypeName('NotARealType', registry)).to.be.false;
  });
});

describe('partitionCrudCompatibility()', () => {
  const registry = fakeRegistry({
    Profile: undefined,
    PermissionSet: undefined,
    LightningComponentBundle: 'bundle',
    ApexClass: 'matchingContentFile',
  });
  const components = [
    { type: { name: 'Profile' }, fullName: 'Admin' },
    { type: { name: 'LightningComponentBundle' }, fullName: 'myCmp' },
    { type: { name: 'PermissionSet' }, fullName: 'PS1' },
    { type: { name: 'ApexClass' }, fullName: 'MyClass' },
  ];

  it('routes incompatible types to skipped and the rest to supported', () => {
    const { supported, skipped } = partitionCrudCompatibility(components, registry);
    expect(supported.map((c) => c.fullName)).to.deep.equal(['Admin', 'PS1']);
    expect(skipped.map((c) => c.fullName)).to.deep.equal(['myCmp', 'MyClass']);
  });

  it('returns empty arrays for empty input', () => {
    const { supported, skipped } = partitionCrudCompatibility([], registry);
    expect(supported).to.deep.equal([]);
    expect(skipped).to.deep.equal([]);
  });
});

describe('buildMetadataXml()', () => {
  it('wraps the body in the type root element with the metadata namespace', () => {
    const xml = buildMetadataXml('Profile', { custom: false, userLicense: 'Salesforce' });
    expect(xml).to.contain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).to.contain('<Profile xmlns="http://soap.sforce.com/2006/04/metadata">');
    expect(xml).to.contain('<userLicense>Salesforce</userLicense>');
    expect(xml).to.contain('</Profile>');
  });

  it('renders array values as repeated elements', () => {
    const xml = buildMetadataXml('Profile', {
      userPermissions: [
        { enabled: true, name: 'ApiEnabled' },
        { enabled: true, name: 'ViewSetup' },
      ],
    });
    const occurrences = xml.match(/<userPermissions>/g) || [];
    expect(occurrences).to.have.length(2);
    expect(xml).to.contain('<name>ApiEnabled</name>');
    expect(xml).to.contain('<name>ViewSetup</name>');
  });

  it('ends with a trailing newline', () => {
    const xml = buildMetadataXml('PermissionSet', { hasActivationRequired: false });
    expect(xml.endsWith('\n')).to.be.true;
  });

  // Byte-exact characterization: these snapshots pin the output of the historical
  // XML builder. The generated files are deployed as metadata, so any builder change
  // must keep them identical.
  it('builds a nested document byte-identically', () => {
    const xml = buildMetadataXml('Profile', {
      custom: false,
      fieldPermissions: [
        { editable: false, field: 'Account.A__c', readable: true },
        { editable: true, field: 'Account.B__c', readable: true },
      ],
      description: 'A & B <test> "quoted"',
      userLicense: 'Salesforce',
    });
    expect(xml).to.equal(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Profile xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
      '    <custom>false</custom>\n' +
      '    <fieldPermissions>\n' +
      '        <editable>false</editable>\n' +
      '        <field>Account.A__c</field>\n' +
      '        <readable>true</readable>\n' +
      '    </fieldPermissions>\n' +
      '    <fieldPermissions>\n' +
      '        <editable>true</editable>\n' +
      '        <field>Account.B__c</field>\n' +
      '        <readable>true</readable>\n' +
      '    </fieldPermissions>\n' +
      '    <description>A &amp; B &lt;test&gt; &quot;quoted&quot;</description>\n' +
      '    <userLicense>Salesforce</userLicense>\n' +
      '</Profile>\n'
    );
  });

  it('renders empty string values as open+close tags (suppressEmptyNode false)', () => {
    const xml = buildMetadataXml('CustomObject', { deploymentStatus: 'Deployed', description: '' });
    expect(xml).to.equal(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
      '    <deploymentStatus>Deployed</deploymentStatus>\n' +
      '    <description></description>\n' +
      '</CustomObject>\n'
    );
  });
});

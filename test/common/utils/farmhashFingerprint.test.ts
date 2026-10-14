/* cspell:disable */
// The corpus below intentionally mixes languages and random strings
import { expect } from 'chai';
import { fingerprint32 } from '../../../src/common/utils/farmhashFingerprint.js';

// Reference values were produced by the native `farmhash` npm package (v5.0.1, farmhash.fingerprint32)
// before it was replaced by the pure TypeScript port. They must never change: fingerprints are persisted
// as AI cache keys and flow documentation node ids.
const EXPECTED: Array<[string, number]> = [
  ['empty', 3696677242],
  ['ascii-len-1', 1016544589],
  ['ascii-len-2', 1098068221],
  ['ascii-len-3', 795041479],
  ['ascii-len-4', 2562006677],
  ['ascii-len-5', 2750637740],
  ['ascii-len-6', 260127396],
  ['ascii-len-7', 568243927],
  ['ascii-len-8', 4252944569],
  ['ascii-len-9', 1872288902],
  ['ascii-len-10', 4066808673],
  ['ascii-len-11', 2378725735],
  ['ascii-len-12', 1769366226],
  ['ascii-len-13', 1792790684],
  ['ascii-len-14', 989698811],
  ['ascii-len-15', 3908386352],
  ['ascii-len-16', 1303130272],
  ['ascii-len-17', 724493425],
  ['ascii-len-18', 23921399],
  ['ascii-len-19', 2435561872],
  ['ascii-len-20', 3981568669],
  ['ascii-len-21', 1691896692],
  ['ascii-len-22', 4100766388],
  ['ascii-len-23', 124185522],
  ['ascii-len-24', 222712484],
  ['ascii-len-25', 1851954435],
  ['ascii-len-26', 2513786326],
  ['ascii-len-27', 86487572],
  ['ascii-len-28', 257524757],
  ['ascii-len-29', 964916138],
  ['ascii-len-30', 337091668],
  ['ascii-len-31', 2265718616],
  ['ascii-len-32', 546960691],
  ['ascii-len-33', 4292589527],
  ['ascii-len-34', 3042100097],
  ['ascii-len-35', 2303443758],
  ['ascii-len-36', 30939030],
  ['ascii-len-37', 3287889660],
  ['ascii-len-38', 357661836],
  ['ascii-len-39', 861989583],
  ['ascii-len-40', 1848437945],
  ['long-50', 1371739502],
  ['long-100', 3317505930],
  ['long-255', 3628565729],
  ['long-256', 974433509],
  ['long-1000', 666539514],
  ['long-5000', 2112739076],
  ['utf8-accents', 3005636834],
  ['utf8-cjk', 2287490983],
  ['utf8-emoji', 112400893],
  ['utf8-mixed', 3121168073],
  ['utf8-2byte', 1973972843],
  ['utf8-3byte', 1307265683],
  ['utf8-4byte', 1679634296],
  ['utf8-5bytes', 852424778],
  ['json-flow-node', 2412356475],
  ['json-flow-obj', 531623436],
  ['json-prompt', 2011105457],
  ['random-0', 3349297508],
  ['random-1', 675991509],
  ['random-2', 4225499404],
  ['random-3', 748987397],
  ['random-4', 923176155],
  ['random-5', 876527534],
  ['random-6', 4139243393],
  ['random-7', 2823217633],
  ['random-8', 2045868619],
  ['random-9', 899965332],
  ['random-10', 1057452167],
  ['random-11', 3385492989],
  ['random-12', 2579674121],
  ['random-13', 1232948755],
  ['random-14', 2761011909],
  ['random-15', 718178888],
  ['random-16', 922116000],
  ['random-17', 2803576223],
  ['random-18', 1933401971],
  ['random-19', 460333717],
  ['random-20', 3287058178],
  ['random-21', 2278896803],
  ['random-22', 905400010],
  ['random-23', 843802146],
  ['random-24', 1512689116],
  ['random-25', 3345251256],
  ['random-26', 3215917615],
  ['random-27', 202325611],
  ['random-28', 2344506712],
  ['random-29', 1948615025],
  ['random-30', 913223952],
  ['random-31', 2030796675],
  ['random-32', 2289031593],
  ['random-33', 825568261],
  ['random-34', 141111388],
  ['random-35', 1744216097],
  ['random-36', 1297701863],
  ['random-37', 3211944525],
  ['random-38', 1007463726],
  ['random-39', 3673595606],
  ['random-40', 222240387],
  ['random-41', 2762733046],
  ['random-42', 2443216282],
  ['random-43', 2236170933],
  ['random-44', 3782210175],
  ['random-45', 2302839676],
  ['random-46', 561332301],
  ['random-47', 3789197179],
  ['random-48', 3675918895],
  ['random-49', 80990208],
];

function buildCorpus(): Map<string, string> {
  const cases = new Map<string, string>();
  const add = (label: string, s: string) => cases.set(label, s);

  add('empty', '');
  // byte lengths 1..40 (pure ASCII so byte length == char length)
  const alpha = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let n = 1; n <= 40; n++) add(`ascii-len-${n}`, alpha.slice(0, n).padEnd(n, alpha.slice(n % 10)));
  for (const n of [50, 100, 255, 256, 1000, 5000]) {
    let s = '';
    for (let i = 0; i < n; i++) s += alpha[(i * 7 + 3) % alpha.length];
    add(`long-${n}`, s);
  }
  add('utf8-accents', 'Création du champ Numéro de téléphone – àéèùç ÀÉÈÙ ñ ß');
  add('utf8-cjk', '日本語のテキスト 取引先 項目 フロー 中文测试 한국어');
  add('utf8-emoji', 'Deploy done ✅ 🚀 🎉 with 👍🏽 and 🇫🇷');
  add('utf8-mixed', 'Flow_Opportunity_Étape1 → 顧客 🙂 ok');
  add('utf8-2byte', 'é');
  add('utf8-3byte', '日');
  add('utf8-4byte', '🚀');
  add('utf8-5bytes', 'aé日');
  add(
    'json-flow-node',
    JSON.stringify({
      name: 'Get_Account',
      label: 'Get Account',
      locationX: 176,
      locationY: 158,
      object: 'Account',
      filters: [{ field: 'Id', operator: 'EqualTo', value: { elementReference: 'recordId' } }],
    })
  );
  add(
    'json-flow-obj',
    JSON.stringify({
      apiVersion: '61.0',
      label: 'My Flow',
      processType: 'AutoLaunchedFlow',
      status: 'Active',
      start: { locationX: 50, locationY: 0, connector: { targetReference: 'Get_Account' } },
      recordLookups: [{ name: 'Get_Account', label: 'Get Account' }],
      decisions: [],
      description: 'Flow de test avec accents é',
    })
  );
  add(
    'json-prompt',
    JSON.stringify({
      promptKey: 'PROMPT_DESCRIBE_FLOW',
      text: 'Describe the flow\nwith lines',
      variables: { flowName: 'Foo', version: 2 },
    })
  );
  // deterministic pseudo-random strings via LCG
  let seed = 123456789;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed;
  };
  const charset = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~éàü€日本🚀';
  const chars = Array.from(charset);
  for (let i = 0; i < 50; i++) {
    const len = (rnd() % 300) + 1;
    let s = '';
    for (let j = 0; j < len; j++) s += chars[rnd() % chars.length];
    add(`random-${i}`, s);
  }
  return cases;
}

describe('farmhashFingerprint.fingerprint32', () => {
  const corpus = buildCorpus();

  it('covers every reference case exactly once', () => {
    expect(EXPECTED.length).to.equal(corpus.size);
    expect(new Set(EXPECTED.map(([label]) => label)).size).to.equal(EXPECTED.length);
    for (const [label] of EXPECTED) {
      expect(corpus.has(label), `corpus is missing case ${label}`).to.equal(true);
    }
  });

  for (const [label, expected] of EXPECTED) {
    it(`matches native farmhash.fingerprint32 for ${label}`, () => {
      const input = corpus.get(label) as string;
      expect(fingerprint32(input)).to.equal(expected);
    });
  }

  it('accepts raw bytes and hashes strings as UTF-8', () => {
    expect(fingerprint32(Buffer.from('utf8 test 日本 🚀', 'utf8'))).to.equal(fingerprint32('utf8 test 日本 🚀'));
    expect(fingerprint32(new Uint8Array([0x61]))).to.equal(fingerprint32('a'));
  });

  it('returns unsigned 32-bit integers', () => {
    for (const input of corpus.values()) {
      const h = fingerprint32(input);
      expect(Number.isInteger(h)).to.equal(true);
      expect(h).to.be.at.least(0);
      expect(h).to.be.at.most(0xffffffff);
    }
  });
});

import { expect } from 'chai';
import { splitTicketNumbers } from '../../../../src/commands/hardis/misc/servicenow-report.js';

/**
 * One user story often carries several tickets in a single field, and teams separate them with
 * whatever their process settled on. A separator the command does not know is not a cosmetic
 * problem: the whole value goes into the ServiceNow `numberIN` query as one token, that token
 * matches nothing, and the report says NOT FOUND for tickets that do exist.
 */
describe('servicenow-report ticket field splitting', () => {
  it('splits on spaces, the case that reported NOT FOUND', () => {
    expect(splitTicketNumbers('DMND0000001 DMND0000002')).to.deep.equal(['DMND0000001', 'DMND0000002']);
  });

  it('still splits on a comma and on a semicolon', () => {
    expect(splitTicketNumbers('DMND0000001,DMND0000002')).to.deep.equal(['DMND0000001', 'DMND0000002']);
    expect(splitTicketNumbers('DMND0000001;DMND0000002')).to.deep.equal(['DMND0000001', 'DMND0000002']);
    expect(splitTicketNumbers('DMND0000001; DMND0000002')).to.deep.equal(['DMND0000001', 'DMND0000002']);
  });

  it('handles a field that mixes separators', () => {
    expect(splitTicketNumbers('DMND0000001, DMND0000002 DMND0000003')).to.deep.equal([
      'DMND0000001',
      'DMND0000002',
      'DMND0000003',
    ]);
  });

  it('keeps a single ticket as one entry', () => {
    expect(splitTicketNumbers('DMND0000001')).to.deep.equal(['DMND0000001']);
  });

  it('trims the padding a copy and paste leaves behind', () => {
    expect(splitTicketNumbers('  DMND0000001 \t DMND0000002  ')).to.deep.equal(['DMND0000001', 'DMND0000002']);
    expect(splitTicketNumbers('DMND0000001,,;DMND0000002')).to.deep.equal(['DMND0000001', 'DMND0000002']);
  });

  it('splits on a line break, which a multi-line text field produces', () => {
    expect(splitTicketNumbers('DMND0000001\nDMND0000002\r\nDMND0000003')).to.deep.equal([
      'DMND0000001',
      'DMND0000002',
      'DMND0000003',
    ]);
  });

  it('returns nothing for an empty or absent value, so no ticket is queried', () => {
    for (const emptyValue of ['', '   ', ' ,; ', null, undefined, 42, {}]) {
      expect(splitTicketNumbers(emptyValue), `should be empty for ${JSON.stringify(emptyValue)}`).to.deep.equal([]);
    }
  });
});

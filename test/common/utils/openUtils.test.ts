import { expect } from 'chai';
import { buildLauncher, open } from '../../../src/common/utils/openUtils.js';

describe('openUtils.buildLauncher', () => {
  it('uses cmd.exe start on Windows and keeps ampersands untouched inside the quotes', () => {
    const launcher = buildLauncher('https://example.com/a?b=1&c=2', 'win32', false);
    expect(launcher.command).to.equal('cmd.exe');
    expect(launcher.args.slice(0, 3)).to.deep.equal(['/d', '/s', '/c']);
    expect(launcher.args[3]).to.equal('start "" "https://example.com/a?b=1&c=2"');
  });

  it('uses open on macOS', () => {
    const launcher = buildLauncher('/tmp/report.xlsx', 'darwin', false);
    expect(launcher).to.deep.equal({ command: 'open', args: ['/tmp/report.xlsx'] });
  });

  it('uses xdg-open on Linux', () => {
    const launcher = buildLauncher('https://example.com', 'linux', false);
    expect(launcher).to.deep.equal({ command: 'xdg-open', args: ['https://example.com'] });
  });

  it('uses the Windows host browser under WSL', () => {
    const launcher = buildLauncher('https://example.com', 'linux', true);
    expect(launcher.command).to.equal('sh');
    expect(launcher.args[0]).to.equal('-c');
    expect(launcher.args[1]).to.contain('wslview');
    expect(launcher.args[2]).to.equal('https://example.com');
  });
});

describe('openUtils.open during the tests', () => {
  it('runs with NO_OPEN set by the mocha setup, so nothing opens on the desktop', async () => {
    expect(process.env.NO_OPEN).to.equal('true');
    // Would start the default application of .xlsx files without NO_OPEN
    await open('report-that-must-not-open.xlsx');
  });
});

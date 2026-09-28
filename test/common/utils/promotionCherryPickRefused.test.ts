import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

// A cherry-pick git refuses outright - untracked working tree files it would have to overwrite,
// most often the sfdx-hardis reports of a project that never gitignored them - leaves no
// CHERRY_PICK_HEAD and no conflicted path. It used to be reported as a cherry-pick conflict with an
// empty file list, which told the user nothing they could act on. The message that replaced it must
// exist in every locale and must carry both the story and the reason git gave.
describe('promotionCreateCherryPickRefused', () => {
  const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt-BR'];
  const KEY = 'promotionCreateCherryPickRefused';
  const readLocale = (locale: string) =>
    JSON.parse(fs.readFileSync(path.join('src', 'i18n', `${locale}.json`), 'utf8')) as Record<string, string>;

  for (const locale of LOCALES) {
    it(`is translated in ${locale} and keeps both placeholders`, () => {
      const messages = readLocale(locale);
      expect(messages[KEY], `${KEY} missing from ${locale}.json`).to.be.a('string').and.not.equal('');
      expect(messages[KEY]).to.include('{{label}}');
      expect(messages[KEY]).to.include('{{reason}}');
    });
  }

  it('says the promotion was undone, so nobody looks for a branch to fix', () => {
    expect(readLocale('en')[KEY]).to.match(/undone/i);
  });

  it('is a different message from the cherry-pick conflict one', () => {
    const messages = readLocale('en');
    expect(messages[KEY]).to.not.equal(messages['promotionCreateConflictAgent']);
    expect(messages[KEY]).to.not.equal(messages['promotionCreateConflict']);
  });

  it('is raised by cherryPickCandidates instead of the conflict path', () => {
    const source = fs.readFileSync(path.join('src', 'common', 'utils', 'promotionCreateUtils.ts'), 'utf8');
    // The guard has to run before the conflict choices are offered, otherwise an agent aborts and a
    // human is asked to pick between three ways of solving something that does not exist
    const guard = source.indexOf(KEY);
    const conflictChoice = source.indexOf('promptConflictChoice(candidate, commandThis)');
    expect(guard, 'the refused cherry-pick message is not raised in promotionCreateUtils').to.be.greaterThan(-1);
    expect(conflictChoice).to.be.greaterThan(-1);
    expect(guard, 'the refused cherry-pick guard must come before the conflict choices').to.be.lessThan(conflictChoice);
    expect(source).to.include('isCherryPickInProgress');
  });
});

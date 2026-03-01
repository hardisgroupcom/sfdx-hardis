import { expect } from 'chai';
import { t } from '../../../src/common/utils/i18n.js';

describe('i18n', () => {
  const initialLocale = process.env.SFDX_HARDIS_LOCALE;

  afterEach(() => {
    process.env.SFDX_HARDIS_LOCALE = initialLocale;
  });

  it('translates prompt descriptions to French when locale is fr', () => {
    process.env.SFDX_HARDIS_LOCALE = 'fr';
    expect(
      t('Select one or more Salesforce profiles for the operation')
    ).to.equal('Sélectionnez un ou plusieurs profils Salesforce pour cette opération');
  });

  it('keeps original text when locale is en', () => {
    process.env.SFDX_HARDIS_LOCALE = 'en';
    expect(
      t('Select one or more Salesforce profiles for the operation')
    ).to.equal('Select one or more Salesforce profiles for the operation');
  });

  it('interpolates variables in translated strings', () => {
    process.env.SFDX_HARDIS_LOCALE = 'fr';
    expect(t('Hello {{name}}', { name: 'Alice' })).to.equal('Bonjour Alice');
  });

  it('keeps markers unchanged while translating text', () => {
    process.env.SFDX_HARDIS_LOCALE = 'fr';
    expect(t('[sfdx-hardis] Updated .gitignore.')).to.equal('[sfdx-hardis] .gitignore mis à jour.');
  });
});

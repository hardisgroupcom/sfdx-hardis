/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { parseNotebookMarkdown, parseSteps, renderStepsFlat } from '../../../src/common/utils/testNotebookUtils.js';

const NOTEBOOK = [
  '# Cahier de test PROJ-123',
  '',
  '## Cas de test fonctionnels',
  '',
  '| ID | Module | Priorité | Cas de test | Prérequis et données | Requête SOQL | Étapes | Résultat attendu |',
  '|---|---|---|---|---|---|---|---|',
  '| PROJ-123-F01 | Devis | P1 | Créer un devis | Un compte actif | SELECT Id FROM Account LIMIT 1 | 1. Ouvrir le compte → La page s_affiche<br>2. Cliquer Nouveau devis → Le devis est cree | Le devis est enregistre |',
  '| PROJ-123-F02 | Devis | P2 | Annuler un devis | Un devis brouillon |  | 1. Ouvrir le devis → Le devis s_affiche | Le devis passe Annule |',
  '',
  '## Autre section',
].join('\n');

describe('testNotebookUtils - markdown', () => {
  it('parses every row of the first test case table', () => {
    const cases = parseNotebookMarkdown(NOTEBOOK);
    expect(cases).to.have.lengthOf(2);
    expect(cases[0].id).to.equal('PROJ-123-F01');
    expect(cases[0].ticket).to.equal('PROJ-123');
    expect(cases[0].kind).to.equal('functional');
    expect(cases[0].module).to.equal('Devis');
    expect(cases[0].priority).to.equal(1);
    expect(cases[0].title).to.equal('Créer un devis');
    expect(cases[0].soql).to.equal('SELECT Id FROM Account LIMIT 1');
    expect(cases[0].steps).to.have.lengthOf(2);
    expect(cases[0].steps[1].action).to.equal('Cliquer Nouveau devis');
    expect(cases[0].steps[1].expected).to.equal('Le devis est cree');
  });

  it('leaves an empty soql cell empty, never a placeholder marker', () => {
    const cases = parseNotebookMarkdown(NOTEBOOK);
    expect(cases[1].soql).to.equal('');
  });

  it('accepts unaccented and English header aliases', () => {
    const alt = NOTEBOOK
      .replace('Priorité', 'Priority')
      .replace('Cas de test', 'Test case')
      .replace('Étapes', 'Steps')
      .replace('Résultat attendu', 'Expected result');
    const cases = parseNotebookMarkdown(alt);
    expect(cases[0].priority).to.equal(1);
    expect(cases[0].title).to.equal('Créer un devis');
    expect(cases[0].steps).to.have.lengthOf(2);
  });

  it('throws when the markdown holds no table', () => {
    expect(() => parseNotebookMarkdown('# Titre seul\n\nDu texte.')).to.throw(/no test case table/i);
  });

  describe('parseSteps', () => {
    it('gives a step with no arrow the completion marker, never an empty expected', () => {
      expect(parseSteps('1. Faire quelque chose')).to.deep.equal([
        { action: 'Faire quelque chose', expected: 'À COMPLÉTER' },
      ]);
    });

    it('splits on the FIRST arrow only, so an expected may hold one', () => {
      const [step] = parseSteps('Cliquer → A → B');
      expect(step.action).to.equal('Cliquer');
      expect(step.expected).to.equal('A → B');
    });

    it('restores a literal arrow written ->', () => {
      const [step] = parseSteps('Saisir A -> B → Le champ vaut A -> B');
      expect(step.action).to.equal('Saisir A → B');
      expect(step.expected).to.equal('Le champ vaut A → B');
    });
  });

  describe('renderStepsFlat', () => {
    it('renders a numbered one-line cell and substitutes a literal pipe', () => {
      const flat = renderStepsFlat([{ action: 'A|B', expected: 'C' }, { action: 'D', expected: 'E' }]);
      expect(flat).to.equal('1. A/B → C | 2. D → E');
    });

    it('renders an empty array as an empty string', () => {
      expect(renderStepsFlat([])).to.equal('');
    });
  });
});

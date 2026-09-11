import { TestCaseStep } from '../utils/testNotebookTypes.js';

function _htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The field stores HTML as an XML escaped string. The step text is HTML escaped first, then
 * the whole DIV/P fragment is escaped again, so `Enter <Account Name>` stays text once Azure
 * DevOps decodes the XML, instead of turning into a tag that swallows it.
 */
function _wrap(text: string): string {
  return _htmlEscape(`<DIV><P>${_htmlEscape(text)}</P></DIV>`);
}

function _oneLine(value: unknown): string {
  return String(value ?? '')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim();
}

/**
 * Build the `Microsoft.VSTS.TCM.Steps` XML of an Azure DevOps Test Case.
 *
 * Step ids start at 2 and `last` is steps + 1: Azure DevOps behavior, not a choice.
 *
 * The second `parameterizedString` carries the step's OWN expected result. The transformer
 * this code descends from emitted a blank line there instead, which silently dropped the
 * assertion of every step on every push.
 */
export function azureDevopsStepsXml(steps: TestCaseStep[]): string {
  const list = (Array.isArray(steps) ? steps : []).filter((step) => step && (step.action || step.expected));
  if (list.length === 0) {
    return '<steps id="0" last="1"></steps>';
  }
  const parts = [`<steps id="0" last="${list.length + 1}">`];
  list.forEach((step, i) => {
    const expected = _oneLine(step.expected);
    // Azure DevOps types a step with an expected result as ValidateStep.
    const type = expected ? 'ValidateStep' : 'ActionStep';
    parts.push(
      `<step id="${i + 2}" type="${type}">`,
      `<parameterizedString isformatted="true">${_wrap(_oneLine(step.action))}</parameterizedString>`,
      `<parameterizedString isformatted="true">${_wrap(expected)}</parameterizedString>`,
      '<description/>',
      '</step>'
    );
  });
  parts.push('</steps>');
  return parts.join('');
}

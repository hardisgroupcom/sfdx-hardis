import { TestCaseStep } from '../utils/testNotebookTypes.js';

function _htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The field stores HTML as an escaped string, so the DIV/P wrappers are escaped too. */
function _wrap(text: string): string {
  return `&lt;DIV&gt;&lt;P&gt;${_htmlEscape(text)}&lt;/P&gt;&lt;/DIV&gt;`;
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
    parts.push(
      `<step id="${i + 2}" type="ActionStep">`,
      `<parameterizedString isformatted="true">${_wrap(_oneLine(step.action))}</parameterizedString>`,
      `<parameterizedString isformatted="true">${_wrap(_oneLine(step.expected))}</parameterizedString>`,
      '<description/>',
      '</step>'
    );
  });
  parts.push('</steps>');
  return parts.join('');
}

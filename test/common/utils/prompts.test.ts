import { expect } from 'chai';
import {
  askTerminalQuestion,
  getQuestionDefault,
  resolveDefaultChoiceValue,
  setTerminalPromptFunctionsForTests,
  TerminalPromptFunctions,
} from '../../../src/common/utils/prompts.js';

describe('prompts defaults', () => {
  const choices = [
    { name: 'Yes', value: true },
    { name: 'No', value: false },
    { name: 'Three', value: 3 },
  ];

  it('keeps a default that matches a choice value', () => {
    expect(resolveDefaultChoiceValue(false, choices)).to.equal(false);
    expect(resolveDefaultChoiceValue(3, choices)).to.equal(3);
  });

  it('maps a numeric index to the choice value when no value matches', () => {
    expect(resolveDefaultChoiceValue(1, choices)).to.equal(false);
    expect(resolveDefaultChoiceValue(0, choices)).to.equal(true);
  });

  it('returns undefined for a missing default', () => {
    expect(resolveDefaultChoiceValue(undefined, choices)).to.equal(undefined);
    expect(resolveDefaultChoiceValue(null, choices)).to.equal(undefined);
  });

  it('passes unknown defaults through', () => {
    expect(resolveDefaultChoiceValue('other', choices)).to.equal('other');
    expect(resolveDefaultChoiceValue(42, choices)).to.equal(42);
  });

  it('prefers default over initial and ignores falsy values', () => {
    const base = { message: 'm', description: 'd', type: 'text' as const };
    expect(getQuestionDefault({ ...base, default: 'a', initial: 'b' })).to.equal('a');
    expect(getQuestionDefault({ ...base, initial: 'b' })).to.equal('b');
    expect(getQuestionDefault({ ...base, initial: 0 })).to.equal(undefined);
    expect(getQuestionDefault({ ...base, default: '', initial: 1 })).to.equal(1);
    expect(getQuestionDefault(base)).to.equal(undefined);
  });
});

describe('prompts terminal mapping to @inquirer', () => {
  const calls: Array<{ kind: string; config: any }> = [];
  const fakes: TerminalPromptFunctions = {
    select: async (config) => {
      calls.push({ kind: 'select', config });
      return config.default ?? config.choices[0].value;
    },
    checkbox: async (config) => {
      calls.push({ kind: 'checkbox', config });
      return config.choices.filter((c: any) => c.checked).map((c: any) => c.value);
    },
    input: async (config) => {
      calls.push({ kind: 'input', config });
      return config.default ?? 'typed';
    },
    number: async (config) => {
      calls.push({ kind: 'number', config });
      return config.default ?? 7;
    },
  };

  beforeEach(() => {
    calls.length = 0;
    setTerminalPromptFunctionsForTests(fakes);
  });

  afterEach(() => {
    setTerminalPromptFunctionsForTests(null);
  });

  it('maps a select question with titles, descriptions, index default and page size', async () => {
    const answer = await askTerminalQuestion({
      type: 'select',
      message: 'Pick',
      description: 'd',
      choices: [
        { title: 'Alpha', value: 'a' },
        { title: 'Beta', value: 'b', description: 'second' },
      ],
      initial: 1,
    });
    expect(answer).to.equal('b');
    expect(calls[0].kind).to.equal('select');
    expect(calls[0].config.message).to.equal('Pick');
    expect(calls[0].config.pageSize).to.equal(9999);
    expect(calls[0].config.choices).to.deep.equal([
      { name: 'Alpha', value: 'a', description: undefined },
      { name: 'Beta', value: 'b', description: 'second' },
    ]);
  });

  it('maps a select default given as a value and honors optionsPerPage', async () => {
    await askTerminalQuestion({
      type: 'select',
      message: 'Pick',
      description: 'd',
      choices: [{ title: 'A', value: { id: 1 } }, { title: 'B', value: 'b' }],
      default: 'b',
      optionsPerPage: 5,
    });
    expect(calls[0].config.default).to.equal('b');
    expect(calls[0].config.pageSize).to.equal(5);
  });

  it('maps a multiselect to a checkbox with checked defaults', async () => {
    const answer = await askTerminalQuestion({
      type: 'multiselect',
      message: 'Many',
      description: 'd',
      choices: [{ title: 'A', value: 'a' }, { title: 'B', value: 'b' }, { title: 'C', value: 'c' }],
      default: ['a', 'c'],
    });
    expect(calls[0].kind).to.equal('checkbox');
    expect(calls[0].config.choices.map((c: any) => c.checked)).to.deep.equal([true, false, true]);
    expect(answer).to.deep.equal(['a', 'c']);
  });

  it('maps text and number questions with defaults and validate', async () => {
    const validate = (value: any) => (value ? true : 'required');
    const text = await askTerminalQuestion({ type: 'text', message: 'Name?', description: 'd', default: 'nicolas', validate });
    expect(text).to.equal('nicolas');
    expect(calls[0].kind).to.equal('input');
    expect(calls[0].config.default).to.equal('nicolas');
    expect(await calls[0].config.validate('')).to.equal('required');
    expect(await calls[0].config.validate('x')).to.equal(true);

    const num = await askTerminalQuestion({ type: 'number', message: 'How many?', description: 'd', initial: 3 });
    expect(num).to.equal(3);
    expect(calls[1].kind).to.equal('number');
    expect(calls[1].config.default).to.equal(3);
  });

  it('does not send a default of the wrong type to text and number prompts', async () => {
    await askTerminalQuestion({ type: 'text', message: 'Name?', description: 'd', default: 5 });
    expect(calls[0].config.default).to.equal(undefined);
    await askTerminalQuestion({ type: 'number', message: 'N?', description: 'd', default: 'abc' });
    expect(calls[1].config.default).to.equal(undefined);
  });
});

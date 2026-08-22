import c from "chalk";
import checkbox from "@inquirer/checkbox";
import input from "@inquirer/input";
import number from "@inquirer/number";
import select from "@inquirer/select";
import { SfError } from "@salesforce/core";
import { isCI, uxLog } from "./index.js";
import { WebSocketClient } from "../websocketClient.js";
import { t } from './i18n.js';

export interface PromptChoice<T = unknown> {
  title: string;
  value?: T;
  description?: string;
}

export interface PromptsQuestion {
  message: string;
  description: string;
  placeholder?: string;
  type: "select" | "multiselect" | "confirm" | "text" | "number";
  /** Set to true when the answer is a secret (token, password...): the echo of the answer is hidden */
  sensitive?: boolean;
  name?: string;
  /** Array of choices. Use `PromptChoice` for proper typing. */
  choices?: Array<any>;
  default?: unknown;
  validate?: (value: any) => boolean | string | Promise<boolean | string>;
  initial?: unknown;
  optionsPerPage?: number;
}

// Centralized prompts function
export async function prompts(options: PromptsQuestion | PromptsQuestion[]): Promise<Record<string, any>> {
  if (isCI) {
    uxLog("log", this, c.grey(JSON.stringify(options, null, 2)));
    throw new SfError("Nothing should be prompted during CI!");
  }
  const questionsRaw = Array.isArray(options) ? options : [options];
  const questionsReformatted: any = [];
  for (const question of questionsRaw) {
    if (!question.message.startsWith("🦙")) {
      question.message = "🦙 " + question.message;
    }
    // Convert confirm to select
    if (question.type === "confirm") {
      question.type = "select";
      question.choices = [
        { title: t('promptChoiceYes'), value: true },
        { title: t('promptChoiceNo'), value: false },
      ];
      question.initial = question.initial === false ? 1 : 0;
    }
    // Default output value "value"
    if (question.name === null || question.name === undefined) {
      question.name = "value";
    }
    // Add exit option when possible
    if (question.type === "select" && !WebSocketClient.isAliveWithLwcUI()) {
      question.choices = question.choices || [];
      question.choices.push({ title: t('promptChoiceExit'), value: "exitNow" });
    }
    if (["select", "multiselect"].includes(question.type) && question.optionsPerPage == null) {
      question.optionsPerPage = 9999;
    }
    questionsReformatted.push(question);
  }
  // Prompt user
  let answers: any = {};
  if (WebSocketClient.isAlive()) {
    // Use UI prompt
    for (const question of questionsReformatted) {
      uxLog("action", this, c.cyan(question.message) + c.white(" Look up in VS Code ⬆️."));
      const [questionAnswer] = await WebSocketClient.sendPrompts([question]);
      answers = Object.assign(answers, questionAnswer);
      checkStopPrompts(answers);
      // Find the answer value (the value of the only property of questionAnswer)
      const answerKey = Object.keys(questionAnswer)[0];
      const answerValue = questionAnswer[answerKey];
      const answerLabel = getAnswerLabel(answerValue, question.choices);
      // question.sensitive is locale-independent (a translated message may not contain
      // the word "token"); the answer-content check stays as a safety net
      if (question.sensitive === true || JSON.stringify(answerLabel).toLowerCase().includes("token")) {
        uxLog("log", this, c.grey(t('selectionHiddenBecauseItContainsSensitiveInformation')));
      } else {
        uxLog("log", this, c.grey(answerLabel));
      }
    }
  } else {
    // Use text prompt
    answers = await terminalPrompts(questionsReformatted);
  }
  // Stop script if requested
  checkStopPrompts(answers);
  return answers;
}

// Helper to get display label(s) for answer value(s)
function getAnswerLabel(answerValue: any, choices?: Array<any>): string {
  if (Array.isArray(answerValue)) {
    if (choices && Array.isArray(choices) && choices.length > 0) {
      return answerValue.map(val => findChoiceLabel(val, choices) ?? (typeof val === 'string' ? `- ${val}` : "- " + JSON.stringify(val))).join('\n');
    } else {
      return answerValue.map(val => (typeof val === 'string' ? `- ${val}` : "- " + JSON.stringify(val))).join('\n');
    }
  }
  const label = findChoiceLabel(answerValue, choices);
  if (label) return label;
  return typeof answerValue === 'string' ? answerValue : JSON.stringify(answerValue);
}

// Helper to find the label for a value in choices
function findChoiceLabel(val: any, choices?: Array<any>): string | undefined {
  if (!choices || !Array.isArray(choices) || choices.length === 0) return undefined;
  const found = choices.find(choice => {
    if (typeof choice.value === "object" && typeof val === "object") {
      try {
        return JSON.stringify(choice.value) === JSON.stringify(val);
      } catch {
        return false;
      }
    }
    return choice.value === val;
  });
  return found && found.title ? found.title : undefined;
}

// Stop script if user requested it
function checkStopPrompts(answers: any) {
  if (typeof answers !== "object" || answers === null) {
    stopPrompt();
  }
  if (Object.keys(answers).length === 0) {
    stopPrompt();
  }
  for (const answer of Object.keys(answers)) {
    if (answers[answer] === "exitNow") {
      stopPrompt();
    }
  }
}

function stopPrompt() {
  uxLog("error", this, c.red(t('scriptTerminatedAtUserRequest')));
  // Send close client message with aborted status if WebSocket is alive
  if (WebSocketClient.isAlive()) {
    WebSocketClient.sendCloseClientMessage("aborted");
  }
  process.exit(0);
}

// Resolves the default of a choice-based question: callers pass either a choice value
// or (legacy behavior) the index of the choice in the list
export function resolveDefaultChoiceValue(defaultValue: unknown, choices: Array<any>): unknown {
  if (defaultValue === undefined || defaultValue === null) {
    return undefined;
  }
  if (choices.some((choice) => choice.value === defaultValue)) {
    return defaultValue;
  }
  if (typeof defaultValue === "number" && Number.isInteger(defaultValue) && choices[defaultValue] !== undefined) {
    return choices[defaultValue].value;
  }
  return defaultValue;
}

export function getQuestionDefault(question: PromptsQuestion): unknown {
  // Same precedence as before: default first, then initial (0 and "" are treated as unset)
  if (question.default) {
    return question.default;
  }
  if (question.initial) {
    return question.initial;
  }
  return undefined;
}

export interface TerminalPromptFunctions {
  select: (config: any) => Promise<any>;
  checkbox: (config: any) => Promise<any>;
  input: (config: any) => Promise<any>;
  number: (config: any) => Promise<any>;
}

let terminalPromptFunctions: TerminalPromptFunctions = { select, checkbox, input, number };

/** Replaces the terminal prompt implementations (unit tests only). Pass null to restore the defaults. */
export function setTerminalPromptFunctionsForTests(functions: TerminalPromptFunctions | null): void {
  terminalPromptFunctions = functions || { select, checkbox, input, number };
}

// Builds the @inquirer configuration of a question and asks it in the terminal
export async function askTerminalQuestion(question: PromptsQuestion): Promise<any> {
  const defaultValue = getQuestionDefault(question);
  const validate = question.validate ? (value: any) => question.validate!(value) : undefined;
  const choices = (question.choices || []).map((choice) => ({
    name: choice.title,
    value: choice.value,
    description: choice.description,
  }));
  const pageSize = question.optionsPerPage || 9999;
  if (question.type === "select") {
    return terminalPromptFunctions.select({
      message: question.message,
      choices: choices,
      default: resolveDefaultChoiceValue(defaultValue, choices),
      pageSize: pageSize,
    });
  }
  if (question.type === "multiselect") {
    const defaultValues = Array.isArray(defaultValue) ? defaultValue : [];
    return terminalPromptFunctions.checkbox({
      message: question.message,
      choices: choices.map((choice) => ({ ...choice, checked: defaultValues.includes(choice.value) })),
      pageSize: pageSize,
      validate: validate,
    });
  }
  if (question.type === "number") {
    return terminalPromptFunctions.number({
      message: question.message,
      default: typeof defaultValue === "number" ? defaultValue : undefined,
      validate: validate,
    });
  }
  return terminalPromptFunctions.input({
    message: question.message,
    default: typeof defaultValue === "string" ? defaultValue : undefined,
    validate: validate,
  });
}

async function terminalPrompts(questions: PromptsQuestion[]) {
  const answers: Record<string, any> = {};
  try {
    for (const question of questions) {
      answers[question.name || "value"] = await askTerminalQuestion(question);
    }
    return answers;
  } catch (e) {
    throw new SfError("Error while prompting: " + (e as Error).message);
  }
}

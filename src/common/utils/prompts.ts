import c from "chalk";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import inquirer from "inquirer";
import { SfError } from "@salesforce/core";
import { isCI, uxLog } from "./index.js";
import { WebSocketClient } from "../websocketClient.js";

export interface PromptsQuestion {
  message: string;
  description: string;
  placeholder?: string;
  type: "select" | "multiselect" | "confirm" | "text" | "number";
  name?: string;
  choices?: Array<any>;
  default?: any;
  validate?: any;
  initial?: any;
  optionsPerPage?: number;
}

// Centralized prompts function
export async function prompts(options: PromptsQuestion | PromptsQuestion[]) {
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
        { title: "✅ Yes", value: true },
        { title: "❌ No", value: false },
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
      question.choices.push({ title: "⛔ Exit this script", value: "exitNow" });
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
      if (JSON.stringify(answerLabel).toLowerCase().includes("token")) {
        uxLog("log", this, c.grey("Selection hidden because it contains sensitive information."));
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
  uxLog("error", this, c.red("Script terminated at user request."));
  // Send close client message with aborted status if WebSocket is alive
  if (WebSocketClient.isAlive()) {
    WebSocketClient.sendCloseClientMessage("aborted");
  }
  process.exit(0);
}

async function terminalPrompts(questions: PromptsQuestion[]) {
  const inquirerQuestions: any = [];
  for (const question of questions) {
    const inquirerQuestion: any = {
      name: question.name,
      type: question.type === "text" ? "input" : question.type === "multiselect" ? "checkbox" : question.type === "select" ? "list" : question.type,
      message: question.message,
    };
    if (question.choices) {
      inquirerQuestion.choices = question.choices.map((qstn) => {
        return {
          name: qstn.title,
          value: qstn.value,
        };
      });
    }
    if (question.default) {
      inquirerQuestion.default = question.default;
    } else if (question.initial) {
      inquirerQuestion.default = question.initial;
    }
    if (question.validate) {
      inquirerQuestion.validate = question.validate;
    }
    inquirerQuestions.push(inquirerQuestion);
  }
  try {
    const answers = await (inquirer as any).prompt(inquirerQuestions);
    return answers;
  } catch (e) {
    throw new SfError("Error while prompting: " + (e as Error).message);
  }
}

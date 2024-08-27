import * as c from "chalk";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import inquirer from "inquirer";
import { SfError } from "@salesforce/core";
import { isCI, uxLog } from "./index.js";
import { WebSocketClient } from "../websocketClient.js";

export interface PromptsQuestion {
  message: string;
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
    throw new SfError("Nothing should be prompted during CI !");
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
    if (question.type === "select") {
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
      uxLog(this, c.cyan(question.message) + c.white(" Look up in VsCode ⬆️"));
      const [questionAnswer] = await WebSocketClient.sendPrompts([question]);
      answers = Object.assign(answers, questionAnswer);
      if (JSON.stringify(answers).toLowerCase().includes("token")) {
        uxLog(this, c.grey("Selection done but hidden in log because it contains sensitive information"));
      } else {
        uxLog(this, c.grey(JSON.stringify(answers)));
      }
    }
  } else {
    // Use text prompt
    answers = await terminalPrompts(questionsReformatted);
  }
  // Stop script if requested
  for (const answer of Object.keys(answers)) {
    if (answers[answer] === "exitNow") {
      uxLog(this, "Script stopped by user request");
      process.exit(0);
    }
  }
  return answers;
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
    const answers = await inquirer.prompt(inquirerQuestions);
    return answers;
  } catch (e) {
    throw new SfError("Error while prompting: " + (e as Error).message);
  }
}

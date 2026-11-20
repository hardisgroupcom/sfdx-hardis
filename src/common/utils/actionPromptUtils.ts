/*
 * The prompts of the deployment action commands and utilities, in one place: the message shows in
 * the terminal and, as the description, in the VS Code command runner.
 */
import c from 'chalk';
import { prompts } from './prompts.js';

export async function promptActionSelect<T>(message: string, choices: { title: string; value: T }[], initial?: T): Promise<T> {
  const initialIndex = initial !== undefined ? choices.findIndex((choice) => choice.value === initial) : 0;
  const response = await prompts({
    type: 'select',
    name: 'value',
    message: c.cyanBright(message),
    choices,
    initial: initialIndex >= 0 ? initialIndex : 0,
    description: message,
  });
  return response.value;
}

export async function promptActionText(message: string, initial = ''): Promise<string> {
  const response = await prompts({
    type: 'text',
    name: 'value',
    message: c.cyanBright(message),
    initial,
    description: message,
  });
  return response.value || '';
}

export async function promptActionConfirm(message: string, initial = false): Promise<boolean> {
  const response = await prompts({
    type: 'confirm',
    name: 'value',
    message: c.cyanBright(message),
    default: initial,
    initial,
    description: message,
  });
  return response.value === true;
}

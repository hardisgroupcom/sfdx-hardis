import * as defaultPrompts from 'prompts';
import { SfdxError } from '@salesforce/core';
import { isCI, uxLog } from '.';

// Centralized prompts function
export async function prompts(options) {
    if (isCI) {
        throw new SfdxError("Nothing should be prompted during CI !")
    }
    const questionsRaw = Array.isArray(options) ? options : [options];
    const questionsReformatted = [];
    for (const question of questionsRaw) {
        // Convert confirm to select
        if (question.type === 'confirm') {
            question.type = 'select';
            question.choices = [
                { title: 'Yes', value: true },
                { title: 'No', value: false }
            ];
            question.initial = question.initial === false ? 1 : 0
        }
        // Add exit option when possible
        if (question.type === 'select') {
            question.choices.push({title: "-- Exit this script", value: 'exitNow'});
        }
        if (['select','multiselect'].includes(question.type) && question.optionsPerPage == null) {
            question.optionsPerPage = 9999
        }
        questionsReformatted.push(question)
    }
    // Prompt user
    const answers = await defaultPrompts(questionsReformatted);
    // Stop script if requested
    for (const answer of Object.keys(answers)) {
        if (answers[answer] === 'exitNow') {
            uxLog(this,'Script stopped by user request');
            process.exit(0);
        }
    }
    return answers;
}
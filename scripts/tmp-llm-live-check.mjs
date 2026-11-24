// TEMPORARY (removed before merge): proves the in-house LLM client against the real Gemini API,
// with the new AI_LLM_* names and with the former LANGCHAIN_LLM_* ones.
import { AiProvider } from '../lib/common/aiProvider/index.js';

const apiKey = process.env.LIVE_GOOGLE_API_KEY;
if (!apiKey) {
  console.error('LIVE_GOOGLE_API_KEY is not set');
  process.exit(1);
}
const model = process.env.LIVE_GOOGLE_MODEL || 'gemini-2.5-flash';
const cases = [
  { name: 'new AI_LLM_* names', env: { AI_LLM_PROVIDER: 'google-genai', AI_LLM_MODEL: model, AI_LLM_API_KEY: apiKey } },
  { name: 'former LANGCHAIN_LLM_* names', env: { LANGCHAIN_LLM_PROVIDER: 'google-genai', LANGCHAIN_LLM_MODEL: model, LANGCHAIN_LLM_MODEL_API_KEY: apiKey } },
];
let failures = 0;
for (const testCase of cases) {
  for (const key of Object.keys(process.env).filter((k) => k.startsWith('AI_LLM_') || k.startsWith('LANGCHAIN_LLM_'))) {
    delete process.env[key];
  }
  Object.assign(process.env, testCase.env);
  const provider = await AiProvider.getInstance();
  const response = await AiProvider.promptAi('Answer with exactly the word PONG and nothing else.', 'PROMPT_SOLVE_DEPLOYMENT_ERROR');
  const ok = provider?.getLabel() === 'Google GenAI connector' && response?.success === true && /PONG/i.test(response?.promptResponse || '');
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${testCase.name}: provider=${provider?.getLabel()} model=${response?.model} answer=${JSON.stringify((response?.promptResponse || '').slice(0, 80))}`);
  if (!ok) {
    failures++;
  }
}
process.exit(failures > 0 ? 1 : 0);

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

const mochaGlobals = {
  describe: 'readonly',
  it: 'readonly',
  before: 'readonly',
  after: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  context: 'readonly',
  specify: 'readonly',
};

export default [
  {
    ignores: ['**/*.cjs/'],
  },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['test/**/*.{ts,cjs,js}'],
    languageOptions: {
      globals: mochaGlobals,
    },
    rules: {
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/require-await': 'off',
      header: 'off',
    },
  },
];

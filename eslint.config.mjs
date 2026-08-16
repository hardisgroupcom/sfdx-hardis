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
    // PERF guard: these modules run before every sf hardis command boots.
    // They must never statically import the heavy common/utils barrel or
    // config/index (1000+ transitive modules: langchain, puppeteer, jira...):
    // that would silently revert the fast WebSocket connection to the VS Code
    // extension. Deferred needs must use dynamic import().
    files: [
      'src/common/websocketClient.ts',
      'src/common/utils/envUtils.ts',
      'src/common/utils/i18n.ts',
      'src/config/constants.ts',
      'src/hooks/init/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/utils/index.js', '**/common/utils/index.js'],
              message:
                'Startup-critical module: do not statically import the heavy utils barrel (use a dynamic import() in the code path that needs it).',
            },
            {
              group: ['**/config/index.js'],
              message:
                'Startup-critical module: import from config/constants.js instead of the heavy config/index.js.',
            },
          ],
        },
      ],
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

import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'infra/node_modules/**', 'infra/cdk.out/**', 'target/**', 'core/**', 'broker/**', 'data/**', 'cdk.out/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2025, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-proto': 'error',
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      'no-var': 'error',
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['scripts/a11y.js', 'scripts/e2e.js', 'test/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];

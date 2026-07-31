import eslint from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/release/**',
      '**/.turbo/**',
    ],
  },
  eslint.configs.recommended,
  ...typescriptEslint.configs['flat/recommended'],
  {
    ...reactHooks.configs['recommended-latest'],
    files: [
      'apps/desktop/src/**/*.{ts,tsx}',
      'packages/ui-kit/src/**/*.{ts,tsx}',
    ],
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];

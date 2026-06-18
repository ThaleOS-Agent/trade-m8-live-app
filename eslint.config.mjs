import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Downgrade noisy rules to warn so lint doesn't block CI on pre-existing issues
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'react/react-in-jsx-scope': 'off',
      'react/no-unescaped-entities': 'warn',
      // Disable overly strict rules not suited to this codebase
      '@typescript-eslint/no-require-imports': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      // Async functions called from useEffect are a valid React pattern;
      // the setState inside them runs after an await, not synchronously
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'functions/**'],
  },
];

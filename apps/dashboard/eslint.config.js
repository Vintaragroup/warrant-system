import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'backups/**']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // Node/Server overrides: treat server and config files as Node env, not browser
  {
    files: [
      'server/**/*.js',
      'server/**/*.mjs',
      'vite.config.js',
      'vitest.config.ts',
      'postcss.config.js',
      'tailwind.config.js',
      'eslint.config.js',
      'server/scripts/**/*.js',
      'server/scripts/**/*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      parserOptions: { sourceType: 'module' },
    },
    rules: {
      // Not relevant in Node files
      'react-refresh/only-export-components': 'off',
      // Allow intentionally unused args/vars prefixed with _ and UPPER_CASE constants
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '(^[A-Z_])|(^_)' }],
      // Many server try/catch placeholders are acceptable for now
      'no-empty': 'off',
    },
  },
])

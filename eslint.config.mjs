import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import next from '@next/eslint-plugin-next';
import globals from 'globals';
export default defineConfig([
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'test-results/**',
    'playwright-report/**',
    'next-env.d.ts',
  ]),
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.serviceworker } },
  },
  {
    files: ['src/**/*.tsx', 'src/**/*.ts'],
    plugins: { 'react-hooks': hooks, '@next/next': next },
    rules: {
      ...hooks.configs.recommended.rules,
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      '@next/next/no-img-element': 'off',
    },
  },
]);

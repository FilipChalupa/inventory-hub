import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    // Build output, deps, generated migration metadata, and the raw service
    // worker (plain browser script, not part of the TS build).
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'test-results/**',
      'playwright-report/**',
      'apps/server/src/db/migrations/**',
      'apps/web/public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Non-type-checked lint: fast, no project service wiring needed. We rely
    // on `tsc` (typecheck script) for type-level correctness.
    rules: {
      // The codebase deliberately uses `any` at a few interop boundaries.
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow intentionally-unused args/vars when prefixed with `_`.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    // Server + tooling run under Node.
    files: ['apps/server/**/*.ts', 'packages/**/*.ts', '*.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Web runs in the browser; enforce React hook rules.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Test files also get Node globals (vitest exposes globals via config).
    files: ['**/*.test.{ts,tsx}', '**/test/**', '**/*.spec.ts', 'e2e/**'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // CommonJS config files (postcss/tailwind) use `module.exports`.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
);

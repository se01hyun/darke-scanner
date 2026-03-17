// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // 전역 무시 패턴
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },

  // TypeScript 소스
  {
    files: ['src/**/*.ts'],
    extends: [
      ...tseslint.configs.recommended,
    ],
    rules: {
      // ── TypeScript ────────────────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      // ── 일반 코드 품질 ────────────────────────────────────────────────────
      'no-console': ['warn', { allow: ['warn', 'error', 'group', 'groupEnd'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'no-throw-literal': 'error',
    },
  },

  // debug-logger — console.* 직접 사용이 의도적
  {
    files: ['src/utils/debug-logger.ts'],
    rules: { 'no-console': 'off' },
  },

  // 테스트 파일 — 일부 규칙 완화
  {
    files: ['tests/**/*.ts'],
    extends: [
      ...tseslint.configs.recommended,
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'error',
    },
  },
);

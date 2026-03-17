import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DS_DEBUG__: 'false',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
      thresholds: {
        // 현재 테스트 대상: dom-scanner·rule-engine·network-sniffer·popup·overlay
        // nlp·background 모듈은 미커버 → 전체 기준을 실제 수치 기반으로 설정
        // 테스트 추가 시 단계적으로 상향 조정할 것
        statements: 40,
        branches:   38,
        functions:  38,
        lines:      42,
      },
    },
  },
});

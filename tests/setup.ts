import { vi, beforeEach } from 'vitest';

// ── CSS.escape 폴리필 ─────────────────────────────────────────────────────────
// jsdom은 CSS 전역 객체를 제공하지 않으므로 findLabel() 등에서 사용하는
// CSS.escape를 직접 주입한다.
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).CSS = {
    escape: (value: string): string => {
      const str = String(value);
      return str.replace(/[!"#$%&'()*+,./:<=>?@[\\\]^`{|}~]/g, '\\$&')
                .replace(/^\d/, '\\3$& ')
                .replace(/^-\d/, '-\\3$& ');
    },
  };
}

// ── Chrome Extension API 전역 Mock ───────────────────────────────────────────
// jsdom에는 chrome 전역이 없으므로 최소한의 stub을 미리 정의한다.
// 각 테스트에서 sendMessage 등을 vi.fn()으로 덮어쓸 수 있다.
const chromeMock = {
  runtime: {
    sendMessage: vi.fn(),
    getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    session: { get: vi.fn(), set: vi.fn() },
    local:   { get: vi.fn(), set: vi.fn() },
  },
  tabs: {
    query:       vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    create:      vi.fn().mockResolvedValue(undefined),
  },
};

// @ts-expect-error — chrome 전역은 테스트 환경에서 직접 주입
globalThis.chrome = chromeMock;

// 각 테스트 전에 mock 호출 기록을 초기화한다
beforeEach(() => {
  vi.clearAllMocks();
});

import { describe, it, expect, beforeEach } from 'vitest';
import { NetworkSniffer } from '../../src/background/network-sniffer';
import type { NetworkResponsePayload, ScriptPatternPayload } from '../../src/types';

describe('NetworkSniffer', () => {
  let sniffer: NetworkSniffer;

  beforeEach(() => {
    sniffer = new NetworkSniffer();
  });

  // ── onNetworkResponse ──────────────────────────────────────────────────────

  describe('onNetworkResponse — 결제 단계 필터링', () => {
    it('결제 단계 URL이 아니면 null 반환', () => {
      const payload: NetworkResponsePayload = {
        url: 'https://shop.example.com/product/123',
        data: { price: 10000 },
      };
      expect(sniffer.onNetworkResponse(payload, 1)).toBeNull();
    });

    it('cart URL → 첫 번째 가격 기록 후 null 반환', () => {
      const payload: NetworkResponsePayload = {
        url: 'https://shop.example.com/cart',
        data: { price: 10000 },
      };
      expect(sniffer.onNetworkResponse(payload, 1)).toBeNull();
    });

    it('한국어 URL 패턴(장바구니) 도 결제 단계로 인식', () => {
      const payload: NetworkResponsePayload = {
        url: 'https://shop.example.com/장바구니',
        data: { price: 10000 },
      };
      // 첫 기록 → null
      expect(sniffer.onNetworkResponse(payload, 1)).toBeNull();
    });
  });

  describe('onNetworkResponse — 순차공개 가격 탐지 (기준 2)', () => {
    it('5% 미만 가격 인상 → null', () => {
      const tab = 2;
      sniffer.onNetworkResponse({ url: 'https://shop.com/cart', data: { price: 10000 } }, tab);
      // 3% 인상
      const result = sniffer.onNetworkResponse({ url: 'https://shop.com/checkout', data: { price: 10300 } }, tab);
      expect(result).toBeNull();
    });

    it('정확히 5% 인상 → null (임계값 초과가 아님)', () => {
      const tab = 3;
      sniffer.onNetworkResponse({ url: 'https://shop.com/cart', data: { price: 10000 } }, tab);
      const result = sniffer.onNetworkResponse({ url: 'https://shop.com/checkout', data: { price: 10500 } }, tab);
      expect(result).toBeNull();
    });

    it('5% 초과 인상 → 기준 2 탐지', () => {
      const tab = 4;
      sniffer.onNetworkResponse({ url: 'https://shop.com/cart', data: { price: 10000 } }, tab);
      const result = sniffer.onNetworkResponse({ url: 'https://shop.com/payment', data: { price: 11000 } }, tab);
      expect(result).not.toBeNull();
      expect(result!.guideline).toBe(2);
      expect(result!.guidelineName).toBe('순차공개 가격책정');
      expect(result!.module).toBe('network');
      expect(result!.confidence).toBe('confirmed');
    });

    it('10% 인상 → severity medium', () => {
      const tab = 5;
      sniffer.onNetworkResponse({ url: 'https://shop.com/cart', data: { price: 10000 } }, tab);
      const result = sniffer.onNetworkResponse({ url: 'https://shop.com/payment', data: { price: 11000 } }, tab);
      expect(result!.severity).toBe('medium');
    });

    it('20% 초과 인상 → severity high', () => {
      const tab = 6;
      sniffer.onNetworkResponse({ url: 'https://shop.com/cart', data: { price: 10000 } }, tab);
      const result = sniffer.onNetworkResponse({ url: 'https://shop.com/payment', data: { price: 13000 } }, tab);
      expect(result!.severity).toBe('high');
    });

    it('가격 하락은 탐지하지 않음', () => {
      const tab = 7;
      sniffer.onNetworkResponse({ url: 'https://shop.com/cart', data: { price: 10000 } }, tab);
      const result = sniffer.onNetworkResponse({ url: 'https://shop.com/payment', data: { price: 9000 } }, tab);
      expect(result).toBeNull();
    });

    it('₩ 기호 포함 문자열 가격 파싱 후 탐지', () => {
      const tab = 8;
      sniffer.onNetworkResponse({ url: 'https://shop.com/cart',    data: { price: '₩10,000' } }, tab);
      const result = sniffer.onNetworkResponse({ url: 'https://shop.com/payment', data: { price: '₩12,000' } }, tab);
      expect(result).not.toBeNull();
      expect(result!.guideline).toBe(2);
    });

    it('탐지 결과에 가격 변동 정보가 evidence.detail에 포함됨', () => {
      const tab = 9;
      sniffer.onNetworkResponse({ url: 'https://shop.com/cart', data: { price: 10000 } }, tab);
      const result = sniffer.onNetworkResponse({ url: 'https://shop.com/payment', data: { price: 12000 } }, tab);
      expect(result!.evidence.detail['firstPrice']).toBe(10000);
      expect(result!.evidence.detail['currentPrice']).toBe(12000);
    });
  });

  describe('onNetworkResponse — 서버 키 등록', () => {
    it('viewer_count 포함 응답 → 서버 키 등록 (반환값 null)', () => {
      const payload: NetworkResponsePayload = {
        url: 'https://shop.example.com/api/product',
        data: { viewer_count: 15 },
      };
      expect(sniffer.onNetworkResponse(payload, 1)).toBeNull();
      // 이후 flagUnconfirmedDOMDetection은 null 반환해야 함
      expect(sniffer.flagUnconfirmedDOMDetection(1)).toBeNull();
    });

    it('stock 키 포함 응답 → 서버 키 등록', () => {
      const payload: NetworkResponsePayload = {
        url: 'https://shop.example.com/api/stock',
        data: { stock_count: 3 },
      };
      sniffer.onNetworkResponse(payload, 2);
      expect(sniffer.flagUnconfirmedDOMDetection(2)).toBeNull();
    });
  });

  // ── onScriptPattern ────────────────────────────────────────────────────────

  describe('onScriptPattern', () => {
    it('timer_reset → 기준 17 탐지 (confirmed, high)', () => {
      const payload: ScriptPatternPayload = {
        src: 'inline',
        snippet: 'if (timer <= 0) timer = 300;',
        patternType: 'timer_reset',
      };
      const result = sniffer.onScriptPattern(payload);
      expect(result.guideline).toBe(17);
      expect(result.guidelineName).toBe('시간제한 알림');
      expect(result.severity).toBe('high');
      expect(result.confidence).toBe('confirmed');
      expect(result.module).toBe('network');
    });

    it('random_counter → 기준 19 탐지 (confirmed, high)', () => {
      const payload: ScriptPatternPayload = {
        src: 'https://shop.example.com/script.js',
        snippet: 'viewerCount = Math.floor(Math.random() * 50) + 10;',
        patternType: 'random_counter',
      };
      const result = sniffer.onScriptPattern(payload);
      expect(result.guideline).toBe(19);
      expect(result.guidelineName).toBe('다른 소비자의 활동 알림');
      expect(result.severity).toBe('high');
      expect(result.confidence).toBe('confirmed');
    });

    it('evidence.raw에 snippet이 포함됨', () => {
      const snippet = 'if (timer <= 0) timer = 300;';
      const result = sniffer.onScriptPattern({ src: 'inline', snippet, patternType: 'timer_reset' });
      expect(result.evidence.raw).toBe(snippet);
    });

    it('결과에 유효한 id가 생성됨', () => {
      const result = sniffer.onScriptPattern({ src: 'inline', snippet: '...', patternType: 'timer_reset' });
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  // ── flagUnconfirmedDOMDetection ────────────────────────────────────────────

  describe('flagUnconfirmedDOMDetection', () => {
    it('서버 응답이 없으면 suspicious 탐지 반환', () => {
      const result = sniffer.flagUnconfirmedDOMDetection(99);
      expect(result).not.toBeNull();
      expect(result!.guideline).toBe(19);
      expect(result!.confidence).toBe('suspicious');
      expect(result!.severity).toBe('medium');
      expect(result!.module).toBe('network');
    });

    it('서버 응답 확인 후 → null 반환', () => {
      const tab = 10;
      sniffer.onNetworkResponse({ url: 'https://shop.com/api', data: { viewer_count: 5 } }, tab);
      expect(sniffer.flagUnconfirmedDOMDetection(tab)).toBeNull();
    });

    it('다른 탭의 서버 응답은 영향 없음', () => {
      sniffer.onNetworkResponse({ url: 'https://shop.com/api', data: { viewer_count: 5 } }, 1);
      // 탭 2는 별도로 판단
      expect(sniffer.flagUnconfirmedDOMDetection(2)).not.toBeNull();
    });
  });

  // ── clearTab ───────────────────────────────────────────────────────────────

  describe('clearTab', () => {
    it('초기화 후 가격 추적 재시작 (첫 기록 → null)', () => {
      const tab = 20;
      sniffer.onNetworkResponse({ url: 'https://shop.com/cart', data: { price: 10000 } }, tab);
      sniffer.clearTab(tab);
      // 초기화 후 같은 탭에 동일 가격 → 첫 기록이므로 null
      const result = sniffer.onNetworkResponse({ url: 'https://shop.com/cart', data: { price: 10000 } }, tab);
      expect(result).toBeNull();
    });

    it('초기화 후 flagUnconfirmedDOMDetection → suspicious 반환', () => {
      const tab = 21;
      sniffer.onNetworkResponse({ url: 'https://shop.com/api', data: { viewer_count: 5 } }, tab);
      sniffer.clearTab(tab);
      expect(sniffer.flagUnconfirmedDOMDetection(tab)).not.toBeNull();
    });

    it('다른 탭은 초기화되지 않음', () => {
      const tabA = 30;
      const tabB = 31;
      sniffer.onNetworkResponse({ url: 'https://shop.com/api', data: { viewer_count: 5 } }, tabA);
      sniffer.onNetworkResponse({ url: 'https://shop.com/api', data: { viewer_count: 5 } }, tabB);
      sniffer.clearTab(tabA);
      // tabA는 초기화됨
      expect(sniffer.flagUnconfirmedDOMDetection(tabA)).not.toBeNull();
      // tabB는 유지됨
      expect(sniffer.flagUnconfirmedDOMDetection(tabB)).toBeNull();
    });
  });
});

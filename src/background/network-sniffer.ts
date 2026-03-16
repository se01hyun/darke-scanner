/**
 * Network Sniffer — Background Service Worker
 * content script로부터 수신한 네트워크 응답과 JS 패턴을 분석하여 다음을 탐지한다:
 *   - 기준 19번: 다른 소비자의 활동 알림 (서버 데이터 미확인)
 *   - 기준 17번: 카운트다운 타이머 조작 로직 (클라이언트 난수)
 *   - 기준  2번: 순차공개 가격책정 (Drip Pricing) — 탭 내 가격 변동 추적
 */

import type {
  DarkPatternDetection,
  NetworkResponsePayload,
  ScriptPatternPayload,
} from '../types';
import { generateId } from '../utils/id';

// 서버 응답에서 실시간 수치를 나타내는 키 패턴
const VIEWER_KEY_PATTERNS = ['viewer', 'count', 'watching', 'realtime', 'real_time'];
const STOCK_KEY_PATTERNS  = ['stock', 'remain', 'inventory', 'quantity'];

// 가격 관련 키 패턴 (기준 2: 순차공개 가격)
const PRICE_KEY_PATTERNS = [
  'price', 'amount', 'total', 'pay', 'fee', 'cost', 'charge',
  'saleprice', 'finalprice', 'payamount', 'totalprice',
];
// 결제 단계를 나타내는 URL 패턴 (장바구니·결제·주문 단계에서만 비교)
const CHECKOUT_URL_PATTERNS = [
  'cart', 'basket', 'checkout', 'payment', 'order', 'purchase',
  '장바구니', '결제', '주문',
];
// 가격 변동 탐지 임계값: 5% 이상 인상이면 의심
const DRIP_PRICE_THRESHOLD = 0.05;

interface TabPriceRecord {
  firstPrice: number;
  firstUrl: string;
  timestamp: number;
}

function matchesAny(key: string, patterns: string[]): boolean {
  return patterns.some((p) => key.toLowerCase().includes(p));
}

/** JSON 응답 객체에서 가격 관련 숫자 값을 추출한다. */
function extractPrice(data: Record<string, unknown>): number | null {
  for (const key of Object.keys(data)) {
    if (!matchesAny(key, PRICE_KEY_PATTERNS)) continue;
    const val = data[key];
    if (typeof val === 'number' && val > 0) return val;
    if (typeof val === 'string') {
      // "₩12,900" 형식 처리
      const parsed = parseFloat(val.replace(/[^0-9.]/g, ''));
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

export class NetworkSniffer {
  // tabId → 확인된 서버 응답 키 Set (오탐 방지용 화이트리스트)
  private confirmedServerKeys = new Map<number, Set<string>>();
  // tabId → 처음 확인된 가격 기록 (기준 2: 순차공개 가격 추적)
  private tabPrices = new Map<number, TabPriceRecord>();

  onNetworkResponse(payload: NetworkResponsePayload, tabId: number): DarkPatternDetection | null {
    const keys = Object.keys(payload.data);
    const viewerKeys = keys.filter((k) => matchesAny(k, VIEWER_KEY_PATTERNS));
    const stockKeys  = keys.filter((k) => matchesAny(k, STOCK_KEY_PATTERNS));

    if (viewerKeys.length > 0 || stockKeys.length > 0) {
      // 실제 서버 통신이 확인된 키를 등록 → DOM Scanner suspicious 탐지 해소에 활용
      const confirmed = this.confirmedServerKeys.get(tabId) ?? new Set<string>();
      [...viewerKeys, ...stockKeys].forEach((k) => confirmed.add(k));
      this.confirmedServerKeys.set(tabId, confirmed);
    }

    // ── 기준 2: 순차공개 가격 추적 ──────────────────────────────────────────
    const dripDetection = this.trackDripPricing(payload, tabId);
    return dripDetection;
  }

  /**
   * 탭 세션 내 가격 변동을 추적하여 순차공개 가격(Drip Pricing)을 탐지한다.
   * - 결제 단계 URL에서 처음 확인된 가격 대비 5% 이상 증가하면 탐지
   */
  private trackDripPricing(
    payload: NetworkResponsePayload,
    tabId: number,
  ): DarkPatternDetection | null {
    // 결제 단계 URL이 아니면 추적하지 않음
    const isCheckout = CHECKOUT_URL_PATTERNS.some((p) =>
      payload.url.toLowerCase().includes(p),
    );
    if (!isCheckout) return null;

    const currentPrice = extractPrice(payload.data);
    if (currentPrice === null) return null;

    const existing = this.tabPrices.get(tabId);

    if (!existing) {
      // 첫 번째 가격 기록
      this.tabPrices.set(tabId, {
        firstPrice: currentPrice,
        firstUrl:   payload.url,
        timestamp:  Date.now(),
      });
      return null;
    }

    const increase = (currentPrice - existing.firstPrice) / existing.firstPrice;
    if (increase <= DRIP_PRICE_THRESHOLD) return null;

    // 가격이 임계값 이상 상승 → 순차공개 가격 탐지
    return {
      id: generateId(),
      guideline: 2,
      guidelineName: '순차공개 가격책정',
      severity: increase > 0.20 ? 'high' : 'medium',
      confidence: 'confirmed',
      module: 'network',
      description: `결제 진행 중 가격이 ${(increase * 100).toFixed(1)}% 증가했습니다. `
        + `(${existing.firstPrice.toLocaleString()}원 → ${currentPrice.toLocaleString()}원)`,
      evidence: {
        type: 'network_analysis',
        raw: JSON.stringify({ firstPrice: existing.firstPrice, currentPrice }),
        detail: {
          firstPrice:  existing.firstPrice,
          firstUrl:    existing.firstUrl,
          currentPrice,
          currentUrl:  payload.url,
          increaseRate: parseFloat((increase * 100).toFixed(2)),
        },
      },
    };
  }

  onScriptPattern(payload: ScriptPatternPayload): DarkPatternDetection {
    const isTimerReset = payload.patternType === 'timer_reset';

    return {
      id: generateId(),
      guideline: isTimerReset ? 17 : 19,
      guidelineName: isTimerReset ? '시간제한 알림' : '다른 소비자의 활동 알림',
      severity: 'high',
      confidence: 'confirmed',
      module: 'network',
      description: isTimerReset
        ? '카운트다운 타이머가 0이 되면 자동으로 초기화됩니다. 실제 마감이 아닌 반복 루프입니다.'
        : '서버 데이터 없이 클라이언트에서 난수로 조회 수·재고 수를 조작하고 있습니다.',
      evidence: {
        type: 'script_pattern',
        raw: payload.snippet,
        detail: {
          patternType: payload.patternType,
          src: payload.src,
        },
      },
    };
  }

  /**
   * 특정 탭에 서버 응답이 없는 상태에서 DOM 탐지가 있으면
   * "서버 데이터 미확인" 플래그를 추가 탐지로 생성한다.
   */
  flagUnconfirmedDOMDetection(tabId: number): DarkPatternDetection | null {
    const confirmed = this.confirmedServerKeys.get(tabId);
    if (confirmed && confirmed.size > 0) return null; // 서버 응답 있음 → 문제 없음

    return {
      id: generateId(),
      guideline: 19,
      guidelineName: '다른 소비자의 활동 알림',
      severity: 'medium',
      confidence: 'suspicious',
      module: 'network',
      description: '실시간 조회 수나 재고 수가 표시되지만, 서버에서 받은 데이터가 확인되지 않습니다.',
      evidence: {
        type: 'network_analysis',
        raw: '',
        detail: { reason: 'no_server_response_for_tab' },
      },
    };
  }

  clearTab(tabId: number): void {
    this.confirmedServerKeys.delete(tabId);
    this.tabPrices.delete(tabId);
  }
}

/**
 * Network Sniffer — Background Service Worker
 * content script로부터 수신한 네트워크 응답과 JS 패턴을 분석하여
 * 공정위 기준 3번(Social Proof), 1·2번 조작 로직(클라이언트 난수 조작)을 탐지한다.
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

function matchesAny(key: string, patterns: string[]): boolean {
  return patterns.some((p) => key.toLowerCase().includes(p));
}

export class NetworkSniffer {
  // tabId → 확인된 서버 응답 키 Set (오탐 방지용 화이트리스트)
  private confirmedServerKeys = new Map<number, Set<string>>();

  onNetworkResponse(payload: NetworkResponsePayload, tabId: number): DarkPatternDetection | null {
    const keys = Object.keys(payload.data);
    const viewerKeys = keys.filter((k) => matchesAny(k, VIEWER_KEY_PATTERNS));
    const stockKeys  = keys.filter((k) => matchesAny(k, STOCK_KEY_PATTERNS));

    if (viewerKeys.length === 0 && stockKeys.length === 0) return null;

    // 실제 서버 통신이 확인된 키를 등록 → DOM Scanner의 suspicious 탐지를 해소하는 데 활용
    const confirmed = this.confirmedServerKeys.get(tabId) ?? new Set<string>();
    [...viewerKeys, ...stockKeys].forEach((k) => confirmed.add(k));
    this.confirmedServerKeys.set(tabId, confirmed);

    // 서버 응답이 존재한다는 것 자체는 다크 패턴이 아님.
    // 단, 응답값과 화면 표시값의 불일치는 Phase 3에서 교차 검증 예정.
    return null;
  }

  onScriptPattern(payload: ScriptPatternPayload): DarkPatternDetection {
    const isTimerReset = payload.patternType === 'timer_reset';

    return {
      id: generateId(),
      guideline: isTimerReset ? 1 : 3,
      guidelineName: isTimerReset ? '잘못된 긴급성' : '사회적 증거 조작',
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
      guideline: 3,
      guidelineName: '사회적 증거 조작',
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
  }
}

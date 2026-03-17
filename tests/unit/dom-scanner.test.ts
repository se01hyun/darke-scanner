/**
 * DOM Scanner 단위 테스트
 *
 * jsdom 환경에서 DOMScanner를 실행하고 chrome.runtime.sendMessage 호출을 캡처해
 * 탐지 결과를 검증한다.
 *
 * 주요 제약:
 *  - jsdom의 getBoundingClientRect()는 기본적으로 0x0 반환 → 가시성 검사가 있는
 *    탐지 경로는 beforeEach에서 prototype mock으로 비-제로 값을 주입한다.
 *  - "숨겨진 요소는 탐지 제외" 케이스만 특정 인스턴스를 0x0으로 덮어쓴다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOMScanner } from '../../src/content/dom-scanner';
import type { DarkPatternDetection } from '../../src/types';

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

function getSentDetections(): DarkPatternDetection[] {
  const mock = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
  if (mock.mock.calls.length === 0) return [];
  const lastMsg = mock.mock.calls.at(-1)?.[0] as
    | { type: string; payload: DarkPatternDetection[] }
    | undefined;
  return lastMsg?.payload ?? [];
}

function runScan(html: string): DarkPatternDetection[] {
  document.body.innerHTML = html;
  new DOMScanner().init();
  return getSentDetections();
}

// ── 공통 Setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';

  // 가시성 검사(getBoundingClientRect)를 통과시키기 위해 기본값을 비-제로로 설정한다.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 100, height: 20,
    top: 10, left: 10, right: 110, bottom: 30,
    x: 10, y: 10,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── makeTextWalker: SCRIPT / STYLE 내부 텍스트 제외 ──────────────────────────

describe('makeTextWalker — 비가시 태그 필터링', () => {
  it('script 태그 내부 FOMO 키워드는 탐지하지 않음', () => {
    // 스크립트 내 텍스트가 탐지되면 안 됨 (Next.js 번들 등 오탐 방지)
    const dets = runScan('<script>var msg = "마감 임박 Flash Sale";</script>');
    expect(dets.filter(d => d.guideline === 18)).toHaveLength(0);
  });

  it('style 태그 내부 텍스트는 탐지하지 않음', () => {
    const dets = runScan('<style>.timer { content: "마감 임박"; }</style>');
    expect(dets.filter(d => d.guideline === 18)).toHaveLength(0);
  });

  it('noscript 태그 내부 텍스트는 탐지하지 않음', () => {
    const dets = runScan('<noscript>한정 수량 — JavaScript를 켜 주세요</noscript>');
    expect(dets.filter(d => d.guideline === 18)).toHaveLength(0);
  });

  it('template 태그 내부 텍스트는 탐지하지 않음', () => {
    const dets = runScan('<template><p>마감 임박 남은 수량 1개</p></template>');
    expect(dets.filter(d => d.guideline === 18)).toHaveLength(0);
  });

  it('일반 p 태그의 FOMO 텍스트는 탐지됨', () => {
    const dets = runScan('<p>마감 임박</p>');
    expect(dets.some(d => d.guideline === 18)).toBe(true);
  });
});

// ── 기준 17: 시간제한 알림 (카운트다운) ──────────────────────────────────────

describe('detectCountdown — 기준 17', () => {
  it('[data-countdown] 속성 요소 탐지', () => {
    const dets = runScan('<div data-countdown="1800">30:00</div>');
    expect(dets.some(d => d.guideline === 17)).toBe(true);
  });

  it('[class*=countdown] 요소 탐지', () => {
    const dets = runScan('<span class="countdown-timer">05:00</span>');
    expect(dets.some(d => d.guideline === 17)).toBe(true);
  });

  it('[class*=timer] 요소 탐지', () => {
    const dets = runScan('<div class="flash-timer">01:30:00</div>');
    expect(dets.some(d => d.guideline === 17)).toBe(true);
  });

  it('data-end-time 속성 보유 → server_driven → severity low (서버 연동 추정, 낮은 위험도)', () => {
    const dets = runScan(
      '<div data-countdown data-end-time="2026-03-20T23:59:59">남은 시간: 02:00:00</div>',
    );
    const cd = dets.find(d => d.guideline === 17);
    expect(cd).toBeDefined();
    expect(cd!.severity).toBe('low');
    expect(cd!.confidence).toBe('suspicious');
  });

  it('탐지 모듈은 dom', () => {
    const dets = runScan('<div data-countdown>30:00</div>');
    const cd = dets.find(d => d.guideline === 17);
    expect(cd!.module).toBe('dom');
  });
});

// ── 기준 18: 낮은 재고 알림 ──────────────────────────────────────────────────

describe('detectStockWarning — 기준 18', () => {
  it('[class*=stock-warn] + FOMO 키워드 → confirmed', () => {
    const dets = runScan('<div class="stock-warn">마감 임박! 3개 남음</div>');
    const sw = dets.find(d => d.guideline === 18);
    expect(sw).toBeDefined();
    expect(sw!.confidence).toBe('confirmed');
  });

  it('[data-stock] + 숫자 → suspicious (키워드 없고 숫자만)', () => {
    const dets = runScan('<div data-stock>남은 수량: 2개</div>');
    expect(dets.some(d => d.guideline === 18)).toBe(true);
  });

  it('텍스트도 숫자도 없는 stock 요소는 스킵', () => {
    const dets = runScan('<div class="stock-warn"></div>');
    expect(dets.filter(d => d.guideline === 18)).toHaveLength(0);
  });

  it('텍스트 노드 키워드 탐지 (선택자 미매칭)', () => {
    // 클래스 없이 일반 p 태그에 FOMO 키워드
    const dets = runScan('<p>한정 수량으로 빨리 구매하세요!</p>');
    expect(dets.some(d => d.guideline === 18)).toBe(true);
  });

  it('탐지 설명에 FOMO 키워드가 포함됨', () => {
    const dets = runScan('<div class="stock-warn">마감 임박! 5개 남음</div>');
    const sw = dets.find(d => d.guideline === 18);
    expect(sw!.description).toContain('마감 임박');
  });
});

// ── 기준 3·10: 특정 옵션의 사전선택 ──────────────────────────────────────────

describe('detectPreselectedOptions — 기준 3·10', () => {
  it('HTML checked 체크박스 → 탐지', () => {
    const dets = runScan(
      '<input type="checkbox" checked id="extra-ins">' +
      '<label for="extra-ins">여행자 보험 추가 (월 9,900원)</label>',
    );
    expect(dets.some(d => d.guideline === 10 || d.guideline === 3)).toBe(true);
  });

  it('checked 라디오 버튼 → 탐지', () => {
    const dets = runScan(
      '<input type="radio" name="plan" value="premium" checked>' +
      '<label>프리미엄 플랜 (월 19,900원)</label>',
    );
    expect(dets.some(d => d.guideline === 10 || d.guideline === 3)).toBe(true);
  });

  it('숨겨진 체크박스(width=0, height=0)는 탐지하지 않음', () => {
    document.body.innerHTML =
      '<input type="checkbox" checked id="hidden-cb"><label for="hidden-cb">숨김</label>';
    // 해당 요소만 0x0 반환하도록 인스턴스 레벨 오버라이드
    const input = document.querySelector<HTMLInputElement>('input')!;
    input.getBoundingClientRect = () => ({
      width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0,
      toJSON: () => ({}),
    });
    new DOMScanner().init();
    const dets = getSentDetections();
    expect(dets.filter(d => d.guideline === 10 || d.guideline === 3)).toHaveLength(0);
  });

  it('required 체크박스는 탐지하지 않음 (필수 동의 항목 제외)', () => {
    const dets = runScan(
      '<input type="checkbox" checked required id="tos">' +
      '<label for="tos">이용약관 동의 (필수)</label>',
    );
    expect(dets.filter(d => d.guideline === 10 || d.guideline === 3)).toHaveLength(0);
  });
});

// ── 기준 19: 다른 소비자의 활동 알림 (DOM) ───────────────────────────────────

describe('detectSocialProofDOM — 기준 19', () => {
  it('"현재 N명이 보고 있습니다" 패턴 탐지', () => {
    const dets = runScan('<p>현재 24명이 보고 있습니다</p>');
    expect(dets.some(d => d.guideline === 19 && d.module === 'dom')).toBe(true);
  });

  it('"방금 N명이 구매" 패턴 탐지', () => {
    const dets = runScan('<span>방금 5명이 구매했습니다</span>');
    expect(dets.some(d => d.guideline === 19 && d.module === 'dom')).toBe(true);
  });

  it('"명" 없는 일반 후기 문장은 탐지하지 않음', () => {
    const dets = runScan('<p>방금 구매했는데 너무 좋아요</p>');
    expect(dets.filter(d => d.guideline === 19 && d.module === 'dom')).toHaveLength(0);
  });

  it('200자 초과 텍스트 노드는 스킵 (컨테이너 오탐 방지)', () => {
    // 200자 이상의 긴 텍스트에 패턴이 포함되어도 탐지하지 않음
    const longText = '현재 24명이 보고 있습니다 '.padEnd(250, '상세 설명 텍스트 ');
    const dets = runScan(`<p>${longText}</p>`);
    expect(dets.filter(d => d.guideline === 19 && d.module === 'dom')).toHaveLength(0);
  });

  it('탐지 confidence는 suspicious', () => {
    const dets = runScan('<p>지금 12명이 조회 중입니다</p>');
    const det = dets.find(d => d.guideline === 19 && d.module === 'dom');
    expect(det?.confidence).toBe('suspicious');
  });

  it('숨겨진 요소(width=0, height=0)는 탐지하지 않음', () => {
    document.body.innerHTML = '<p id="sp">현재 30명이 보고 있습니다</p>';
    const p = document.querySelector<HTMLElement>('p')!;
    p.getBoundingClientRect = () => ({
      width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0,
      toJSON: () => ({}),
    });
    new DOMScanner().init();
    const dets = getSentDetections();
    expect(dets.filter(d => d.guideline === 19 && d.module === 'dom')).toHaveLength(0);
  });
});

// ── 탐지 결과 공통 구조 검증 ──────────────────────────────────────────────────

describe('탐지 결과 DarkPatternDetection 구조', () => {
  it('모든 필드가 올바른 타입으로 존재함', () => {
    const dets = runScan('<div class="stock-warn">한정 수량! 1개 남음</div>');
    expect(dets.length).toBeGreaterThan(0);
    for (const det of dets) {
      expect(typeof det.id).toBe('string');
      expect(det.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof det.guideline).toBe('number');
      expect(det.guideline).toBeGreaterThanOrEqual(1);
      expect(det.guideline).toBeLessThanOrEqual(19);
      expect(['low', 'medium', 'high']).toContain(det.severity);
      expect(['confirmed', 'suspicious']).toContain(det.confidence);
      expect(['dom', 'nlp', 'network']).toContain(det.module);
      expect(typeof det.description).toBe('string');
      expect(det.evidence).toBeDefined();
      expect(typeof det.evidence.raw).toBe('string');
    }
  });

  it('sendMessage 타입이 DOM_DETECTIONS', () => {
    document.body.innerHTML = '<div class="stock-warn">마감 임박! 2개 남음</div>';
    new DOMScanner().init();
    const mock = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    const msg = mock.mock.calls.at(-1)?.[0] as { type: string; payload: unknown };
    expect(msg.type).toBe('DOM_DETECTIONS');
    expect(Array.isArray(msg.payload)).toBe(true);
  });

  it('탐지 없으면 빈 배열 전송', () => {
    // 다크 패턴 없는 깨끗한 페이지
    const dets = runScan('<h1>상품 이름</h1><p>일반적인 상품 설명입니다.</p>');
    expect(dets).toHaveLength(0);
  });
});

// ── 기준 7: 위장광고 ─────────────────────────────────────────────────────────

describe('detectDisguisedAds — 기준 7', () => {
  it('[data-ad] 요소 + 광고 고지 없음 → confirmed 탐지', () => {
    const dets = runScan('<div data-ad><img src="banner.jpg"><p>지금 구매하세요</p></div>');
    const det = dets.find(d => d.guideline === 7);
    expect(det).toBeDefined();
    expect(det!.confidence).toBe('confirmed');
    expect(det!.module).toBe('dom');
  });

  it('[data-adunit] 요소도 탐지', () => {
    const dets = runScan('<div data-adunit="slot-1">특가 상품</div>');
    expect(dets.some(d => d.guideline === 7)).toBe(true);
  });

  it('인접 형제에 "광고" 텍스트가 있으면 정상 고지 → 스킵', () => {
    // 인접 형제의 직계 텍스트에 "광고" 포함 → 정상 표시로 판단
    const dets = runScan(
      '<div>' +
      '  <span>광고</span>' +
      '  <div data-ad>배너 내용</div>' +
      '</div>',
    );
    expect(dets.filter(d => d.guideline === 7)).toHaveLength(0);
  });

  it('title 속성에 "광고" 레이블 있으면 스킵', () => {
    const dets = runScan('<div data-ad title="광고">배너 내용</div>');
    expect(dets.filter(d => d.guideline === 7)).toHaveLength(0);
  });

  it('숨겨진 광고 요소(0x0)는 스킵', () => {
    document.body.innerHTML = '<div data-ad id="ad-el">배너</div>';
    const el = document.querySelector<HTMLElement>('[data-ad]')!;
    el.getBoundingClientRect = () => ({
      width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0,
      toJSON: () => ({}),
    });
    new DOMScanner().init();
    expect(getSentDetections().filter(d => d.guideline === 7)).toHaveLength(0);
  });
});

// ── 기준 4: 거짓할인 ─────────────────────────────────────────────────────────

describe('detectFalseDiscount — 기준 4', () => {
  it('할인율 표시 + 원가 없음 → suspicious 탐지', () => {
    // <del> 없이 할인율만 표시
    const dets = runScan('<p>50% 할인 지금 구매하세요!</p>');
    const det = dets.find(d => d.guideline === 4);
    expect(det).toBeDefined();
    expect(det!.confidence).toBe('suspicious');
    expect(det!.module).toBe('dom');
  });

  it('50% 이상 할인 → severity high', () => {
    const dets = runScan('<p>70% 할인 특가</p>');
    const det = dets.find(d => d.guideline === 4);
    expect(det!.severity).toBe('high');
  });

  it('49% 할인 → severity medium', () => {
    const dets = runScan('<p>30% 할인 이벤트</p>');
    const det = dets.find(d => d.guideline === 4);
    expect(det!.severity).toBe('medium');
  });

  it('[class*=discount-rate] 선택자 기반 탐지', () => {
    const dets = runScan('<span class="discount-rate">30% 할인</span>');
    expect(dets.some(d => d.guideline === 4)).toBe(true);
  });

  it('원가(<del>) 있으면 정상 할인으로 스킵', () => {
    const dets = runScan(
      '<div class="product-price">' +
      '  <del>50,000원</del>' +
      '  <span>50% 할인</span>' +
      '</div>',
    );
    expect(dets.filter(d => d.guideline === 4)).toHaveLength(0);
  });

  it('SALE 영문 패턴도 탐지', () => {
    const dets = runScan('<p>30% SALE</p>');
    expect(dets.some(d => d.guideline === 4)).toBe(true);
  });
});

// ── 기준 12: 숨겨진 정보 ─────────────────────────────────────────────────────

describe('detectHiddenInformation — 기준 12', () => {
  it('자동갱신 키워드 + 작은 폰트(8px) → 탐지', () => {
    const dets = runScan('<p><span style="font-size:8px">자동갱신 조건 적용</span></p>');
    const det = dets.find(d => d.guideline === 12);
    expect(det).toBeDefined();
    expect(det!.confidence).toBe('suspicious');
  });

  it('8px 이하 → severity high', () => {
    const dets = runScan('<span style="font-size:7px">환불 불가 조건 적용</span>');
    const det = dets.find(d => d.guideline === 12);
    expect(det!.severity).toBe('high');
  });

  it('9px ~ 11px → severity medium', () => {
    const dets = runScan('<span style="font-size:10px">수수료 별도 청구</span>');
    const det = dets.find(d => d.guideline === 12);
    expect(det!.severity).toBe('medium');
  });

  it('12px 이상 폰트는 탐지하지 않음', () => {
    const dets = runScan('<span style="font-size:16px">자동갱신 조건 안내</span>');
    expect(dets.filter(d => d.guideline === 12)).toHaveLength(0);
  });

  it('위약금 키워드도 탐지', () => {
    const dets = runScan('<small style="font-size:9px">위약금 발생 시 전액 청구됩니다</small>');
    expect(dets.some(d => d.guideline === 12)).toBe(true);
  });
});

// ── 기준 11: 취소·탈퇴 방해 ──────────────────────────────────────────────────

describe('detectHardToCancel — 기준 11', () => {
  it('display:none 해지 링크 → confirmed 탐지', () => {
    const dets = runScan('<a href="#" style="display:none">해지하기</a>');
    const det = dets.find(d => d.guideline === 11);
    expect(det).toBeDefined();
    expect(det!.confidence).toBe('confirmed');
    expect(det!.module).toBe('dom');
  });

  it('visibility:hidden 탈퇴 버튼 → confirmed 탐지', () => {
    const dets = runScan('<button style="visibility:hidden">탈퇴</button>');
    expect(dets.some(d => d.guideline === 11)).toBe(true);
  });

  it('opacity:0.3 구독취소 버튼 → suspicious 탐지', () => {
    const dets = runScan('<button style="opacity:0.3">구독취소</button>');
    const det = dets.find(d => d.guideline === 11);
    expect(det).toBeDefined();
    expect(det!.confidence).toBe('suspicious');
  });

  it('신호 2개 이상 → severity high', () => {
    // display:none + opacity 모두 신호로 잡히지만 display:none 하나면 1신호
    // → 두 번째 신호는 opacity로 추가
    const dets = runScan('<a style="display:none;opacity:0.2">구독 취소</a>');
    // display:none 신호 1개 + opacity 신호 1개 = 2개 → high
    const det = dets.find(d => d.guideline === 11);
    expect(det!.severity).toBe('high');
  });

  it('일반 본문 "해지" 텍스트(비액션 요소)는 탐지하지 않음', () => {
    const dets = runScan('<p>해지 방법을 안내해 드립니다.</p>');
    expect(dets.filter(d => d.guideline === 11)).toHaveLength(0);
  });
});

// ── 기준 13: 가격비교 방해 ───────────────────────────────────────────────────

describe('detectComparisonPrevention — 기준 13', () => {
  it('product 컨텍스트 내 "가격문의" → 탐지', () => {
    const dets = runScan(
      '<div class="product-list"><p>가격문의</p></div>',
    );
    const det = dets.find(d => d.guideline === 13);
    expect(det).toBeDefined();
    expect(det!.confidence).toBe('suspicious');
    expect(det!.module).toBe('dom');
  });

  it('"별도문의" 패턴도 탐지', () => {
    const dets = runScan('<div class="goods-card"><span>별도문의</span></div>');
    expect(dets.some(d => d.guideline === 13)).toBe(true);
  });

  it('상품 컨텍스트 없이 단독 노출은 스킵', () => {
    // 네비게이션이나 본문 등 상품 컨텍스트 밖에서는 오탐 방지
    const dets = runScan('<nav><p>가격문의</p></nav>');
    expect(dets.filter(d => d.guideline === 13)).toHaveLength(0);
  });

  it('"전화문의" 패턴 탐지', () => {
    const dets = runScan('<div class="item-price"><p>전화문의</p></div>');
    expect(dets.some(d => d.guideline === 13)).toBe(true);
  });
});

// ── 기준 15: 반복간섭 ────────────────────────────────────────────────────────

describe('detectNagging — 기준 15', () => {
  it('dialog[open] + CTA 키워드 → confirmed 탐지', () => {
    const dets = runScan('<dialog open><p>구독하기 — 지금 가입하세요</p></dialog>');
    const det = dets.find(d => d.guideline === 15);
    expect(det).toBeDefined();
    expect(det!.confidence).toBe('confirmed');
    expect(det!.module).toBe('dom');
  });

  it('[role=dialog] + FOMO 키워드 → suspicious 탐지 (CTA 없음)', () => {
    const dets = runScan(
      '<div role="dialog"><p>마감 임박! 지금 확인하세요</p></div>',
    );
    const det = dets.find(d => d.guideline === 15);
    expect(det).toBeDefined();
    expect(det!.confidence).toBe('suspicious');
  });

  it('CTA + FOMO 동시 → severity high', () => {
    const dets = runScan(
      '<dialog open><p>혜택받기 마감 임박!</p></dialog>',
    );
    const det = dets.find(d => d.guideline === 15);
    expect(det!.severity).toBe('high');
  });

  it('CTA/FOMO 없는 dialog는 탐지하지 않음', () => {
    const dets = runScan('<dialog open><p>배송 정보를 확인해 주세요.</p></dialog>');
    expect(dets.filter(d => d.guideline === 15)).toHaveLength(0);
  });

  it('숨겨진 dialog(0x0)는 탐지하지 않음', () => {
    document.body.innerHTML = '<dialog open id="dlg"><p>구독하기</p></dialog>';
    const el = document.querySelector<HTMLElement>('dialog')!;
    el.getBoundingClientRect = () => ({
      width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0,
      toJSON: () => ({}),
    });
    new DOMScanner().init();
    expect(getSentDetections().filter(d => d.guideline === 15)).toHaveLength(0);
  });
});

// ── 기준 6: 유인판매 ─────────────────────────────────────────────────────────

describe('detectBaitAndSwitch — 기준 6', () => {
  it('[class*=soldout] + product 컨텍스트 + 대체 유도 → 탐지', () => {
    const dets = runScan(
      '<div class="product-detail">' +
      '  <div class="soldout">품절</div>' +
      '  <p>대신 이 제품은 어떠세요?</p>' +
      '</div>',
    );
    const det = dets.find(d => d.guideline === 6);
    expect(det).toBeDefined();
    expect(det!.severity).toBe('high');
    expect(det!.module).toBe('dom');
  });

  it('텍스트 기반: "품절" + "유사상품" in product ctx → 탐지', () => {
    const dets = runScan(
      '<div class="goods-item"><p>품절 — 유사상품을 추천합니다</p></div>',
    );
    expect(dets.some(d => d.guideline === 6)).toBe(true);
  });

  it('리뷰 영역 내 품절 언급은 스킵 (오탐 방지)', () => {
    const dets = runScan(
      '<div class="product-detail">' +
      '  <div class="review-area">' +
      '    <p>품절됐을 때 대신 구매했어요</p>' +
      '  </div>' +
      '</div>',
    );
    expect(dets.filter(d => d.guideline === 6)).toHaveLength(0);
  });

  it('"관련상품" 대체 유도도 탐지', () => {
    const dets = runScan(
      '<div class="product-info">' +
      '  <span class="soldout">품절</span>' +
      '  <a>관련상품 보기</a>' +
      '</div>',
    );
    expect(dets.some(d => d.guideline === 6)).toBe(true);
  });
});

// ── 기준 2: 순차공개 가격책정 (DOM 경로) ────────────────────────────────────

describe('detectDripPricingDOM — 기준 2 (DOM)', () => {
  // jsdom CSS 선택자가 single-quote attribute를 파싱하지 못하는 경우가 있으므로
  // CSS 선택자 경로 대신 텍스트 노드 기반 탐지 경로로 커버한다.

  it('display:none 숨겨진 배송비 → high/confirmed 탐지', () => {
    const dets = runScan('<p style="display:none">배송비 3,000원</p>');
    const det = dets.find(d => d.guideline === 2 && d.module === 'dom');
    expect(det).toBeDefined();
    expect(det!.severity).toBe('high');
    expect(det!.confidence).toBe('confirmed');
  });

  it('소자(8px) 배송비 표기 → suspicious 탐지', () => {
    const dets = runScan('<p style="font-size:8px">배송비 2,500원 별도 부과</p>');
    const det = dets.find(d => d.guideline === 2 && d.module === 'dom');
    expect(det).toBeDefined();
    expect(det!.confidence).toBe('suspicious');
    expect(det!.severity).toBe('medium');
  });

  it('"무료 배송"은 탐지하지 않음 (무료 배송비는 드립 프라이싱 아님)', () => {
    // 화면에 무료 배송이 표시 → visibleTerms에 추가 → 숨겨진 복사본도 스킵
    // 여기서는 단순히 보이는 "무료 배송"만 있는 경우 탐지 없음 확인
    const dets = runScan('<p>무료 배송 이벤트 진행 중</p>');
    expect(dets.filter(d => d.guideline === 2 && d.module === 'dom')).toHaveLength(0);
  });

  it('visibility:hidden 수수료 → 탐지', () => {
    const dets = runScan('<span style="visibility:hidden">결제수수료 1,000원</span>');
    expect(dets.some(d => d.guideline === 2 && d.module === 'dom')).toBe(true);
  });
});

// ── 기준 14: 클릭 피로감 유발 ────────────────────────────────────────────────

describe('detectClickFatigue — 기준 14', () => {
  it('5단계 이상 체크아웃 단계 → 탐지', () => {
    const dets = runScan(
      '<ol class="checkout-step">' +
      '  <li>장바구니</li><li>배송</li><li>결제</li><li>확인</li><li>완료</li>' +
      '</ol>',
    );
    const det = dets.find(d => d.guideline === 14);
    expect(det).toBeDefined();
    expect(det!.module).toBe('dom');
  });

  it('7단계 이상 → severity high', () => {
    const li = '<li>단계</li>'.repeat(7);
    const dets = runScan(`<ol class="order-step">${li}</ol>`);
    const det = dets.find(d => d.guideline === 14);
    expect(det!.severity).toBe('high');
  });

  it('4단계 이하는 탐지하지 않음', () => {
    const dets = runScan(
      '<ol class="order-step">' +
      '  <li>1</li><li>2</li><li>3</li><li>4</li>' +
      '</ol>',
    );
    expect(dets.filter(d => d.guideline === 14)).toHaveLength(0);
  });

  it('동의 팝업 내 8개 이상 체크박스 → 탐지', () => {
    const checkboxes = '<input type="checkbox">'.repeat(8);
    const dets = runScan(
      `<dialog open>약관 동의 필요${checkboxes}</dialog>`,
    );
    const det = dets.find(d => d.guideline === 14);
    expect(det).toBeDefined();
  });

  it('동의 팝업 체크박스 7개 이하는 탐지하지 않음', () => {
    const checkboxes = '<input type="checkbox">'.repeat(7);
    const dets = runScan(`<dialog open>약관 동의${checkboxes}</dialog>`);
    expect(dets.filter(d => d.guideline === 14)).toHaveLength(0);
  });
});

// ── 기준 9: 잘못된 계층구조 (취소 버튼 시각적 약화) ─────────────────────────

describe('detectVisuallyWeakenedCancel — 기준 9', () => {
  it('opacity 낮은 취소 버튼 → suspicious 탐지', () => {
    // opacity:0.5 < OPACITY_THRESHOLD(0.70) → 신호 1개 → detected
    const dets = runScan(
      '<div>' +
      '  <button>동의</button>' +
      '  <button style="opacity:0.5">취소</button>' +
      '</div>',
    );
    const det = dets.find(d => d.guideline === 9);
    expect(det).toBeDefined();
    expect(det!.confidence).toBe('suspicious');
    expect(det!.module).toBe('dom');
  });

  it('신호 1개 → severity low', () => {
    const dets = runScan(
      '<div><button>확인</button><button style="opacity:0.3">아니요</button></div>',
    );
    expect(dets.find(d => d.guideline === 9)!.severity).toBe('low');
  });

  it('취소 버튼과 동의 버튼이 없으면 탐지하지 않음', () => {
    const dets = runScan('<div><button>다음</button><button>이전</button></div>');
    expect(dets.filter(d => d.guideline === 9)).toHaveLength(0);
  });

  it('opacity 정상(0.9)은 탐지하지 않음', () => {
    const dets = runScan(
      '<div><button>동의</button><button style="opacity:0.9">취소</button></div>',
    );
    expect(dets.filter(d => d.guideline === 9)).toHaveLength(0);
  });
});

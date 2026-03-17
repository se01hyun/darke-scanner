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

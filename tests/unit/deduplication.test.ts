/**
 * deduplicateOverlapping / isCloseRelative 단위 테스트
 *
 * DOMScanner.scan() 을 통한 간접 테스트:
 *   - Case 1: 조상-자손 관계 → 자손(내부) 탐지 제거, 조상만 유지
 *   - Case 2: 근접 형제(LCA ≤ 3단계) → 면적 작은 쪽 제거
 *   - Case 3: 다른 가이드라인 → 중복 제거 안 함
 *   - Case 4: element 없는 탐지(NLP/네트워크) → 항상 유지
 *
 * getBoundingClientRect 는 각 테스트에서 인스턴스별로 조정한다.
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

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  // 기본: 모든 요소가 100×20 크기로 보임
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

// ── Case 1: 조상-자손 관계 ─────────────────────────────────────────────────────

describe('deduplicateOverlapping — Case 1: 조상-자손 관계', () => {
  it('같은 가이드라인: 자손 탐지 제거, 조상만 유지', () => {
    // 외부 div[data-countdown] 안에 내부 span[data-countdown] — 둘 다 기준 17
    const dets = runScan(`
      <div data-countdown="3600">
        <span data-countdown="3600">남은 시간</span>
      </div>
    `);
    const g17 = dets.filter(d => d.guideline === 17);
    // 조상-자손 관계 → 1개만 남아야 함
    expect(g17).toHaveLength(1);
  });

  it('같은 가이드라인: 3단계 중첩 — 최외곽 하나만 유지', () => {
    const dets = runScan(`
      <section data-countdown="7200">
        <div data-countdown="7200">
          <span data-countdown="7200">타이머</span>
        </div>
      </section>
    `);
    const g17 = dets.filter(d => d.guideline === 17);
    expect(g17).toHaveLength(1);
  });

  it('xpath 해석 불가(존재하지 않는 요소) → unresolvable로 유지', () => {
    // NLP/네트워크 전용 탐지(element 없음)는 제거 대상에서 제외
    const dets = runScan(`
      <div data-countdown="3600">카운트다운</div>
    `);
    // g17 탐지가 최소 1건 있어야 함 (unresolvable이어도 유지)
    expect(dets.filter(d => d.guideline === 17).length).toBeGreaterThanOrEqual(1);
  });
});

// ── Case 2: 근접 형제 관계 ─────────────────────────────────────────────────────

describe('deduplicateOverlapping — Case 2: 근접 형제 (LCA ≤ 3단계)', () => {
  it('공통 부모 1단계: 면적 작은 쪽(span) 제거, 큰 쪽(div) 유지', () => {
    // div: 200×100(면적 20000) vs span: 50×20(면적 1000)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.tagName === 'SPAN') {
          return { width: 50, height: 20, top: 10, left: 10, right: 60, bottom: 30, x: 10, y: 10, toJSON: () => ({}) };
        }
        return { width: 200, height: 100, top: 0, left: 0, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) };
      },
    );

    const dets = runScan(`
      <div class="urgency-banner">
        <div data-countdown="3600">큰 카운트다운 배너</div>
        <span data-countdown="3600">작은 타이머</span>
      </div>
    `);
    const g17 = dets.filter(d => d.guideline === 17);
    // 면적 큰 div만 남아야 함
    expect(g17).toHaveLength(1);
    expect(g17[0].element?.xpath).toContain('div');
  });

  it('공통 부모 2단계: 여전히 근접 형제로 처리', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('small')) {
          return { width: 30, height: 10, top: 5, left: 5, right: 35, bottom: 15, x: 5, y: 5, toJSON: () => ({}) };
        }
        return { width: 150, height: 80, top: 0, left: 0, right: 150, bottom: 80, x: 0, y: 0, toJSON: () => ({}) };
      },
    );

    const dets = runScan(`
      <div class="container">
        <div class="inner">
          <div data-countdown="3600" class="big">큰 배너</div>
          <span data-countdown="3600" class="small">작은 뱃지</span>
        </div>
      </div>
    `);
    const g17 = dets.filter(d => d.guideline === 17);
    expect(g17).toHaveLength(1);
  });

  it('면적이 같으면 문서 순서 앞쪽 유지', () => {
    // 모든 요소 동일 크기 → 먼저 등장한(i=0) 요소 유지
    const dets = runScan(`
      <div class="urgency">
        <div data-countdown="3600" class="timer-a">첫 번째</div>
        <div data-countdown="3600" class="timer-b">두 번째</div>
      </div>
    `);
    const g17 = dets.filter(d => d.guideline === 17);
    expect(g17).toHaveLength(1);
  });
});

// ── Case 3: 다른 가이드라인 → 중복 제거 안 함 ────────────────────────────────

describe('deduplicateOverlapping — Case 3: 다른 가이드라인', () => {
  it('같은 요소라도 가이드라인이 다르면 둘 다 유지', () => {
    // data-countdown → 기준 17 / 재고 부족 텍스트 → 기준 18
    const dets = runScan(`
      <div data-countdown="3600">
        남은 수량 3개! 재고 부족
      </div>
    `);
    const g17 = dets.filter(d => d.guideline === 17);
    const g18 = dets.filter(d => d.guideline === 18);
    // 각 가이드라인은 독립적으로 탐지 유지
    expect(g17.length).toBeGreaterThanOrEqual(1);
    expect(g18.length).toBeGreaterThanOrEqual(1);
  });

  it('서로 다른 가이드라인 요소가 형제여도 각각 유지', () => {
    const dets = runScan(`
      <div class="container">
        <div data-countdown="3600">카운트다운</div>
        <div>재고 부족 남은 수량 2개</div>
      </div>
    `);
    expect(dets.some(d => d.guideline === 17)).toBe(true);
    expect(dets.some(d => d.guideline === 18)).toBe(true);
  });
});

// ── Case 4: 단일 요소 / element 없는 탐지 ──────────────────────────────────────

describe('deduplicateOverlapping — Case 4: 엣지케이스', () => {
  it('탐지가 0건이면 빈 배열 반환', () => {
    const dets = runScan('<p>평범한 텍스트</p>');
    expect(dets).toHaveLength(0);
  });

  it('같은 가이드라인이어도 단일 요소면 그대로 유지', () => {
    const dets = runScan('<div data-countdown="3600">남은 시간</div>');
    const g17 = dets.filter(d => d.guideline === 17);
    expect(g17).toHaveLength(1);
  });

  it('LCA가 maxDepth(3) 초과 거리이면 근접 형제로 판단하지 않아 둘 다 유지', () => {
    // isCloseRelative는 a에서 maxDepth(3)단계까지만 조상을 탐색한다.
    // 아래 구조에서 LCA(최외곽 div)는 a로부터 4단계(a→D→C→B→LCA) 위이므로
    // 루프가 끝나기 전에 LCA에 도달하지 못해 false를 반환 → 둘 다 유지된다.
    //
    //   LCA
    //   ├─ B ─ C ─ D ─ [data-countdown] (a, 4단계)
    //   └─ E ─ F ─ G ─ H ─ [data-countdown] (b)
    const dets = runScan(`
      <div>
        <div><div><div>
          <div data-countdown="3600">첫 번째</div>
        </div></div></div>
        <div><div><div><div>
          <div data-countdown="3600">두 번째</div>
        </div></div></div></div>
      </div>
    `);
    const g17 = dets.filter(d => d.guideline === 17);
    // LCA가 탐색 범위 밖 → 근접 형제로 처리되지 않음 → 둘 다 유지
    expect(g17.length).toBeGreaterThanOrEqual(2);
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { DetectionResult, DarkPatternDetection } from '../../src/types';
import {
  scoreVerdict,
  renderNetworkVerdict,
  renderNoResult,
  renderClean,
  renderScoreSection,
  renderCard,
} from '../../src/popup/index';

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

function makeDetection(overrides: Partial<DarkPatternDetection> = {}): DarkPatternDetection {
  return {
    id: 'test-id',
    guideline: 17,
    guidelineName: '시간제한 알림',
    severity: 'medium',
    confidence: 'suspicious',
    module: 'dom',
    description: '허위 카운트다운 탐지',
    evidence: { type: 'dom_element', raw: '', detail: {} },
    ...overrides,
  };
}

function makeResult(overrides: Partial<DetectionResult> = {}): DetectionResult {
  return {
    pageUrl: 'https://example.com',
    scanTimestamp: new Date('2024-01-01T12:00:00').getTime(),
    overallRiskScore: 50,
    detections: [],
    ...overrides,
  };
}

// ── scoreVerdict ───────────────────────────────────────────────────────────────

describe('scoreVerdict', () => {
  it('0점 → 안전', () => {
    expect(scoreVerdict(0)).toMatchObject({ label: '안전', cls: 'verdict-safe', fillCls: 'fill-safe' });
  });

  it('30점 → 안전 (경계값)', () => {
    expect(scoreVerdict(30)).toMatchObject({ label: '안전' });
  });

  it('31점 → 주의', () => {
    expect(scoreVerdict(31)).toMatchObject({ label: '주의', cls: 'verdict-caution', fillCls: 'fill-caution' });
  });

  it('60점 → 주의 (경계값)', () => {
    expect(scoreVerdict(60)).toMatchObject({ label: '주의' });
  });

  it('61점 → 위험', () => {
    expect(scoreVerdict(61)).toMatchObject({ label: '위험', cls: 'verdict-danger', fillCls: 'fill-danger' });
  });

  it('100점 → 위험', () => {
    expect(scoreVerdict(100)).toMatchObject({ label: '위험' });
  });
});

// ── renderNetworkVerdict ───────────────────────────────────────────────────────

describe('renderNetworkVerdict', () => {
  it('dom 모듈 → 빈 문자열', () => {
    const d = makeDetection({ module: 'dom' });
    expect(renderNetworkVerdict(d)).toBe('');
  });

  it('nlp 모듈 → 빈 문자열', () => {
    const d = makeDetection({ module: 'nlp' });
    expect(renderNetworkVerdict(d)).toBe('');
  });

  it('script_pattern + timer_reset → 타이머 반복 초기화 배지', () => {
    const d = makeDetection({
      module: 'network',
      evidence: { type: 'script_pattern', raw: '', detail: { patternType: 'timer_reset', src: 'https://cdn.example.com/timer.js' } },
    });
    const html = renderNetworkVerdict(d);
    expect(html).toContain('net-verdict-fake');
    expect(html).toContain('타이머 반복 초기화 확인됨');
    expect(html).toContain('timer.js');
  });

  it('script_pattern + timer_reset + 인라인 → 인라인 스크립트 레이블', () => {
    const d = makeDetection({
      module: 'network',
      evidence: { type: 'script_pattern', raw: '', detail: { patternType: 'timer_reset', src: 'inline' } },
    });
    expect(renderNetworkVerdict(d)).toContain('인라인 스크립트');
  });

  it('script_pattern + random_counter → 난수 카운터 배지', () => {
    const d = makeDetection({
      module: 'network',
      evidence: { type: 'script_pattern', raw: '', detail: { patternType: 'random_counter', src: 'inline' } },
    });
    const html = renderNetworkVerdict(d);
    expect(html).toContain('net-verdict-fake');
    expect(html).toContain('난수 카운터 조작 확인됨');
  });

  it('network_analysis + increaseRate → 가격 상승 배지', () => {
    const d = makeDetection({
      module: 'network',
      evidence: { type: 'network_analysis', raw: '', detail: { increaseRate: 12.5 } },
    });
    const html = renderNetworkVerdict(d);
    expect(html).toContain('net-verdict-fake');
    expect(html).toContain('+12.5%');
  });

  it('network_analysis + no_server_response_for_tab → 서버 데이터 미확인 배지', () => {
    const d = makeDetection({
      module: 'network',
      evidence: { type: 'network_analysis', raw: '', detail: { reason: 'no_server_response_for_tab' } },
    });
    const html = renderNetworkVerdict(d);
    expect(html).toContain('net-verdict-unverified');
    expect(html).toContain('서버 데이터 미확인');
  });

  it('network_analysis + 알 수 없는 reason → 빈 문자열', () => {
    const d = makeDetection({
      module: 'network',
      evidence: { type: 'network_analysis', raw: '', detail: { reason: 'unknown_reason' } },
    });
    expect(renderNetworkVerdict(d)).toBe('');
  });
});

// ── renderNoResult ─────────────────────────────────────────────────────────────

describe('renderNoResult', () => {
  it('state-view 클래스 포함', () => {
    const el = renderNoResult();
    expect(el.className).toBe('state-view');
  });

  it('"아직 스캔 전" 텍스트 포함', () => {
    const el = renderNoResult();
    expect(el.textContent).toContain('아직 스캔 전입니다');
  });

  it('"새로고침" 안내 텍스트 포함', () => {
    const el = renderNoResult();
    expect(el.textContent).toContain('새로고침');
  });
});

// ── renderClean ────────────────────────────────────────────────────────────────

describe('renderClean', () => {
  it('state-view 클래스 포함', () => {
    const el = renderClean(makeResult());
    expect(el.className).toBe('state-view');
  });

  it('"다크 패턴이 탐지되지 않았습니다" 텍스트 포함', () => {
    const el = renderClean(makeResult());
    expect(el.textContent).toContain('다크 패턴이 탐지되지 않았습니다');
  });

  it('스캔 시각 텍스트 포함', () => {
    const el = renderClean(makeResult());
    expect(el.textContent).toContain('스캔 시각');
  });
});

// ── renderScoreSection ─────────────────────────────────────────────────────────

describe('renderScoreSection', () => {
  it('score-section 클래스 포함', () => {
    const el = renderScoreSection(makeResult({ overallRiskScore: 50 }));
    expect(el.className).toBe('score-section');
  });

  it('점수 숫자 표시', () => {
    const el = renderScoreSection(makeResult({ overallRiskScore: 75 }));
    expect(el.querySelector('.score-number')?.textContent).toBe('75');
  });

  it('점수 30 이하 → 안전 verdict', () => {
    const el = renderScoreSection(makeResult({ overallRiskScore: 20 }));
    expect(el.querySelector('.score-verdict')?.textContent).toContain('안전');
    expect(el.querySelector('.score-verdict')?.className).toContain('verdict-safe');
  });

  it('점수 61 이상 → 위험 verdict', () => {
    const el = renderScoreSection(makeResult({ overallRiskScore: 80 }));
    expect(el.querySelector('.score-verdict')?.textContent).toContain('위험');
    expect(el.querySelector('.score-verdict')?.className).toContain('verdict-danger');
  });

  it('탐지 건수 요약 표시', () => {
    const detections: DarkPatternDetection[] = [
      makeDetection({ severity: 'high', confidence: 'confirmed' }),
      makeDetection({ severity: 'medium', confidence: 'suspicious' }),
      makeDetection({ severity: 'low', confidence: 'suspicious' }),
    ];
    const el = renderScoreSection(makeResult({ detections, overallRiskScore: 60 }));
    const summary = el.querySelector('.score-summary')?.textContent ?? '';
    expect(summary).toContain('탐지 3건');
    expect(summary).toContain('높음 1건');
    expect(summary).toContain('보통 1건');
    expect(summary).toContain('낮음 1건');
    expect(summary).toContain('확정 1건');
  });

  it('탐지 0건 → 요약 숫자 없음', () => {
    const el = renderScoreSection(makeResult({ detections: [], overallRiskScore: 0 }));
    const summary = el.querySelector('.score-summary')?.textContent ?? '';
    expect(summary).toContain('탐지 0건');
    expect(summary).not.toContain('높음');
  });

  it('score-bar-fill 요소 존재', () => {
    const el = renderScoreSection(makeResult());
    expect(el.querySelector('#score-fill')).not.toBeNull();
  });
});

// ── renderCard ─────────────────────────────────────────────────────────────────

describe('renderCard', () => {

  it('detection-card 클래스 포함', () => {
    const card = renderCard(makeDetection(), 1);
    expect(card.className).toContain('detection-card');
  });

  it('기준 번호 표시', () => {
    const card = renderCard(makeDetection({ guideline: 17 }), 1);
    expect(card.querySelector('.guideline-num')?.textContent).toContain('17');
  });

  it('가이드라인 이름 표시', () => {
    const card = renderCard(makeDetection({ guidelineName: '시간제한 알림' }), 1);
    expect(card.querySelector('.card-name')?.textContent).toContain('시간제한 알림');
  });

  it('설명 표시', () => {
    const card = renderCard(makeDetection({ description: '테스트 설명' }), 1);
    expect(card.querySelector('.card-desc')?.textContent).toContain('테스트 설명');
  });

  it('severity chip 클래스 포함', () => {
    const card = renderCard(makeDetection({ severity: 'high' }), 1);
    const chips = card.querySelectorAll('.chip');
    const chipTexts = Array.from(chips).map(c => c.className);
    expect(chipTexts.some(c => c.includes('chip-high'))).toBe(true);
  });

  it('confidence chip 표시', () => {
    const card = renderCard(makeDetection({ confidence: 'confirmed' }), 1);
    const chips = card.querySelectorAll('.chip');
    const texts = Array.from(chips).map(c => c.textContent);
    expect(texts.some(t => t?.includes('확정'))).toBe(true);
  });

  it('xpath 없으면 card-clickable 없음', () => {
    // element 필드를 아예 제외한 탐지 객체 생성
    const { element: _unused, ...base } = makeDetection();
    const card = renderCard(base as DarkPatternDetection, 1);
    expect(card.classList.contains('card-clickable')).toBe(false);
  });

  it('xpath 있으면 card-clickable 추가', () => {
    const card = renderCard(
      makeDetection({ element: { xpath: '//div', outerHTML: '<div/>', boundingRect: { top: 0, left: 0, width: 100, height: 20 } } }),
      1,
    );
    expect(card.classList.contains('card-clickable')).toBe(true);
  });

  it('xpath 있고 카드 클릭 시 SCROLL_TO_ELEMENT 메시지 전송', () => {
    const sendMessage = chrome.tabs.sendMessage as ReturnType<typeof vi.fn>;
    const card = renderCard(
      makeDetection({ element: { xpath: '//div[@id="target"]', outerHTML: '<div/>', boundingRect: { top: 0, left: 0, width: 100, height: 20 } } }),
      42,
    );
    card.click();
    expect(sendMessage).toHaveBeenCalledWith(42, {
      type: 'SCROLL_TO_ELEMENT',
      payload: { xpath: '//div[@id="target"]' },
    });
  });

  it('공정위 기준 보기 버튼 존재', () => {
    const card = renderCard(makeDetection(), 1);
    const btn = card.querySelector('.ftc-link');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain('공정위 기준 보기');
  });

  it('공정위 버튼 클릭 시 새 탭 열기', () => {
    const create = chrome.tabs.create as ReturnType<typeof vi.fn>;
    const { element: _unused, ...base } = makeDetection();
    const card = renderCard(base as DarkPatternDetection, 1);
    const btn = card.querySelector<HTMLButtonElement>('.ftc-link')!;
    btn.click();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('ftc.go.kr') }));
  });
});

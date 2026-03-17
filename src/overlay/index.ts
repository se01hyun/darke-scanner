// Module 4: Page Overlay — Shadow DOM 기반 하이라이트 + 툴팁
// 원본 페이지 스타일과 격리하기 위해 Shadow DOM(mode: 'closed')을 사용한다.

import type { DarkPatternDetection, MessageType } from '../types';
import { escHtml } from '../utils/html';

// ── 스타일 (Shadow DOM 내부 전용) ─────────────────────────────────────────────

const STYLES = `
  .highlight {
    position: fixed;
    box-sizing: border-box;
    pointer-events: none;
    border-radius: 2px;
  }
  .highlight.severity-high   { border: 2px solid #ef4444; }
  .highlight.severity-medium { border: 2px solid #f97316; }
  .highlight.severity-low    { border: 2px solid #eab308; }
  .highlight.confidence-suspicious { border-style: dashed; }
  .highlight.confidence-confirmed  { border-style: solid;  }

  /* 배지 호버 시 해당 하이라이트를 전면으로 */
  .highlight:has(.badge:hover) { z-index: 2147483640; }

  /* ── 배지 (좌상단 고정) ── */
  .badge {
    position: absolute;
    top: -1px;
    left: -1px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 1px 6px 1px 4px;
    border-radius: 0 0 4px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.6;
    color: #fff;
    pointer-events: auto;   /* 호버 감지 */
    cursor: help;
    white-space: nowrap;
    user-select: none;
  }
  .badge.severity-high   { background: #ef4444; }
  .badge.severity-medium { background: #f97316; }
  .badge.severity-low    { background: #ca8a04; }

  /* ── 툴팁 (배지 호버 시 표시) ── */
  .tooltip {
    display: none;
    position: absolute;
    left: 0;
    min-width: 230px;
    max-width: 300px;
    background: #1e1e2e;
    color: #cdd6f4;
    border-radius: 8px;
    padding: 10px 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 12px;
    line-height: 1.55;
    box-shadow: 0 6px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
    z-index: 1;
    pointer-events: none;
    word-break: keep-all;
    white-space: normal;
  }
  .badge:hover .tooltip { display: block; }

  .tooltip-title {
    font-size: 13px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 6px;
    white-space: nowrap;
  }
  .tooltip-chips {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .chip {
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.6;
  }
  .chip-confirmed  { background: #a6e3a1; color: #1e1e2e; }
  .chip-suspicious { background: #f9e2af; color: #1e1e2e; }
  .chip-high   { background: #f38ba8; color: #1e1e2e; }
  .chip-medium { background: #fab387; color: #1e1e2e; }
  .chip-low    { background: #f9e2af; color: #1e1e2e; }

  .tooltip-desc {
    color: #bac2de;
    font-size: 11px;
    line-height: 1.6;
  }
  .tooltip-meta {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid #313244;
    font-size: 10px;
    color: #585b70;
  }
  .tooltip-disclaimer {
    margin-top: 4px;
    font-size: 9px;
    color: #45475a;
  }
`;

// ── 유틸 ──────────────────────────────────────────────────────────────────────

const SEVERITY_KO: Record<string, string> = { high: '높음', medium: '보통', low: '낮음' };
const MODULE_KO:   Record<string, string> = { dom: 'DOM', nlp: 'NLP', network: '네트워크' };

function resolveXPath(xpath: string): HTMLElement | null {
  try {
    const result = document.evaluate(
      xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null,
    );
    return result.singleNodeValue as HTMLElement | null;
  } catch {
    return null;
  }
}

// ── OverlayManager ────────────────────────────────────────────────────────────

interface HighlightEntry {
  xpath: string;
  el: HTMLElement;    // .highlight div (Shadow DOM 내부)
}

class OverlayManager {
  private readonly root: ShadowRoot;
  private entries: HighlightEntry[] = [];
  private rafPending = false;

  constructor() {
    const host = document.createElement('dark-scanner-overlay');

    // 호스트는 fixed 0×0 — 원본 레이아웃에 영향 없음
    Object.assign(host.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      overflow: 'visible',
      zIndex: '2147483646',
      pointerEvents: 'none',
    });

    this.root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    this.root.appendChild(style);

    document.documentElement.appendChild(host);
    this.bindRepositionListeners();
  }

  // 탐지 결과 전체를 받아 하이라이트를 (재)렌더링한다.
  render(detections: DarkPatternDetection[]): void {
    for (const { el } of this.entries) el.remove();
    this.entries = [];

    for (const d of detections) {
      // element 정보가 없는 탐지(네트워크/NLP 전용)는 overlay 표시 불가
      if (!d.element?.xpath) continue;

      const el = this.buildHighlight(d);
      this.root.appendChild(el);
      this.entries.push({ xpath: d.element.xpath, el });
    }

    this.repositionAll();
  }

  // ── 하이라이트 + 배지 + 툴팁 DOM 생성 ─────────────────────────────────────

  private buildHighlight(d: DarkPatternDetection): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = `highlight severity-${d.severity} confidence-${d.confidence}`;

    // 배지
    const badge = document.createElement('div');
    badge.className = `badge severity-${d.severity}`;
    badge.textContent = `⚠ 기준${d.guideline}`;

    // 툴팁
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.innerHTML = `
      <div class="tooltip-title">${escHtml(d.guidelineName)}</div>
      <div class="tooltip-chips">
        <span class="chip chip-${d.confidence}">${d.confidence === 'confirmed' ? '확정' : '의심'}</span>
        <span class="chip chip-${d.severity}">심각도 ${SEVERITY_KO[d.severity] ?? d.severity}</span>
      </div>
      <div class="tooltip-desc">${escHtml(d.description)}</div>
      <div class="tooltip-meta">공정위 기준 ${d.guideline}번 · ${MODULE_KO[d.module] ?? d.module} 모듈</div>
      <div class="tooltip-disclaimer">공정위 기준 기반 자동 분석 결과입니다.</div>
    `;

    badge.appendChild(tooltip);
    wrap.appendChild(badge);
    return wrap;
  }

  // ── 위치 재계산 ────────────────────────────────────────────────────────────
  // 스크롤/리사이즈 시 XPath로 요소를 다시 찾아 fixed 좌표를 갱신한다.

  private repositionAll(): void {
    for (const { xpath, el } of this.entries) {
      const target = resolveXPath(xpath);
      if (!target) {
        el.style.display = 'none';
        continue;
      }

      const r = target.getBoundingClientRect();

      // 크기 0이면 숨김 (아직 렌더링 안 된 요소 등)
      if (r.width === 0 && r.height === 0) {
        el.style.display = 'none';
        continue;
      }

      el.style.top     = `${r.top}px`;
      el.style.left    = `${r.left}px`;
      el.style.width   = `${r.width}px`;
      el.style.height  = `${r.height}px`;
      el.style.display = '';   // CSS 기본값(block) 복원

      // 툴팁 방향: 하단 공간이 170px 미만이고 상단에 여유가 있으면 위쪽으로
      const tooltip = el.querySelector<HTMLElement>('.tooltip');
      if (tooltip) {
        const spaceBelow = window.innerHeight - r.bottom;
        if (spaceBelow < 170 && r.top > 170) {
          tooltip.style.top    = '';
          tooltip.style.bottom = 'calc(100% + 6px)';
        } else {
          tooltip.style.top    = 'calc(100% + 6px)';
          tooltip.style.bottom = '';
        }
      }
    }
  }

  private scheduleReposition(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.repositionAll();
    });
  }

  private bindRepositionListeners(): void {
    // capture: true — iframe 내 스크롤도 감지
    window.addEventListener('scroll', () => this.scheduleReposition(), { passive: true, capture: true });
    window.addEventListener('resize', () => this.scheduleReposition(), { passive: true });
  }
}

// ── 진입점 ────────────────────────────────────────────────────────────────────
// 같은 페이지에 스크립트가 중복 로드되어도 하나의 인스턴스만 생성한다.

if (!document.querySelector('dark-scanner-overlay')) {
  const manager = new OverlayManager();

  chrome.runtime.onMessage.addListener((message: MessageType) => {
    if (message.type === 'SCAN_COMPLETE') {
      manager.render(message.payload.detections);
    }
  });
}

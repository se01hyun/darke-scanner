// Module 4: Page Overlay — Shadow DOM 기반 하이라이트 + 툴팁
// 원본 페이지 스타일과 격리하기 위해 Shadow DOM(mode: 'closed')을 사용한다.

import type { DarkPatternDetection, MessageType } from '../types';
import { escHtml } from '../utils/html';
import { SEVERITY_KO, MODULE_KO } from '../utils/display';

// ── 스타일 (Shadow DOM 내부 전용) ─────────────────────────────────────────────

const STYLES = `
  @keyframes ds-flash {
    0%   { box-shadow: 0 0 0 0   rgba(251,191,36,0); }
    25%  { box-shadow: 0 0 0 8px rgba(251,191,36,0.85); }
    55%  { box-shadow: 0 0 0 4px rgba(251,191,36,0.4); }
    80%  { box-shadow: 0 0 0 8px rgba(251,191,36,0.85); }
    100% { box-shadow: 0 0 0 0   rgba(251,191,36,0); }
  }
  .highlight.ds-flash { animation: ds-flash 0.9s ease; }

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

  /* ── 배지 (highlight 상단 위에 부유) ── */
  .badge {
    position: absolute;
    bottom: calc(100% + 1px);  /* highlight box 바로 위 */
    top: auto;
    left: -1px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 1px 6px 1px 4px;
    border-radius: 4px 4px 4px 0;
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
    top: calc(100% + 4px);  /* 배지 아래 */
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

interface BoundingRect { top: number; left: number; width: number; height: number; }

interface HighlightEntry {
  xpath: string;
  el: HTMLElement;          // .highlight div (Shadow DOM 내부)
  boundingRect: BoundingRect; // 스캔 시점 절대 좌표 (XPath 실패 시 fallback)
}

class OverlayManager {
  private readonly root: ShadowRoot;
  private entries: HighlightEntry[] = [];
  private rafPending = false;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const host = document.createElement('dark-scanner-overlay');

    // 호스트는 fixed 0×0 — 원본 레이아웃에 영향 없음
    // z-index는 !important로 설정해야 sticky 헤더 등의 스태킹 컨텍스트보다 위에 표시됨
    Object.assign(host.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      overflow: 'visible',
      pointerEvents: 'none',
    });
    host.style.setProperty('z-index', '2147483647', 'important');

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
    this.retryCount = 0;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }

    for (const d of detections) {
      // element 정보가 없는 탐지(네트워크/NLP 전용)는 overlay 표시 불가
      if (!d.element?.xpath) continue;

      const el = this.buildHighlight(d);
      this.root.appendChild(el);
      this.entries.push({
        xpath: d.element.xpath,
        el,
        boundingRect: d.element.boundingRect,
      });
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
    let needsRetry = false;

    for (const { xpath, el, boundingRect } of this.entries) {
      const target = resolveXPath(xpath);

      let top: number, left: number, width: number, height: number;
      let usingFallback = false;

      if (target) {
        const r = target.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) {
          // 아직 렌더링 안 된 요소 — fallback으로 시도
          usingFallback = true;
        } else {
          top = r.top; left = r.left; width = r.width; height = r.height;
        }
      } else {
        // XPath 실패(동적 DOM 변경 등) — fallback으로 시도
        usingFallback = true;
      }

      if (usingFallback) {
        if (boundingRect.width > 0 && boundingRect.height > 0) {
          // 스캔 시점의 절대 좌표를 현재 스크롤 위치 기준 fixed 좌표로 변환
          top    = boundingRect.top  - window.scrollY;
          left   = boundingRect.left - window.scrollX;
          width  = boundingRect.width;
          height = boundingRect.height;
        } else {
          el.style.display = 'none';
          needsRetry = true;
          continue;
        }
      }

      el.style.top     = `${top!}px`;
      el.style.left    = `${left!}px`;
      el.style.width   = `${width!}px`;
      el.style.height  = `${height!}px`;
      el.style.display = '';   // CSS 기본값(block) 복원

      // 툴팁 방향: 배지가 요소 위에 있으므로 기본은 배지 아래(=요소 방향)
      // 배지 아래 공간이 170px 미만이면 배지 위로 올림
      const tooltip = el.querySelector<HTMLElement>('.tooltip');
      if (tooltip) {
        const spaceBelow = window.innerHeight - top!;
        if (spaceBelow < 170 && top! > 170) {
          tooltip.style.top    = '';
          tooltip.style.bottom = 'calc(100% + 4px)';
        } else {
          tooltip.style.top    = 'calc(100% + 4px)';
          tooltip.style.bottom = '';
        }
      }
    }

    // 숨겨진 요소가 있으면 1초 후 재시도 (최대 5회)
    if (needsRetry && this.retryCount < 5) {
      this.retryCount++;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.repositionAll();
      }, 1000);
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

  // 팝업에서 SCROLL_TO_ELEMENT 요청 시 호출
  scrollAndFlash(xpath: string): void {
    const entry = this.entries.find(e => e.xpath === xpath);
    if (!entry) return;

    // 1. 실제 DOM 요소로 스크롤 (xpath 우선, 실패 시 저장된 boundingRect 폴백)
    const target = resolveXPath(xpath);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      // xpath 실패(동적 DOM 변경 등) — 스캔 시점의 절대 좌표로 폴백 스크롤
      const r = entry.boundingRect;
      if (r.width > 0 || r.height > 0) {
        window.scrollTo({
          top: Math.max(0, r.top - window.innerHeight / 2),
          behavior: 'smooth',
        });
      }
    }

    // 2. 스크롤이 어느 정도 완료된 후 하이라이트 강조
    // 숨겨진(display:none) 하이라이트는 강제로 복원한 뒤 flash 적용
    setTimeout(() => {
      // xpath가 실패했거나 boundingRect 폴백으로 숨겨진 경우 강제 표시
      if (entry.el.style.display === 'none') {
        const r = entry.boundingRect;
        if (r.width > 0 && r.height > 0) {
          entry.el.style.top    = `${r.top  - window.scrollY}px`;
          entry.el.style.left   = `${r.left - window.scrollX}px`;
          entry.el.style.width  = `${r.width}px`;
          entry.el.style.height = `${r.height}px`;
          entry.el.style.display = '';
        }
      }

      // reflow를 강제하여 animation이 처음부터 재생되도록 함
      entry.el.classList.remove('ds-flash');
      void entry.el.offsetWidth;
      entry.el.classList.add('ds-flash');
      entry.el.addEventListener('animationend', () => {
        entry.el.classList.remove('ds-flash');
      }, { once: true });
    }, 400);
  }
}

// ── 진입점 ────────────────────────────────────────────────────────────────────
// 같은 페이지에 스크립트가 중복 로드되어도 하나의 인스턴스만 생성한다.

if (!document.querySelector('dark-scanner-overlay')) {
  const manager = new OverlayManager();

  chrome.runtime.onMessage.addListener((message: MessageType) => {
    if (message.type === 'SCAN_COMPLETE') {
      manager.render(message.payload.detections);
    } else if (message.type === 'SCROLL_TO_ELEMENT') {
      manager.scrollAndFlash(message.payload.xpath);
    }
  });
}

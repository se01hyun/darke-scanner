// Phase 1 MVP — DOM Scanner
// 공정위 기준 1(False Urgency), 2(Scarcity), 5·11(Basket Sneaking / Preselection) 구현

import type { DarkPatternDetection } from '../types';
import { generateId } from '../utils/id';
import { getElementInfo } from '../utils/element';
import domSelectors from '../../rules/dom-selectors.json';
import fomoKeywords from '../../rules/fomo-keywords.json';

// hh:mm 또는 hh:mm:ss 형태의 카운트다운 텍스트 패턴
const COUNTDOWN_TEXT_RE = /\d{1,2}:\d{2}(:\d{2})?/;

// 텍스트 노드 스캔 시 최대 탐지 수 (오탐 flood 방지)
const MAX_TEXT_DETECTIONS = 5;

export class DOMScanner {
  private observer: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  init(): void {
    this.scan();
    this.watchDynamicChanges();
    this.watchSPANavigation();
  }

  private scan(): void {
    const detections: DarkPatternDetection[] = [
      ...this.detectCountdown(),
      ...this.detectStockWarning(),
      ...this.detectPreselectedOptions(),
    ];
    this.sendToBackground(detections);
  }

  // ─── 공정위 기준 1번: 잘못된 긴급성 (False Urgency) ─────────────────────────
  private detectCountdown(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    for (const selector of domSelectors.selectors.countdown) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);

        const text = (el.textContent ?? '').trim();
        const hasTimePattern = COUNTDOWN_TEXT_RE.test(text);

        detections.push({
          id: generateId(),
          guideline: 1,
          guidelineName: '잘못된 긴급성',
          severity: 'medium',
          // 시간 패턴(00:05)까지 있으면 confirmed, 선택자만 매칭이면 suspicious
          confidence: hasTimePattern ? 'confirmed' : 'suspicious',
          module: 'dom',
          description: '카운트다운 타이머가 감지되었습니다. 실제 마감 시한인지 확인이 필요합니다.',
          evidence: {
            type: 'dom_element',
            raw: el.outerHTML.slice(0, 300),
            detail: { selector, text: text.slice(0, 100) },
          },
          element: getElementInfo(el),
        });
      });
    }

    return detections;
  }

  // ─── 공정위 기준 2번: 희소성 과장 (Scarcity) ────────────────────────────────
  private detectStockWarning(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    // 1) CSS 선택자 기반 탐지 (confirmed 우선)
    for (const selector of domSelectors.selectors.stock_warning) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);

        const text = (el.textContent ?? '').trim();
        if (!text) return;

        const matched = fomoKeywords.keywords.find((kw) => text.includes(kw));

        detections.push({
          id: generateId(),
          guideline: 2,
          guidelineName: '희소성 과장',
          severity: 'medium',
          confidence: matched ? 'confirmed' : 'suspicious',
          module: 'dom',
          description: `재고 부족을 강조하는 문구가 감지되었습니다${matched ? `: "${matched}"` : ''}.`,
          evidence: {
            type: 'dom_element',
            raw: el.outerHTML.slice(0, 300),
            detail: { selector, matchedKeyword: matched ?? null, text: text.slice(0, 100) },
          },
          element: getElementInfo(el),
        });
      });
    }

    // 2) 텍스트 노드 키워드 스캔 (선택자 미매칭 케이스 보완)
    let textHitCount = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;

    while ((node = walker.nextNode()) && textHitCount < MAX_TEXT_DETECTIONS) {
      const text = node.textContent ?? '';
      const matched = fomoKeywords.keywords.find((kw) => text.includes(kw));
      if (!matched) continue;

      const parent = node.parentElement;
      if (!parent) continue;
      // 이미 선택자로 잡힌 요소의 자식이면 중복 제외
      if (seen.has(parent) || parent.closest('[class*="stock"],[class*="remain"],[class*="limited"]')) continue;

      seen.add(parent);
      textHitCount++;

      detections.push({
        id: generateId(),
        guideline: 2,
        guidelineName: '희소성 과장',
        severity: 'low',
        confidence: 'suspicious',
        module: 'dom',
        description: `FOMO 유발 문구가 감지되었습니다: "${matched}"`,
        evidence: {
          type: 'text_analysis',
          raw: text.trim().slice(0, 200),
          detail: { matchedKeyword: matched },
        },
        element: getElementInfo(parent),
      });
    }

    return detections;
  }

  // ─── 공정위 기준 5·11번: 바구니 담기 / 기본값 조작 ─────────────────────────
  private detectPreselectedOptions(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];

    for (const selector of domSelectors.selectors.preselected_options) {
      document.querySelectorAll<HTMLInputElement>(selector).forEach((el) => {
        // required 필드는 정상 동작이므로 제외
        if (el.required) return;

        const label = this.findLabel(el)?.trim() ?? null;
        const labelLower = label?.toLowerCase() ?? '';

        // 레이블에 상업적 추가 항목을 암시하는 단어가 있으면 더 심각한 유형으로 분류
        const isSneaking =
          labelLower.includes('추가') ||
          labelLower.includes('보험') ||
          labelLower.includes('구독') ||
          labelLower.includes('동의') ||
          labelLower.includes('선택');

        detections.push({
          id: generateId(),
          guideline: isSneaking ? 5 : 11,
          guidelineName: isSneaking ? '바구니 담기' : '기본값 조작',
          severity: isSneaking ? 'high' : 'medium',
          confidence: isSneaking ? 'confirmed' : 'suspicious',
          module: 'dom',
          description: `동의 없이 기본 선택된 옵션이 감지되었습니다${label ? `: "${label}"` : ''}.`,
          evidence: {
            type: 'dom_element',
            raw: el.outerHTML.slice(0, 300),
            detail: { label, inputType: el.type },
          },
          element: getElementInfo(el),
        });
      });
    }

    return detections;
  }

  // input과 연결된 label 텍스트 추출
  private findLabel(input: HTMLInputElement): string | null {
    if (input.id) {
      const el = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (el?.textContent) return el.textContent;
    }
    return input.closest('label')?.textContent ?? null;
  }

  // ─── 인프라 ──────────────────────────────────────────────────────────────────

  private watchDynamicChanges(): void {
    this.observer = new MutationObserver(() => {
      // 연속 DOM 변경을 debounce하여 과도한 재스캔 방지
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.scan(), 500);
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  private watchSPANavigation(): void {
    const originalPushState = history.pushState.bind(history);
    history.pushState = (...args) => {
      originalPushState(...args);
      this.scan();
    };
    window.addEventListener('popstate', () => this.scan());
  }

  private sendToBackground(detections: DarkPatternDetection[]): void {
    chrome.runtime.sendMessage({ type: 'DOM_DETECTIONS', payload: detections });
  }
}

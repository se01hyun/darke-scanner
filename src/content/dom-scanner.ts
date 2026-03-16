// Phase 1 MVP — DOM Scanner
// 공정위 기준 17(시간제한 알림), 18(낮은 재고 알림), 3·10(몰래 장바구니 추가 / 특정옵션의 사전선택) 구현
// Phase 5 — 기준 9(잘못된 계층구조 / 취소 버튼 시각적 약화) 추가, QA 로깅 추가

import type { DarkPatternDetection } from '../types';
import { generateId } from '../utils/id';
import { getElementInfo, getContrastRatio } from '../utils/element';
import { logger } from '../utils/debug-logger';
import domSelectors from '../../rules/dom-selectors.json';
import fomoKeywords from '../../rules/fomo-keywords.json';

// ─── 가이드라인 12: 취소 버튼 시각적 약화 상수 ──────────────────────────────
// 텍스트에 포함된 단어로 버튼 역할을 분류
const ACCEPT_KEYWORDS = ['동의', '확인', '구매', '결제', '신청', '시작', '계속', '주문', '구독', '동의하기', '확인하기'];
const CANCEL_KEYWORDS = ['취소', '거절', '아니요', '아니오', '닫기', '나중에', '건너뛰기', '거부', '뒤로'];

// WCAG AA 기준(4.5:1) 미만이면 가독성 부족; 3.0:1 미만은 매우 낮음
const CONTRAST_WEAK_THRESHOLD    = 3.0;
const CONTRAST_ACCEPT_THRESHOLD  = 4.5;
// 취소 버튼 폰트가 동의 버튼 대비 이 비율 미만이면 약화 신호
const FONT_RATIO_THRESHOLD = 0.85;
// 불투명도가 이 값 미만이면 약화 신호
const OPACITY_THRESHOLD = 0.70;

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
    const t0 = performance.now();
    logger.group(`DOM Scan — ${document.location.href}`);

    const countdown       = this.detectCountdown();
    const stockWarning    = this.detectStockWarning();
    const preselected     = this.detectPreselectedOptions();
    const weakenedCancel  = this.detectVisuallyWeakenedCancel();

    const detections: DarkPatternDetection[] = [
      ...countdown, ...stockWarning, ...preselected, ...weakenedCancel,
    ];

    logger.log('DOM', `스캔 완료 ${(performance.now() - t0).toFixed(1)}ms | 총 ${detections.length}건`
      + ` (카운트다운:${countdown.length} 재고:${stockWarning.length} 사전선택:${preselected.length} 약화취소:${weakenedCancel.length})`);
    logger.detections('DOM', detections);
    logger.groupEnd();

    this.sendToBackground(detections);
  }

  // ─── 공정위 기준 17번: 시간제한 알림 (False Urgency) ────────────────────────
  private detectCountdown(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];
    const seen = new Set<Element>();

    for (const selector of domSelectors.selectors.countdown) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);

        const text = (el.textContent ?? '').trim();
        const hasTimePattern = COUNTDOWN_TEXT_RE.test(text);

        logger.log('DOM:카운트다운',
          `selector="${selector}" hasTime=${hasTimePattern} text="${text.slice(0, 80)}"`);

        detections.push({
          id: generateId(),
          guideline: 17,
          guidelineName: '시간제한 알림',
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

  // ─── 공정위 기준 18번: 낮은 재고 알림 (Scarcity) ───────────────────────────
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
        const hasQuantityDigit = /\d/.test(text);

        // 오탐 방지: FOMO 키워드도 없고 수량 숫자도 없으면 스킵
        // (예: class="stock-photo", class="stock-list" 등 무관한 요소 제외)
        if (!matched && !hasQuantityDigit) {
          logger.warn('DOM:재고', `오탐 후보 스킵 — selector="${selector}" text="${text.slice(0, 60)}"`);
          return;
        }

        logger.log('DOM:재고', `탐지 — selector="${selector}" keyword="${matched ?? '(없음)'}" text="${text.slice(0, 80)}"`);

        detections.push({
          id: generateId(),
          guideline: 18,
          guidelineName: '낮은 재고 알림',
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
        guideline: 18,
        guidelineName: '낮은 재고 알림',
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

  // ─── 공정위 기준 3·10번: 몰래 장바구니 추가 / 특정옵션의 사전선택 ────────────
  private detectPreselectedOptions(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];

    for (const selector of domSelectors.selectors.preselected_options) {
      document.querySelectorAll<HTMLInputElement>(selector).forEach((el) => {
        // required 필드는 정상 동작이므로 제외
        if (el.required) return;

        const label = this.findLabel(el)?.trim() ?? null;
        const labelLower = label?.toLowerCase() ?? '';

        // 레이블에 상업적 추가 항목을 암시하는 단어가 있으면 더 심각한 유형으로 분류
        // '선택'은 제외 — "배송지 선택", "사이즈 선택" 등 정상 레이블과 혼동되어 오탐 발생
        const isSneaking =
          labelLower.includes('추가') ||
          labelLower.includes('보험') ||
          labelLower.includes('구독') ||
          labelLower.includes('동의');

        logger.log('DOM:사전선택',
          `isSneaking=${isSneaking} label="${label ?? '(없음)'}" type=${el.type} id=${el.id}`);

        detections.push({
          id: generateId(),
          guideline: isSneaking ? 3 : 10,
          guidelineName: isSneaking ? '몰래 장바구니 추가' : '특정옵션의 사전선택',
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

  // ─── 공정위 기준 9번: 잘못된 계층구조 (취소 버튼 시각적 약화) ──────────────
  private detectVisuallyWeakenedCancel(): DarkPatternDetection[] {
    const detections: DarkPatternDetection[] = [];

    // 버튼 역할을 할 수 있는 모든 요소 수집
    const allButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]',
      ),
    );

    const acceptButtons: HTMLElement[] = [];
    const cancelButtons: HTMLElement[] = [];

    for (const btn of allButtons) {
      const text = (btn.textContent ?? '').trim();
      if (ACCEPT_KEYWORDS.some((kw) => text.includes(kw))) acceptButtons.push(btn);
      else if (CANCEL_KEYWORDS.some((kw) => text.includes(kw))) cancelButtons.push(btn);
    }

    for (const cancelBtn of cancelButtons) {
      const acceptBtn = this.findNearbyButton(cancelBtn, acceptButtons);
      if (!acceptBtn) continue;

      const cancelContrast = getContrastRatio(cancelBtn);
      const acceptContrast = getContrastRatio(acceptBtn);
      const cancelFontSize = parseFloat(getComputedStyle(cancelBtn).fontSize);
      const acceptFontSize = parseFloat(getComputedStyle(acceptBtn).fontSize);
      const cancelOpacity  = parseFloat(getComputedStyle(cancelBtn).opacity);

      // 각 신호를 독립적으로 평가
      const signals: string[] = [];

      if (cancelContrast < CONTRAST_WEAK_THRESHOLD && acceptContrast >= CONTRAST_ACCEPT_THRESHOLD) {
        signals.push(
          `대비율: 취소(${cancelContrast.toFixed(1)}:1) vs 동의(${acceptContrast.toFixed(1)}:1)`,
        );
      }
      if (acceptFontSize > 0 && cancelFontSize < acceptFontSize * FONT_RATIO_THRESHOLD) {
        signals.push(
          `글자 크기: 취소(${cancelFontSize}px) < 동의(${acceptFontSize}px)`,
        );
      }
      if (cancelOpacity < OPACITY_THRESHOLD) {
        signals.push(`불투명도: 취소 버튼 ${(cancelOpacity * 100).toFixed(0)}%`);
      }

      if (signals.length === 0) continue;

      logger.log('DOM:취소버튼약화',
        `cancel="${(cancelBtn.textContent ?? '').trim().slice(0, 30)}" `
        + `accept="${(acceptBtn.textContent ?? '').trim().slice(0, 30)}" `
        + `신호: ${signals.join(' | ')}`);

      detections.push({
        id: generateId(),
        guideline: 9,
        guidelineName: '잘못된 계층구조',
        // 두 가지 이상 신호가 겹치면 medium, 하나면 low
        severity: signals.length >= 2 ? 'medium' : 'low',
        confidence: 'suspicious',
        module: 'dom',
        description:
          '취소/거절 버튼이 동의/확인 버튼에 비해 시각적으로 약화되어 있어 사용자 선택을 유도할 가능성이 있습니다.',
        evidence: {
          type: 'dom_element',
          raw: cancelBtn.outerHTML.slice(0, 300),
          detail: {
            signals,
            cancelText: (cancelBtn.textContent ?? '').trim().slice(0, 50),
            acceptText: (acceptBtn.textContent ?? '').trim().slice(0, 50),
            cancelContrast: parseFloat(cancelContrast.toFixed(2)),
            acceptContrast: parseFloat(acceptContrast.toFixed(2)),
            cancelFontSize,
            acceptFontSize,
            cancelOpacity,
          },
        },
        element: getElementInfo(cancelBtn),
      });
    }

    return detections;
  }

  /**
   * target 버튼 근처에 있는 후보 버튼을 반환.
   * 1) 공통 조상 컨테이너(최대 5단계) 내 동일 그룹 탐색
   * 2) 없으면 뷰포트 거리 300px 이내 최근접 버튼
   */
  private findNearbyButton(target: HTMLElement, candidates: HTMLElement[]): HTMLElement | null {
    // 1) 공통 조상 탐색
    let ancestor: HTMLElement | null = target.parentElement;
    for (let depth = 0; depth < 5 && ancestor; depth++) {
      for (const candidate of candidates) {
        if (ancestor.contains(candidate)) return candidate;
      }
      ancestor = ancestor.parentElement;
    }

    // 2) 뷰포트 좌표 기반 최근접 탐색
    const targetRect = target.getBoundingClientRect();
    let closest: HTMLElement | null = null;
    let minDist = Infinity;

    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      const dx = targetRect.left - rect.left;
      const dy = targetRect.top - rect.top;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist && dist <= 300) {
        minDist = dist;
        closest = candidate;
      }
    }

    return closest;
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
    this.observer = new MutationObserver((mutations) => {
      // 연속 DOM 변경을 debounce하여 과도한 재스캔 방지
      if (this.debounceTimer) clearTimeout(this.debounceTimer);

      const reason = mutations.some((m) => m.type === 'attributes')
        ? 'attribute 변경'
        : '자식 노드 추가/삭제';
      logger.log('MutationObserver', `재스캔 예약 (${reason})`);

      this.debounceTimer = setTimeout(() => this.scan(), 500);
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      // checked 속성 변경(상품 옵션 선택 시)을 감지하기 위해 attribute 감시 추가
      attributes: true,
      attributeFilter: ['checked'],
    });
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

// Phase 1 MVP — DOM Scanner
// 공정위 기준 1(False Urgency), 2(Scarcity), 3(Social Proof) 우선 구현

import type { DarkPatternDetection } from '../types';
import { generateId } from '../utils/id';

export class DOMScanner {
  private observer: MutationObserver | null = null;

  init(): void {
    this.scan();
    this.watchDynamicChanges();
    this.watchSPANavigation();
  }

  private scan(): void {
    const detections: DarkPatternDetection[] = [];
    // TODO: Phase 1 — 각 탐지 메서드 구현
    this.sendToBackground(detections);
  }

  private watchDynamicChanges(): void {
    this.observer = new MutationObserver(() => {
      this.scan();
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

// re-export for test use
export { generateId };

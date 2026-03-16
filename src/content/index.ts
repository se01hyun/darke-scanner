import { DOMScanner } from './dom-scanner';
import { NetworkInterceptor } from './network-interceptor';
import { ScriptAnalyzer } from './script-analyzer';
import { TextCollector } from './text-collector';

const networkInterceptor = new NetworkInterceptor();
const scriptAnalyzer = new ScriptAnalyzer();
const domScanner = new DOMScanner();
const textCollector = new TextCollector();

// NetworkInterceptor는 가장 먼저 주입 (fetch/XHR 오버라이드가 페이지 스크립트보다 앞서야 함)
networkInterceptor.init();

function runScan(): void {
  domScanner.init();
  scriptAnalyzer.analyze();

  // DOM 스캔 완료 후 NLP 텍스트 수집 → Background로 전달
  const payload = textCollector.collect();
  if (
    payload.pageTexts.length > 0 ||
    payload.reviewTexts.length > 0 ||
    payload.ctaTexts.length > 0
  ) {
    chrome.runtime.sendMessage({ type: 'NLP_TEXTS', payload }).catch(() => {
      // Background가 아직 준비 안 됐거나 탭 닫힘 시 무시
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runScan);
} else {
  runScan();
}

// ── SPA 재스캔 ────────────────────────────────────────────────────────────────
// DOMScanner.watchSPANavigation()이 DOM 재스캔을 담당한다.
// 여기서는 NLP 텍스트 재수집만 추가로 처리한다.
// 새 페이지 콘텐츠가 DOM에 반영될 시간을 확보하기 위해 debounce를 적용한다.

let spaDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNlpRescan(): void {
  if (spaDebounceTimer) clearTimeout(spaDebounceTimer);
  spaDebounceTimer = setTimeout(() => {
    const payload = textCollector.collect();
    if (
      payload.pageTexts.length > 0 ||
      payload.reviewTexts.length > 0 ||
      payload.ctaTexts.length > 0
    ) {
      chrome.runtime.sendMessage({ type: 'NLP_TEXTS', payload }).catch(() => {});
    }
  }, 500);
}

const origPushState = history.pushState.bind(history);
history.pushState = (...args: Parameters<typeof history.pushState>) => {
  origPushState(...args);
  scheduleNlpRescan();
};
window.addEventListener('popstate', scheduleNlpRescan);

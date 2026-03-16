import { DOMScanner } from './dom-scanner';
import { NetworkInterceptor } from './network-interceptor';
import { ScriptAnalyzer } from './script-analyzer';

const networkInterceptor = new NetworkInterceptor();
const scriptAnalyzer = new ScriptAnalyzer();
const domScanner = new DOMScanner();

// NetworkInterceptor는 가장 먼저 주입 (fetch/XHR 오버라이드가 페이지 스크립트보다 앞서야 함)
networkInterceptor.init();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    domScanner.init();
    scriptAnalyzer.analyze();
  });
} else {
  domScanner.init();
  scriptAnalyzer.analyze();
}

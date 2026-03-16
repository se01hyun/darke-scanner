/**
 * Network Interceptor — content script
 * page-interceptor.js를 페이지 main world에 주입하고,
 * postMessage로 전달된 API 응답을 background로 중계한다.
 */

import type { NetworkResponsePayload } from '../types';

const MSG_SOURCE = '__dark_scanner_net__';

export class NetworkInterceptor {
  init(): void {
    this.injectPageInterceptor();
    this.listenForResponses();
  }

  /**
   * <script> 태그로 page-interceptor.js를 main world에 주입.
   * chrome.runtime.getURL은 content script에서만 사용 가능하므로 여기서 처리.
   */
  private injectPageInterceptor(): void {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('dist/page-interceptor.js');
    script.onload = () => script.remove(); // 주입 후 DOM에서 제거
    (document.head ?? document.documentElement).prepend(script);
  }

  private listenForResponses(): void {
    window.addEventListener('message', (event) => {
      // 동일 origin의 메시지만 처리
      if (event.source !== window) return;
      if (!event.data || event.data.source !== MSG_SOURCE) return;

      const payload: NetworkResponsePayload = {
        url: event.data.url as string,
        data: event.data.data as Record<string, unknown>,
      };

      chrome.runtime.sendMessage({ type: 'NETWORK_RESPONSE', payload });
    });
  }
}

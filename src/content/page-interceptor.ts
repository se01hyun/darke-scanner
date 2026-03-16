/**
 * Page Interceptor — 페이지 MAIN WORLD에서 실행 (content script와 별도 번들)
 * XHR / fetch 응답을 가로채 stock·viewer 관련 JSON을 content script로 전달한다.
 *
 * 통신 채널: window.postMessage → content script의 message 이벤트
 */

const MSG_SOURCE = '__dark_scanner_net__';

// 서버에서 실시간 수치를 내려보낼 때 흔히 쓰는 키 패턴
const TRACKED_KEY_PATTERNS = [
  'viewer', 'count', 'stock', 'remain', 'inventory', 'real_time', 'realtime',
];

function hasTrackedKey(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((k) =>
    TRACKED_KEY_PATTERNS.some((p) => k.toLowerCase().includes(p))
  );
}

function tryParseJSON(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function postToContentScript(type: string, url: string, data: Record<string, unknown>): void {
  window.postMessage({ source: MSG_SOURCE, type, url, data }, window.location.origin || '*');
}

// ── fetch 오버라이드 ──────────────────────────────────────────────────────────
const originalFetch = window.fetch.bind(window);

window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await originalFetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  response.clone().text().then((text) => {
    const json = tryParseJSON(text);
    if (json && hasTrackedKey(json)) {
      postToContentScript('FETCH_RESPONSE', url, json);
    }
  }).catch(() => { /* 응답 파싱 실패는 무시 */ });

  return response;
};

// ── XMLHttpRequest 오버라이드 ─────────────────────────────────────────────────
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;

type AugmentedXHR = XMLHttpRequest & { _dsUrl?: string };

XMLHttpRequest.prototype.open = function (
  this: AugmentedXHR,
  method: string,
  url: string | URL,
  ...rest: [boolean?, string?, string?]
): void {
  this._dsUrl = url.toString();
  originalOpen.call(this, method, url, rest[0] ?? true, rest[1], rest[2]);
};

XMLHttpRequest.prototype.send = function (this: AugmentedXHR, body?: Document | XMLHttpRequestBodyInit | null): void {
  this.addEventListener('load', function (this: AugmentedXHR) {
    if (this.responseType === '' || this.responseType === 'text') {
      const json = tryParseJSON(this.responseText);
      if (json && hasTrackedKey(json)) {
        postToContentScript('XHR_RESPONSE', this._dsUrl ?? '', json);
      }
    }
  });
  originalSend.call(this, body);
};

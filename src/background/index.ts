import { NetworkSniffer } from './network-sniffer';
import { RuleEngine } from './rule-engine';
import { NLPAnalyzer } from '../nlp/nlp-analyzer';
import type { MessageType, DetectionResult } from '../types';

const ruleEngine = new RuleEngine();
const sniffer = new NetworkSniffer();
const nlpAnalyzer = new NLPAnalyzer();

// 탭 닫힘 시 per-tab 상태 정리 + 배지 초기화
chrome.tabs.onRemoved.addListener((tabId) => {
  sniffer.clearTab(tabId);
  chrome.action.setBadgeText({ text: '', tabId });
});

/** 탭 아이콘 배지를 탐지 건수로 갱신한다. 0건이면 배지를 제거한다. */
function updateBadge(tabId: number, count: number): void {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
  }
}

chrome.runtime.onMessage.addListener(
  (message: MessageType, sender, sendResponse) => {
    const tabId  = sender.tab?.id;
    const tabUrl = sender.tab?.url ?? '';

    if (message.type === 'DOM_DETECTIONS') {
      const networkDetection = tabId !== undefined
        ? sniffer.flagUnconfirmedDOMDetection(tabId)
        : null;

      const allDetections = networkDetection
        ? [...message.payload, networkDetection]
        : message.payload;

      ruleEngine.evaluate(allDetections, tabUrl).then((result) => {
        // 팝업 응답
        sendResponse(result);

        if (tabId === undefined) return;

        // 결과를 탭 세션에 저장 (팝업의 GET_RESULT 조회용)
        chrome.storage.session.set({ [`result:${tabId}`]: result });

        updateBadge(tabId, result.detections.length);

        // 오버레이에 렌더링 지시
        chrome.tabs.sendMessage(tabId, { type: 'SCAN_COMPLETE', payload: result })
          .catch(() => { /* 탭이 닫혔거나 overlay 미로드 시 무시 */ });
      });
      return true;
    }

    if (message.type === 'NETWORK_RESPONSE' && tabId !== undefined) {
      sniffer.onNetworkResponse(message.payload, tabId);
      return false;
    }

    if (message.type === 'SCRIPT_PATTERN') {
      const detection = sniffer.onScriptPattern(message.payload);
      ruleEngine.evaluate([detection], tabUrl).then(sendResponse);
      return true;
    }

    if (message.type === 'GET_RESULT') {
      // 팝업·오버레이 등 tab 컨텍스트가 없는 발신자를 위해
      // 현재 활성 탭의 세션 결과를 조회해 응답한다.
      chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
        const activeTabId = tabs[0]?.id;
        if (activeTabId === undefined) { sendResponse(null); return; }
        const stored = await chrome.storage.session.get(`result:${activeTabId}`);
        const result = (stored[`result:${activeTabId}`] as DetectionResult | undefined) ?? null;
        sendResponse(result);
      });
      return true;
    }

    if (message.type === 'NLP_TEXTS' && tabId !== undefined) {
      nlpAnalyzer.analyze(message.payload).then(async (nlpDetections) => {
        if (nlpDetections.length === 0) { sendResponse(null); return; }

        // 기존 세션 결과와 병합
        const stored = await chrome.storage.session.get(`result:${tabId}`);
        const existing = stored[`result:${tabId}`] as DetectionResult | undefined;

        const allDetections = [
          ...(existing?.detections ?? []),
          ...nlpDetections,
        ];
        // pageUrl: 기존 DOM 스캔 결과에서 이미 설정된 값을 우선 사용
        const merged = await ruleEngine.evaluate(
          allDetections,
          existing?.pageUrl ?? tabUrl,
        );
        // scanTimestamp는 최초 스캔 시각 유지
        if (existing) merged.scanTimestamp = existing.scanTimestamp;

        await chrome.storage.session.set({ [`result:${tabId}`]: merged });
        updateBadge(tabId, merged.detections.length);
        chrome.tabs.sendMessage(tabId, { type: 'SCAN_COMPLETE', payload: merged })
          .catch(() => {});

        sendResponse(merged);
      });
      return true;
    }
  }
);

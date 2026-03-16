import { NetworkSniffer } from './network-sniffer';
import { RuleEngine } from './rule-engine';
import { NLPAnalyzer } from '../nlp/nlp-analyzer';
import type { MessageType, DetectionResult } from '../types';

const ruleEngine = new RuleEngine();
const sniffer = new NetworkSniffer();
const nlpAnalyzer = new NLPAnalyzer();

// 탭 닫힘 시 per-tab 상태 정리
chrome.tabs.onRemoved.addListener((tabId) => sniffer.clearTab(tabId));

chrome.runtime.onMessage.addListener(
  (message: MessageType, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    if (message.type === 'DOM_DETECTIONS') {
      const networkDetection = tabId !== undefined
        ? sniffer.flagUnconfirmedDOMDetection(tabId)
        : null;

      const allDetections = networkDetection
        ? [...message.payload, networkDetection]
        : message.payload;

      ruleEngine.evaluate(allDetections).then((result) => {
        // 팝업 응답
        sendResponse(result);

        if (tabId === undefined) return;

        // 결과를 탭 세션에 저장 (팝업의 GET_RESULT 조회용)
        chrome.storage.session.set({ [`result:${tabId}`]: result });

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
      ruleEngine.evaluate([detection]).then(sendResponse);
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
        const merged = await ruleEngine.evaluate(allDetections);
        // pageUrl / scanTimestamp는 기존 값 유지
        if (existing) {
          merged.pageUrl = existing.pageUrl;
          merged.scanTimestamp = existing.scanTimestamp;
        }

        await chrome.storage.session.set({ [`result:${tabId}`]: merged });
        chrome.tabs.sendMessage(tabId, { type: 'SCAN_COMPLETE', payload: merged })
          .catch(() => {});

        sendResponse(merged);
      });
      return true;
    }
  }
);

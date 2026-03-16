import { NetworkSniffer } from './network-sniffer';
import { RuleEngine } from './rule-engine';
import type { MessageType } from '../types';

const ruleEngine = new RuleEngine();
const sniffer = new NetworkSniffer();

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
  }
);

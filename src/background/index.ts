import { NetworkSniffer } from './network-sniffer';
import { RuleEngine } from './rule-engine';
import { NLPAnalyzer } from '../nlp/nlp-analyzer';
import type { MessageType, DetectionResult, DarkPatternDetection, ReviewCluster } from '../types';
import { logger } from '../utils/debug-logger';

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
  logger.log('Badge', `tabId=${tabId} count=${count}`);
}

chrome.runtime.onMessage.addListener(
  (message: MessageType, sender, sendResponse) => {
    const tabId  = sender.tab?.id;
    const tabUrl = sender.tab?.url ?? '';

    if (message.type === 'DOM_DETECTIONS') {
      logger.log('BG', `DOM_DETECTIONS 수신 — tabId=${tabId} url=${tabUrl} 건수=${message.payload.length}`);

      // ── 무한 스크롤 / 재스캔 시 NLP 탐지 결과 보존 ────────────────────────
      // DOM 재스캔 때마다 기존 세션을 완전히 덮어쓰면 NLP 결과가 소실된다.
      // 동일 URL에서 온 재스캔이면 기존 NLP 탐지만 꺼내 병합한다.
      // URL이 달라지면(SPA 네비게이션) NLP 포함 전체를 초기화한다.
      (async () => {
        let existingNlpDetections: DarkPatternDetection[] = [];
        if (tabId !== undefined) {
          const stored = await chrome.storage.session.get(`result:${tabId}`);
          const existing = stored[`result:${tabId}`] as DetectionResult | undefined;
          if (existing?.pageUrl === tabUrl) {
            existingNlpDetections = existing.detections.filter((d) => d.module === 'nlp');
            if (existingNlpDetections.length > 0) {
              logger.log('BG', `기존 NLP 탐지 ${existingNlpDetections.length}건 보존 (동일 URL 재스캔)`);
            }
          } else if (existing) {
            logger.log('BG', `URL 변경 감지 — 이전 결과 초기화 (${existing.pageUrl} → ${tabUrl})`);
          }
        }

        const networkDetection = tabId !== undefined
          ? sniffer.flagUnconfirmedDOMDetection(tabId)
          : null;

        const allDetections: DarkPatternDetection[] = [
          ...(networkDetection ? [...message.payload, networkDetection] : message.payload),
          ...existingNlpDetections,
        ];

        return ruleEngine.evaluate(allDetections, tabUrl);
      })().then((result) => {
        // 팝업 응답
        sendResponse(result);

        if (tabId === undefined) return;

        logger.log('BG', `최종 결과 저장 — ${result.detections.length}건 (risk=${result.overallRiskScore})`);

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
      const dripDetection = sniffer.onNetworkResponse(message.payload, tabId);
      logger.log('BG', `NETWORK_RESPONSE 수신 — url=${message.payload.url} drip=${dripDetection !== null}`);

      if (dripDetection !== null) {
        // 순차공개 가격 탐지 결과를 기존 세션 결과에 병합
        chrome.storage.session.get(`result:${tabId}`).then(async (stored) => {
          const existing = stored[`result:${tabId}`] as DetectionResult | undefined;
          const allDetections: DarkPatternDetection[] = [
            ...(existing?.detections ?? []),
            dripDetection,
          ];
          const merged = await ruleEngine.evaluate(allDetections, existing?.pageUrl ?? tabUrl);
          if (existing) merged.scanTimestamp = existing.scanTimestamp;
          await chrome.storage.session.set({ [`result:${tabId}`]: merged });
          updateBadge(tabId, merged.detections.length);
          chrome.tabs.sendMessage(tabId, { type: 'SCAN_COMPLETE', payload: merged }).catch(() => {});
        });
      }
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
      logger.log('BG', `NLP_TEXTS 수신 — tabId=${tabId} pageTexts=${message.payload.pageTexts.length} reviews=${message.payload.reviewTexts.length} cta=${message.payload.ctaTexts.length}`);
      nlpAnalyzer.analyze(message.payload).then(async ({ detections: nlpDetections, reviewClusters }) => {
        logger.log('BG', `NLP 분석 완료 — ${nlpDetections.length}건 탐지, 클러스터 ${reviewClusters.length}개`);
        if (nlpDetections.length === 0 && reviewClusters.length === 0) { sendResponse(null); return; }

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

        // 리뷰 클러스터: 새로 탐지된 것과 기존 것 중 더 많은 쪽 유지
        const prevClusters: ReviewCluster[] = existing?.reviewClusters ?? [];
        merged.reviewClusters = reviewClusters.length > 0 ? reviewClusters : prevClusters;

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

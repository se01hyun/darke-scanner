// 공정위 다크 패턴 가이드라인 번호 (1~19)
export type GuidelineNumber = 1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19;

export type Severity   = 'low' | 'medium' | 'high';
export type Confidence = 'confirmed' | 'suspicious';
export type Module     = 'dom' | 'nlp' | 'network';
export type EvidenceType = 'dom_element' | 'text_analysis' | 'network_analysis' | 'script_pattern';

export interface ElementInfo {
  xpath: string;
  boundingRect: { top: number; left: number; width: number; height: number };
  outerHTML: string;
}

export interface Evidence {
  type: EvidenceType;
  raw: string;
  detail: Record<string, unknown>;
}

export interface DarkPatternDetection {
  id: string;
  guideline: GuidelineNumber;
  guidelineName: string;
  severity: Severity;
  confidence: Confidence;
  module: Module;
  description: string;
  evidence: Evidence;
  element?: ElementInfo;
}

export interface DetectionResult {
  pageUrl: string;
  scanTimestamp: number;
  overallRiskScore: number; // 0~100
  detections: DarkPatternDetection[];
  reviewClusters?: ReviewCluster[]; // 가짜 리뷰 의심 클러스터 (NLP 분석 결과)
}

// NLP
export interface ReviewCluster {
  reviews: string[];
  avgSimilarity: number;
  isSuspicious: boolean; // 코사인 유사도 임계값(0.85) 초과 여부
}

export interface NLPResult {
  pressureScore: number; // 심리적 압박 지수 0~100
  fomoKeywords: string[];
  reviewClusters: ReviewCluster[];
}

// NLPAnalyzer.analyze() 반환 타입
export interface NLPAnalysisResult {
  detections: DarkPatternDetection[];
  reviewClusters: ReviewCluster[];
}

// 페이지 main world → content script postMessage 페이로드
export interface NetworkResponsePayload {
  url: string;
  data: Record<string, unknown>;
}

export interface ScriptPatternPayload {
  src: string;         // 스크립트 출처 (inline | URL)
  snippet: string;     // 탐지된 코드 스니펫 (≤300자)
  patternType: 'random_counter' | 'timer_reset';
}

// NLP 텍스트 수집 단위: 텍스트 + 출처 요소 XPath
export interface NLPTextItem {
  text: string;
  xpath: string;
}

// NLP 텍스트 수집 페이로드
export interface NLPTextsPayload {
  pageTexts: NLPTextItem[];   // 상품명·설명·팝업 등 일반 텍스트
  reviewTexts: NLPTextItem[]; // 리뷰/후기 텍스트
  ctaTexts: NLPTextItem[];    // CTA 버튼·링크 텍스트
}

// 모듈 간 메시지 타입
export type MessageType =
  | { type: 'DOM_DETECTIONS';      payload: DarkPatternDetection[] }
  | { type: 'NETWORK_RESPONSE';    payload: NetworkResponsePayload }
  | { type: 'SCRIPT_PATTERN';      payload: ScriptPatternPayload }
  | { type: 'NLP_TEXTS';           payload: NLPTextsPayload }
  | { type: 'SCAN_COMPLETE';       payload: DetectionResult }
  | { type: 'GET_RESULT';          payload: { url: string } }
  | { type: 'RESULT_RESPONSE';     payload: DetectionResult | null }
  | { type: 'SCROLL_TO_ELEMENT';   payload: { xpath: string } };

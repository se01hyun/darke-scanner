# Dark-Scanner PRD (Product Requirements Document)

**Version:** 1.0
**Date:** 2026-03-16
**Project:** Dark-Scanner — 브라우저 내 실시간 다크 패턴 탐지 확장 프로그램

---

## 1. 개요 (Overview)

### 1.1 배경 및 목적

온라인 쇼핑 플랫폼에서 소비자의 합리적 의사결정을 방해하는 **다크 패턴(Dark Pattern)**이 사회적 문제로 대두되고 있다. 기존 사용자는 "지금 15명이 이 상품을 보고 있습니다", "마감 임박 00:05" 같은 문구가 실제 서버 데이터 기반인지, 클라이언트에서 생성된 가짜 스크립트인지 구별할 수 없다.

**Dark-Scanner**는 브라우저 확장 프로그램 형태로 작동하여, 대한민국 공정거래위원회(공정위)의 **온라인 다크 패턴 19가지 가이드라인**을 판별 기준으로 삼아 페이지를 실시간 분석하고, 탐지된 다크 패턴을 사용자에게 시각적으로 경고한다.

### 1.2 타겟 사용자

- 온라인 쇼핑몰 이용 소비자 (일반 대중)
- 소비자 권익 보호에 관심 있는 사용자
- UI/UX 연구자, 저널리스트, 공정위 대응 업무 담당자

### 1.3 지원 환경

- **브라우저:** Chrome (Manifest V3), Edge (Chromium 기반)
- **언어:** 한국어 웹페이지 우선 지원 (다국어 확장 예정)
- **플랫폼:** Windows, macOS, Linux

---

## 2. 판별 기준: 공정위 온라인 다크 패턴 19가지 가이드라인

Dark-Scanner의 탐지 엔진은 공정위가 고시한 아래 19가지 유형을 기준으로 설계된다.

| No. | 유형명 | 탐지 모듈 |
|-----|--------|-----------|
| 1  | 숨은 갱신 (자동갱신·자동결제 미고지) | NLP |
| 2  | 순차공개 가격책정 (Drip Pricing) | Network |
| 3  | 몰래 장바구니 추가 | DOM |
| 4  | 거짓할인 (원가 없는 할인율 표시) | DOM |
| 5  | 거짓추천 (가짜 리뷰 클러스터) | NLP |
| 6  | 유인판매 | DOM |
| 7  | 위장광고 (광고 고지 누락) | DOM |
| 8  | 속임수 질문 (이중부정 동의 유도) | NLP |
| 9  | 잘못된 계층구조 (취소 버튼 시각적 약화) | DOM |
| 10 | 특정옵션의 사전선택 | DOM |
| 11 | 취소·탈퇴 등의 방해 | DOM |
| 12 | 숨겨진 정보 (중요 약관 극소 폰트) | DOM |
| 13 | 가격비교 방해 | DOM |
| 14 | 클릭 피로감 유발 | DOM |
| 15 | 반복간섭 (마케팅 팝업 반복 노출) | DOM |
| 16 | 감정적 언어사용 (Confirmshaming) | NLP |
| 17 | 시간제한 알림 (허위 카운트다운) | DOM |
| 18 | 낮은 재고 알림 (허위 품절 임박) | DOM |
| 19 | 다른 소비자의 활동 알림 (허위 실시간 수치) | Network |

---

## 3. 핵심 기능 요구사항 (Functional Requirements)

### 3.1 모듈 아키텍처

```
Dark-Scanner
├── DOM Pattern Scanner        (Module 1)
├── NLP Analyzer               (Module 2)
├── Network Sniffer            (Module 3)
└── Report UI / Alert Layer    (Module 4)
```

---

### Module 1: DOM Pattern Scanner

**목적:** 페이지 로드 및 DOM 변경 시 HTML 구조를 분석하여 다크 패턴 요소를 탐지한다.

**기능 요구사항:**

| ID | 요구사항 |
|----|---------|
| DOM-01 | 페이지 로드 완료(DOMContentLoaded) 시 전체 DOM 트리 스캔 실행 |
| DOM-02 | MutationObserver를 통해 동적으로 삽입되는 요소(카운트다운, 팝업 등) 실시간 감지 |
| DOM-03 | 카운트다운 타이머 (`<timer>`, `data-countdown`, CSS animation 기반) 요소 탐지 |
| DOM-04 | 허위 재고 경고 문구 컴포넌트 (`"품절 임박"`, `"1개 남음"` 등) 탐지 |
| DOM-05 | 기본값으로 체크된 추가 상품·보험·구독 옵션 탐지 (공정위 기준 5, 11, 17번) |
| DOM-06 | 시각적으로 약화된 거절 버튼 탐지 (색상 대비, 폰트 크기 비교 알고리즘 적용) |
| DOM-07 | "광고" 레이블 없이 콘텐츠처럼 삽입된 광고 블록 탐지 (공정위 기준 9번) |
| DOM-08 | Confirmshaming 문구 패턴 탐지 ("아니요, 저는 ~" 형태) |
| DOM-09 | 탐지 결과를 요소 단위로 좌표·XPath·유형 정보와 함께 저장 |

**기술 스택:** TypeScript, Chrome Extension Content Script, MutationObserver API

---

### Module 2: NLP Analyzer

**목적:** Transformer 기반 한국어 NLP 모델로 텍스트의 심리적 압박 지수를 정량화하고, 가짜 리뷰를 탐지한다.

**기능 요구사항:**

| ID | 요구사항 |
|----|---------|
| NLP-01 | 페이지 내 주요 텍스트(상품명, 설명, CTA 버튼, 팝업 문구) 추출 |
| NLP-02 | FOMO 유발 어휘(자극적 형용사, 압박형 어미) 추출 및 **심리적 압박 지수(0~100)** 산출 |
| NLP-03 | 리뷰 텍스트 수집 후 코사인 유사도(Cosine Similarity) 분석으로 반복 패턴 탐지 |
| NLP-04 | 유사도 임계값(기본 0.85) 이상의 리뷰 그룹을 가짜 리뷰 의심 클러스터로 분류 |
| NLP-05 | 분석 결과를 JSON 형태로 직렬화하여 Report UI에 전달 |
| NLP-06 | 모델 추론은 브라우저 내 WASM(onnxruntime-web) 또는 백그라운드 서비스 워커에서 실행 (서버 전송 불가 — 개인정보 보호) |
| NLP-07 | 모델: KoELECTRA 또는 KR-FinBert 계열의 경량 모델(≤50MB) 사용 |

**분석 전략: Hybrid 방식 (2-Pass)**

KoELECTRA 모델의 첫 로딩 레이턴시와 용량 문제를 완화하기 위해 두 단계로 처리한다.

```
1단계 — 키워드 사전 매칭 (즉시, ~0ms)
  FOMO 어휘 사전(JSON)을 통해 명백한 패턴을 즉시 탐지.
  히트 발생 시에만 2단계로 전달.

2단계 — NLP 문맥 분석 (비동기, Web Worker)
  1단계를 통과한 텍스트에 대해서만 Transformer 모델로
  문맥을 고려한 최종 압박 지수를 산출.
```

| NLP-08 | 1단계 키워드 사전은 확장 프로그램 업데이트 없이 원격 JSON으로 갱신 가능 |
| NLP-09 | 1단계 히트가 없는 텍스트는 NLP 추론을 건너뜀 (성능 최적화) |

**FOMO 지수 계산 예시:**
```
압박 지수 = (FOMO 키워드 밀도 × 0.4) + (압박형 어미 비율 × 0.3) + (긴급성 표현 수 × 0.3)
```

**기술 스택:** onnxruntime-web, KoELECTRA ONNX 변환 모델, Web Worker

---

### Module 3: Network Sniffer

**목적:** 브라우저의 네트워크 요청을 가로채 "실시간 인원 수", "재고 수" 등이 실제 서버 데이터인지, 클라이언트에서 조작된 값인지 판별한다.

**구현 우선순위:**
- **1안 (기본):** `chrome.webRequest`로 응답 로그를 비동기 수집 후 화면 수치와 매칭. MV3에서 안전하게 동작하며 UX 저하 없음.
- **2안 (고급 모드):** 사용자가 명시적으로 활성화할 경우 `chrome.debugger` API 사용. 브라우저 상단에 "디버깅 중" 알림이 표시되므로 기본값 비활성화.

#### 3.1 Network 요청 분석 (진짜 데이터 확인)

| ID | 요구사항 |
|----|---------|
| NET-01 | `chrome.webRequest` API로 모든 XHR/Fetch 요청을 모니터링 (1안 기본 적용) |
| NET-02 | 응답 JSON에서 `viewer_count`, `stock`, `remain`, `real_time` 등 의미론적 키워드 포함 여부 확인 |
| NET-03 | 화면에 표시된 인원·재고 수치와 서버 응답값의 일치 여부 비교 |
| NET-04 | 서버 통신 없이 숫자가 변하는 경우 → **"서버 데이터 미확인"** 플래그 발행 |

#### 3.2 JavaScript 소스 분석 (조작 로직 탐지)

| ID | 요구사항 |
|----|---------|
| NET-05 | 페이지 내 인라인 스크립트 및 로드된 JS 파일에서 `Math.random()`, `setInterval`, `setTimeout`과 카운터 변수의 연관 패턴 탐지 |
| NET-06 | 아래 패턴 발견 시 **"클라이언트 난수 조작 확인됨"** 으로 판정 |
| NET-07 | 탐지된 코드 스니펫(파일명, 라인 번호)을 증거로 Report UI에 첨부 |

**탐지 대상 코드 패턴 예시:**
```javascript
// 패턴 1: 난수로 카운터 증가
setInterval(() => { count += Math.floor(Math.random() * 3); }, 1000);

// 패턴 2: 재고를 임의로 감소
setTimeout(() => { stock = Math.max(1, stock - Math.ceil(Math.random() * 2)); }, 2000);

// 패턴 3: 타이머 반복 리셋
if (timer <= 0) timer = initialTime; // 카운트다운이 0이 되면 초기화
```

**기술 스택:** Chrome Extension Background Service Worker, `chrome.webRequest`, `chrome.debugger` (옵션), JS AST 파싱 (acorn/esprima WASM 빌드)

---

### Module 4: Report UI / Alert Layer

**목적:** 탐지 결과를 사용자에게 직관적이고 비침습적으로 전달한다.

| ID | 요구사항 |
|----|---------|
| UI-01 | 툴바 아이콘에 탐지된 다크 패턴 수 배지(badge) 표시 |
| UI-02 | 팝업 창에서 탐지 항목 리스트 및 공정위 기준 번호 매핑 표시 |
| UI-03 | 해당 DOM 요소에 오버레이(하이라이트 + 툴팁) 표시 — 사용자 비활성화 가능 |
| UI-04 | 각 탐지 항목에 대한 설명, 심각도(낮음/중간/높음), 확신도(확정/의심) 배지, 근거 데이터 표시 |
| UI-05 | "공정위 기준 보기" 링크로 원문 가이드라인 연결 |
| UI-06 | 가짜 리뷰 클러스터 시각화 (유사도 히트맵 또는 그룹 목록) |
| UI-07 | 네트워크 분석 결과 — 진짜/가짜 여부 판정 배지 표시 |
| UI-08 | 탐지 결과 JSON 내보내기 기능 (제보·연구 목적) |
| UI-09 | 페이지별 다크 패턴 점수(0~100) 종합 표시 ("다크 패턴 위험도") |

---

## 4. 비기능 요구사항 (Non-Functional Requirements)

| 항목 | 요구사항 |
|------|---------|
| **성능** | 일반 페이지에서 DOM 스캔 완료까지 ≤500ms |
| **프라이버시** | 수집된 텍스트·네트워크 데이터는 외부 서버로 전송하지 않음. 모든 분석은 로컬(브라우저) 내에서 처리 |
| **보안** | Content Security Policy(CSP) 준수. 외부 스크립트 인젝션 없음 |
| **크기** | 확장 프로그램 총 용량 ≤100MB (NLP 모델 포함) |
| **호환성** | Chrome 120+, Edge 120+ |
| **접근성** | 탐지 오버레이는 스크린 리더와 충돌하지 않도록 ARIA 속성 준수 |
| **업데이트** | 다크 패턴 규칙셋(패턴 DB)은 확장 프로그램 업데이트 없이 원격 JSON으로 갱신 가능 |

---

## 5. 시스템 아키텍처 (System Architecture)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser Tab (Page)                        │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Content Script                         │   │
│  │  ┌─────────────────┐    ┌─────────────────────────────┐  │   │
│  │  │  DOM Scanner    │    │   JS Source Analyzer        │  │   │
│  │  │  (MutationObs.) │    │   (Inline Script Parser)    │  │   │
│  │  └────────┬────────┘    └──────────────┬──────────────┘  │   │
│  │           │                             │                  │   │
│  │  ┌────────▼─────────────────────────────▼──────────────┐  │   │
│  │  │              Message Bridge (chrome.runtime)         │  │   │
│  │  └────────────────────────┬───────────────────────────┘  │   │
│  └───────────────────────────│──────────────────────────────┘   │
│                               │                                   │
└───────────────────────────────│───────────────────────────────────┘
                                │
┌───────────────────────────────▼───────────────────────────────────┐
│                    Background Service Worker                        │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
│  │  Network Sniffer │  │   NLP Analyzer   │  │  Rule Engine   │   │
│  │ (webRequest API) │  │ (onnxruntime-web)│  │ (Pattern DB)   │   │
│  └──────────┬───────┘  └────────┬─────────┘  └───────┬────────┘   │
│             └──────────────────┬┘                     │            │
│                                ▼                       │            │
│                    ┌───────────────────────┐           │            │
│                    │   Analysis Aggregator  │◄──────────┘            │
│                    └───────────┬───────────┘                        │
└────────────────────────────────│────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│                         Extension UI                                  │
│                                                                        │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │ Toolbar Badge│  │   Popup Report   │  │  Page Overlay        │   │
│  │ (count badge)│  │ (결과 목록+점수) │  │ (DOM 요소 하이라이트)│   │
│  └──────────────┘  └──────────────────┘  └──────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. 데이터 모델 (Data Model)

### 6.1 탐지 결과 (Detection Result)

```typescript
interface DetectionResult {
  pageUrl: string;
  scanTimestamp: number;
  overallRiskScore: number;            // 0~100: 다크 패턴 종합 위험도
  detections: DarkPatternDetection[];
  reviewClusters?: ReviewCluster[];    // 가짜 리뷰 의심 클러스터 (NLP 분석 시 채워짐)
}

interface DarkPatternDetection {
  id: string;                          // UUID
  guideline: number;                   // 공정위 기준 번호 (1~19)
  guidelineName: string;               // 유형명
  severity: 'low' | 'medium' | 'high';
  confidence: 'confirmed' | 'suspicious';  // 탐지 확신도 — UI에서 등급 구분 표시용
  module: 'dom' | 'nlp' | 'network';
  description: string;                 // 사용자에게 표시할 설명
  evidence: Evidence;
  element?: ElementInfo;               // DOM 요소 위치 (해당 시)
}

interface Evidence {
  type: 'dom_element' | 'text_analysis' | 'network_analysis' | 'script_pattern';
  raw: string;                         // 원본 데이터 (HTML, 텍스트, 코드 스니펫)
  detail: Record<string, unknown>;     // 모듈별 추가 데이터
}

interface ElementInfo {
  xpath: string;
  boundingRect: { top: number; left: number; width: number; height: number };
  outerHTML: string;
}
```

### 6.2 NLP 분석 결과

```typescript
// 내부 압박 지수 계산 결과
interface NLPResult {
  pressureScore: number;               // 심리적 압박 지수 (0~100)
  fomoKeywords: string[];              // 탐지된 FOMO 유발 어휘
  reviewClusters: ReviewCluster[];     // 가짜 리뷰 의심 클러스터
}

interface ReviewCluster {
  reviews: string[];
  avgSimilarity: number;               // 평균 코사인 유사도
  isSuspicious: boolean;               // 임계값(0.85) 초과 여부
}

// NLPAnalyzer.analyze() 반환 타입 — detections와 reviewClusters를 함께 반환
interface NLPAnalysisResult {
  detections: DarkPatternDetection[];  // 탐지된 다크 패턴 목록
  reviewClusters: ReviewCluster[];     // 가짜 리뷰 의심 클러스터
}
```

---

## 7. 개발 단계 (Milestones)

| 단계 | 내용 | 산출물 |
|------|------|--------|
| **Phase 1** ✅ | 프로젝트 셋업 + DOM Scanner MVP | 기본 다크 패턴(카운트다운, 재고 경고) 탐지 동작 |
| **Phase 2** ✅ | Network Sniffer 구현 | 가짜 실시간 데이터 판별 기능 |
| **Phase 3** ✅ | NLP Analyzer 통합 | FOMO 지수 + 가짜 리뷰 탐지, KoELECTRA ONNX 인프라 |
| **Phase 4** ✅ | Report UI 완성 | 오버레이, 팝업, 배지, 가짜 리뷰 클러스터 시각화(UI-06) |
| **Phase 5** | QA + 공정위 기준 19가지 전체 커버리지 검증 | 탐지율·오탐율 측정 보고서 |
| **Phase 6** | Chrome Web Store 배포 준비 | 스토어 등록, 개인정보처리방침 작성 |

---

## 8. 성공 지표 (Success Metrics)

| 지표 | 목표값 |
|------|--------|
| 공정위 19가지 기준 커버리지 | ✅ 100% (19/19 달성) |
| DOM 스캔 오탐율(False Positive) | ≤10% |
| NLP 가짜 리뷰 탐지 정확도 | ≥80% (F1 Score 기준) |
| 페이지 로드 성능 저하 | ≤200ms 추가 지연 |
| Chrome Web Store 평점 | ≥4.0 / 5.0 |

---

## 9. 리스크 및 제약 사항

| 리스크 | 내용 | 완화 방안 |
|--------|------|-----------|
| Chrome MV3 제약 | `chrome.webRequest` blocking 기능 MV3에서 제한됨 | `declarativeNetRequest` + `chrome.debugger` API 조합 사용 검토 |
| NLP 모델 크기 | 한국어 Transformer 모델이 100MB를 초과할 수 있음 | 양자화(Quantization) 및 Distillation 적용한 경량 ONNX 모델 사용 |
| 동적 DOM 탐지 한계 | SPA(React, Vue)에서 라우팅 시 재스캔 필요 | History API 변경 감지 후 재스캔 트리거 |
| 법적 리스크 | 특정 사이트를 "다크 패턴 사이트"로 명시하는 경우 분쟁 가능성 | 탐지 결과는 공정위 기준 기반 자동 분석임을 명시하고, 최종 판단은 사용자에게 귀속 |
| 오탐(False Positive) | 정상적인 긴급성 문구를 다크 패턴으로 오인 | 임계값 조정 가능하도록 사용자 설정 제공 |

---

## 10. 참고 문서

- 공정거래위원회 「온라인 다크 패턴 자율 관리 가이드라인」
- Chrome Extension Manifest V3 공식 문서
- KoELECTRA: Pre-trained Electra Model for Korean (Monologg, GitHub)
- ONNX Runtime Web 공식 문서
- Princeton Web Transparency & Accountability Project — Dark Patterns at Scale (2019)

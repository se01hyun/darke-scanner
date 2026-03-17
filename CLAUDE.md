# Dark-Scanner — CLAUDE.md

브라우저 확장 프로그램 형태의 실시간 다크 패턴 탐지 도구.
공정거래위원회 온라인 다크 패턴 19가지 가이드라인을 판별 기준으로 삼는다.
전체 요구사항은 `docs/PRD.md`를 참조.

---

## 프로젝트 구조

```
dark-scanner/
├── src/
│   ├── content/          # Content Script (DOM Scanner, JS Source Analyzer)
│   ├── background/       # Background Service Worker (Network Sniffer, NLP Analyzer, Rule Engine)
│   ├── popup/            # Extension Popup UI
│   ├── overlay/          # Page Overlay (DOM 하이라이트 + 툴팁)
│   ├── nlp/              # NLP 관련 (모델 로더, 키워드 사전, Web Worker)
│   └── types/            # 공유 TypeScript 인터페이스
├── models/               # ONNX 모델 파일 (KoELECTRA quantized)
├── rules/                # 공정위 19가지 기준 규칙셋 JSON
├── docs/
│   └── PRD.md
└── manifest.json         # Chrome Extension Manifest V3
```

---

## 아키텍처 원칙

### 레이어 분리
- **Content Script** → DOM 접근만 담당. 무거운 연산은 절대 수행하지 않는다.
- **Background Service Worker** → NLP 추론, 네트워크 분석, 규칙 평가 등 모든 연산 담당.
- **Popup / Overlay** → 표시 전용. 분석 로직 포함 금지.
- 레이어 간 통신은 `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`만 사용한다.

### 프라이버시 원칙 (절대 준수)
- 수집된 텍스트, DOM 데이터, 네트워크 응답을 **외부 서버로 전송하지 않는다.**
- 모든 분석은 로컬(브라우저) 내에서 완결된다.
- NLP 모델 추론은 Web Worker 또는 Background Service Worker에서만 실행한다.

---

## 탐지 모듈별 개발 지침

### Module 1: DOM Scanner (`src/content/`)
- `DOMContentLoaded` 시 전체 스캔, 이후 `MutationObserver`로 동적 변경 감지.
- SPA 대응: `history.pushState` / `popstate` 이벤트 감지 후 재스캔 트리거.
- 탐지 결과는 `DarkPatternDetection` 인터페이스로 직렬화하여 Background로 전달.
- **텍스트 노드 순회(`makeTextWalker`):** 모든 TreeWalker는 반드시 `makeTextWalker()` 헬퍼를 사용한다. `SCRIPT` / `STYLE` / `NOSCRIPT` / `TEMPLATE` 내부 텍스트를 NodeFilter 단계에서 거부하여 Next.js 번들 등 비가시 텍스트 오탐을 방지한다. TreeWalker를 직접 생성하는 것은 금지한다.
- **입력 요소 가시성 체크:** 사전선택(기준 3·10) 탐지 시 `getBoundingClientRect()`로 `width === 0 && height === 0`인 요소를 건너뛴다. 렌더링되지 않은 숨겨진 라디오·체크박스(템플릿, 비활성 옵션 등)의 오탐을 방지한다.
- **중복 제거:** `deduplicateOverlapping()`은 두 단계로 중복을 제거한다.
  1. 조상-자손 관계: 동일 가이드라인의 자손 요소는 제거하고 가장 바깥쪽 하나만 유지.
  2. 근접 형제 관계: LCA(최근 공통 조상)가 양쪽으로부터 3단계 이내인 경우(`isCloseRelative`), 렌더 면적이 작은 쪽을 제거. 같은 UI 컴포넌트 안에서 여러 선택자가 겹쳐 발생하는 배지 중복 방지.
- **위장광고 고지 확인(`getAdDisclosureArea`):** 인접 요소의 **직계 텍스트 노드**만 검사한다(shallow text). 깊이 중첩된 텍스트를 포함하면 다른 광고 요소 내부의 "광고" 레이블이 원거리 요소의 정상 고지로 오인되는 오탐이 발생한다.

### Module 2: NLP Analyzer (`src/nlp/`, `src/background/`)
- **반드시 Hybrid 2-Pass 방식을 따른다.**
  1. 키워드 사전(`rules/fomo-keywords.json`) 매칭 → 히트 없으면 NLP 건너뜀.
  2. 히트 발생 시에만 Web Worker에서 KoELECTRA ONNX 모델 추론.
- 키워드 사전은 원격 JSON으로 갱신 가능하도록 fetch + 로컬 캐시 구조를 유지한다.
- 원격 규칙셋 fetch 시 JSON 스키마 검증(필드 구조 확인) + 버전/해시 검증을 반드시 수행한다. HTTPS 고정 도메인에서만 fetch하며, 검증 실패 시 로컬 캐시를 유지한다.
- 모델 파일은 `models/` 디렉터리에 위치하며 총 용량 ≤50MB를 유지한다.
- **WASM 실행 폴백:** MV3 Service Worker에서 `onnxruntime-web` 실행이 막힐 경우(SharedArrayBuffer 미지원 등) `chrome.offscreen` API를 통한 Offscreen Document로 대체한다.
- **텐서 피드 생성:** KoELECTRA 입력 텐서(`input_ids`, `attention_mask`, `token_type_ids`) 생성은 `src/nlp/onnx-utils.ts`의 `buildFeeds()`를 사용한다. `onnx-session.ts`와 `offscreen-nlp.ts` 두 컨텍스트에서 공유하며, 중복 구현 금지.

### Module 3: Network Sniffer (`src/background/`)
- **1안(기본):** `chrome.webRequest` 응답 로그 비동기 수집 후 화면 수치와 매칭.
- **2안(고급 모드):** `chrome.debugger` API는 사용자가 명시적으로 활성화할 때만 사용. 기본값은 비활성화.
- JS 소스 분석(AST 파싱)은 acorn 또는 esprima WASM 빌드를 사용한다.
- **기준 19 서버 미확인 탐지(`flagUnconfirmedDOMDetection`):** DOM 스캐너가 기준 19 패턴(`guideline === 19 && module === 'dom'`)을 먼저 탐지했을 때만 호출한다. 실시간 수치가 없는 페이지에서 무조건 발화하는 오탐을 방지하기 위해 `background/index.ts`의 `hasDomSocialProof` 가드가 선행 조건이다.

### Module 4: Report UI (`src/popup/`, `src/overlay/`)
- 오버레이는 기존 페이지 레이아웃을 절대 깨지 않아야 한다. Shadow DOM을 사용한다.
- 탐지 항목 표시 시 `severity`(심각도)와 `confidence`(확신도)를 반드시 함께 표시한다.
- `confidence: 'suspicious'`인 항목은 "의심" 배지로, `'confirmed'`는 "확정" 배지로 구분한다.
- 가짜 리뷰 클러스터(`DetectionResult.reviewClusters`)가 존재하면 팝업 탐지 목록 아래에 클러스터별 유사도 바·샘플 리뷰 목록을 렌더링한다 (UI-06).

---

## 데이터 모델 핵심 인터페이스

모든 탐지 결과는 아래 인터페이스를 따른다. 임의로 필드를 추가하거나 생략하지 않는다.

```typescript
interface DarkPatternDetection {
  id: string;
  guideline: number;                        // 공정위 기준 번호 (1~19)
  guidelineName: string;
  severity: 'low' | 'medium' | 'high';
  confidence: 'confirmed' | 'suspicious';   // 두 축은 독립적으로 유지
  module: 'dom' | 'nlp' | 'network';
  description: string;
  evidence: Evidence;
  element?: ElementInfo;
}

interface DetectionResult {
  pageUrl: string;
  scanTimestamp: number;
  overallRiskScore: number;                 // 0~100
  detections: DarkPatternDetection[];
  reviewClusters?: ReviewCluster[];         // 가짜 리뷰 의심 클러스터 (NLP 분석 시 채워짐)
}

// NLPAnalyzer.analyze() 반환 타입
interface NLPAnalysisResult {
  detections: DarkPatternDetection[];
  reviewClusters: ReviewCluster[];
}
```

---

## 코드 컨벤션

- **언어:** TypeScript strict mode. `any` 사용 금지.
- **모듈 시스템:** ES Modules (`import`/`export`). CommonJS 혼용 금지.
- **비동기:** `async/await` 사용. Promise chain(`.then`) 지양.
- **파일명:** 모듈명은 kebab-case (`dom-scanner.ts`, `nlp-analyzer.ts`).
- **인터페이스:** `src/types/` 아래 중앙 관리. 모듈 내 로컬 타입 정의 금지.

---

## 성능 제약

| 항목 | 제한 |
|------|------|
| DOM 스캔 완료 | ≤500ms |
| 페이지 로드 추가 지연 | ≤200ms |
| 확장 프로그램 총 용량 | ≤100MB |
| NLP 모델 단독 용량 | ≤50MB |

성능 제약을 초과하는 구현은 반드시 대안을 먼저 검토한다.

---

## Manifest V3 제약 주의사항

- `chrome.webRequest`는 MV3에서 **읽기 전용**이다. 요청을 차단(block)하거나 수정(modify)하지 않는다.
- Background는 **Service Worker**다. 전역 변수로 상태를 유지하지 않는다. 상태는 `chrome.storage.session` 또는 `chrome.storage.local`에 저장한다.
- `chrome.debugger`는 사용자 동의 없이 기본 활성화하지 않는다.
- WASM 실행이 Service Worker에서 불가할 경우 `chrome.offscreen` API(Chrome 116+)를 사용한다.

---

## 규칙셋 관리 (`rules/`)

```
rules/
├── dark-patterns.json      # 공정위 19가지 기준 정의
├── fomo-keywords.json      # NLP 1단계 키워드 사전
└── dom-selectors.json      # DOM Scanner CSS 선택자 패턴
```

- 규칙셋은 코드 변경 없이 JSON만 수정하여 갱신 가능해야 한다.
- 새로운 다크 패턴 유형 추가 시 `dark-patterns.json`의 스키마를 먼저 확인한다.

---

## 오탐(False Positive) 처리 원칙

- 탐지 확신이 낮은 경우 `confidence: 'suspicious'`로 표시하고 사용자가 최종 판단한다.
- 탐지 결과는 "공정위 기준 기반 자동 분석"임을 UI에 명시한다. 특정 사이트를 단정적으로 "다크 패턴 사이트"로 표현하지 않는다.
- 임계값(NLP 유사도 기본 0.85, FOMO 점수 등)은 사용자 설정으로 조정 가능하게 유지한다.

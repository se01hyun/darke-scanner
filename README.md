# Dark-Scanner

> 대한민국 공정거래위원회 온라인 다크 패턴 가이드라인 기반의 실시간 탐지 브라우저 확장 프로그램

[![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/)
[![Coverage](https://img.shields.io/badge/공정위%20기준-17%2F19%20(89%25)-success)]()
[![Privacy](https://img.shields.io/badge/데이터%20외부전송-없음-brightgreen)]()

---

## 개요

쇼핑몰·구독 서비스 등에서 소비자의 합리적 판단을 방해하는 **다크 패턴**을 실시간으로 감지하고 시각적으로 경고합니다.
공정위가 고시한 **19가지 유형** 중 **17가지(89%)** 를 탐지하며, 모든 분석은 브라우저 내부에서만 수행됩니다.

---

## 탐지 항목 (17/19)

| 번호 | 유형 | 구현 | 탐지 모듈 |
|------|------|:----:|-----------|
| 1  | 숨은 갱신 (자동갱신·자동결제 미고지) | ✅ | NLP |
| 2  | 순차공개 가격책정 (Drip Pricing) | ✅ | Network |
| 3  | 몰래 장바구니 추가 | ✅ | DOM |
| 4  | 거짓할인 (원가 없는 할인율 표시) | ✅ | DOM |
| 5  | 거짓추천 (가짜 리뷰 클러스터) | ✅ | NLP |
| 6  | 유인판매 | ─ | — |
| 7  | 위장광고 (광고 고지 누락) | ✅ | DOM |
| 8  | 속임수 질문 (이중부정 동의 유도) | ✅ | NLP |
| 9  | 잘못된 계층구조 (취소 버튼 시각적 약화) | ✅ | DOM |
| 10 | 특정옵션의 사전선택 | ✅ | DOM |
| 11 | 취소·탈퇴 등의 방해 | ✅ | DOM |
| 12 | 숨겨진 정보 (중요 약관 극소 폰트) | ✅ | DOM |
| 13 | 가격비교 방해 | ✅ | DOM |
| 14 | 클릭 피로감 유발 | ─ | — |
| 15 | 반복간섭 (마케팅 팝업 반복 노출) | ✅ | DOM |
| 16 | 감정적 언어사용 (Confirmshaming) | ✅ | NLP |
| 17 | 시간제한 알림 (허위 카운트다운) | ✅ | DOM |
| 18 | 낮은 재고 알림 (허위 품절 임박) | ✅ | DOM |
| 19 | 다른 소비자의 활동 알림 (허위 실시간 수치) | ✅ | Network |

---

## 아키텍처

```
Content Script          Background Worker         UI
─────────────────       ───────────────────       ────────────
DOM Scanner       ─┐
Network Sniffer   ─┼──→  Rule Engine        ──→  Popup (팝업 리포트)
Script Analyzer   ─┤     NLP Analyzer            Overlay (DOM 하이라이트)
Text Collector    ─┘     Network Sniffer          배지 (탐지 건수)
```

### 탐지 모듈

**DOM Scanner** — `DOMContentLoaded` 시 전체 스캔, `MutationObserver`로 동적 변경 실시간 감지, SPA 재스캔 지원

**NLP Analyzer** — Hybrid 2-Pass 방식
1. 키워드 사전 매칭 (`rules/fomo-keywords.json`) — 히트 없으면 Pass 2 생략
2. 심리적 압박 지수 계산 (FOMO 키워드 밀도 × 0.4 + 압박형 어미 × 0.3 + 긴급성 표현 × 0.3)

> KoELECTRA ONNX 모델 통합은 Phase 3 예정 (현재: 키워드 + 규칙 기반)

**Network Sniffer** — `fetch`/`XHR` 인터셉트로 실시간 수치 서버 검증, 결제 단계별 가격 변동 추적

---

## 탐지 결과 표시

각 탐지 항목은 다음 두 축으로 독립 표시됩니다.

| 축 | 값 | 의미 |
|---|---|---|
| **심각도** | `낮음` / `중간` / `높음` | 소비자 피해 잠재 수준 |
| **확신도** | `의심` / `확정` | 탐지 근거의 명확성 |

- 페이지 오버레이: 탐지 요소에 색상 테두리 + 공정위 기준 번호 배지
- 팝업 리포트: 종합 위험도 점수 (0–100) + 탐지 목록 + JSON 내보내기

---

## 설치 (개발 빌드)

```bash
git clone https://github.com/se01hyun/darke-scanner.git
cd dark-scanner
npm install
npm run build:prod
```

1. Chrome → `chrome://extensions` → **개발자 모드** ON
2. **압축해제된 확장 프로그램 로드** → 프로젝트 루트 폴더 선택

---

## 빌드 명령

| 명령 | 설명 |
|------|------|
| `npm run build` | 개발 빌드 (sourcemap, 디버그 로그 활성) |
| `npm run build:prod` | 프로덕션 빌드 (minify, 로그 완전 제거) |
| `npm run watch` | 파일 변경 감지 자동 빌드 |
| `npm run typecheck` | TypeScript 타입 검사 |

---

## 규칙셋 업데이트

코드 변경 없이 JSON 파일만 수정하여 탐지 규칙을 갱신할 수 있습니다.

```
rules/
├── dark-patterns.json   # 공정위 19가지 기준 정의
├── fomo-keywords.json   # NLP 1단계 키워드 사전
└── dom-selectors.json   # DOM 스캔 CSS 선택자 패턴
```

---

## 성능 목표

| 항목 | 목표 |
|------|------|
| DOM 스캔 완료 | ≤ 500ms |
| 페이지 로드 추가 지연 | ≤ 200ms |
| 확장 프로그램 총 용량 | ≤ 100MB |

---

## 개인정보 보호

수집된 텍스트, DOM 데이터, 네트워크 응답은 **외부 서버로 전송하지 않습니다.**
모든 분석은 사용자의 브라우저 내에서 완결됩니다. 자세한 내용은 [개인정보처리방침](docs/privacy-policy.md)을 참조하세요.

---

## 참고 문헌

- 공정거래위원회 「온라인 다크 패턴 자율 관리 가이드라인」 (2023.07.31)
- Princeton Web Transparency & Accountability Project — *Dark Patterns at Scale* (2019)
- Chrome Extensions Manifest V3 공식 문서

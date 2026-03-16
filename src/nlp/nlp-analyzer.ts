// NLP 분석기 — Hybrid 2-Pass 구현
// Pass 1: 키워드 사전 매칭 (즉시)
// Pass 2: 압박 지수 계산 + 리뷰 유사도 분석 (Pass 1 히트 시에만)
//
// 탐지 대상:
//   Guideline 16 — 감정적 언어사용 (Confirmshaming)
//   Guideline  5 — 거짓추천 (Fake Reviews)

import { KeywordMatcher } from './keyword-matcher';
import { calcPressureScore } from './pressure-scorer';
import { analyzeReviews } from './review-analyzer';
import type { DarkPatternDetection, NLPTextsPayload } from '../types';
import { generateId } from '../utils/id';

// Confirmshaming 정규식 패턴 (거절 버튼 문구에서 탐지)
const CONFIRMSHAMING_PATTERNS: RegExp[] = [
  /아니[요오],?\s*저는/,
  /싫어요/,
  /필요\s*없어요/,
  /필요\s*없습니다/,
  /손해를\s*감수/,
  /혜택이\s*필요\s*없/,
  /할인\s*받지\s*않겠/,
  /관심\s*없어요/,
  /괜찮습니다[,.]?\s*구독/,
  /포기하겠습니다/,
];

// 압박 지수 임계값
const PRESSURE_SCORE_SUSPICIOUS = 30;
const PRESSURE_SCORE_CONFIRMED = 60;

export class NLPAnalyzer {
  private readonly matcher = new KeywordMatcher();
  private initialized = false;
  /** ONNX 모델이 로드됐을 때만 true. false면 키워드+규칙 기반 분석만 수행한다. */
  private modelReady = false;

  async init(): Promise<void> {
    await this.matcher.init();
    this.initialized = true;

    // ONNX 모델 로드 시도 — 실패 시 키워드 전용 모드(현재 구현)로 안전하게 폴백한다.
    // models/ 파일이 없거나, MV3 Service Worker에서 WASM이 막힌 환경을 모두 처리한다.
    try {
      await this.loadModel();
      this.modelReady = true;
    } catch {
      // 모델 없음 또는 WASM 미지원 — keyword-only 모드로 계속 진행
      this.modelReady = false;
    }
  }

  /**
   * ONNX 모델 파일 존재 여부를 확인한다.
   * 실제 InferenceSession 생성은 Phase 3에서 구현한다.
   *
   * @throws 파일이 없거나 fetch 실패 시 예외를 던진다.
   */
  private async loadModel(): Promise<void> {
    const modelUrl = chrome.runtime.getURL('models/koelectra-fomo.onnx');
    const resp = await fetch(modelUrl, { method: 'HEAD' });
    if (!resp.ok) throw new Error(`model not found: ${resp.status}`);
    // TODO(Phase 3): ort.InferenceSession.create(modelUrl) 로 실제 추론 세션 초기화
  }

  async analyze(payload: NLPTextsPayload): Promise<DarkPatternDetection[]> {
    if (!this.initialized) await this.init();

    const detections: DarkPatternDetection[] = [];

    // ── Pass 1: Confirmshaming (CTA 텍스트) ─────────────────────────────
    const confirmshamingDetection = this.detectConfirmshaming(payload.ctaTexts);
    if (confirmshamingDetection) detections.push(confirmshamingDetection);

    // ── Pass 1: 키워드 사전 매칭 ─────────────────────────────────────────
    const allPageText = [...payload.pageTexts, ...payload.ctaTexts].join(' ');
    const fomoHits = this.matcher.match(allPageText);

    // 키워드 히트가 없으면 Pass 2 생략 (성능 최적화)
    if (fomoHits.length > 0) {
      // ── Pass 2: 심리적 압박 지수 계산 ───────────────────────────────────
      const pressureScore = calcPressureScore(allPageText, fomoHits);

      if (pressureScore >= PRESSURE_SCORE_SUSPICIOUS) {
        detections.push({
          id: generateId(),
          guideline: 16,
          guidelineName: '감정적 언어사용',
          severity: pressureScore >= PRESSURE_SCORE_CONFIRMED ? 'high' : 'medium',
          confidence: pressureScore >= PRESSURE_SCORE_CONFIRMED ? 'confirmed' : 'suspicious',
          module: 'nlp',
          description: `페이지 텍스트에서 심리적 압박 지수 ${pressureScore}점이 탐지되었습니다. (FOMO 키워드: ${fomoHits.slice(0, 3).join(', ')})`,
          evidence: {
            type: 'text_analysis',
            raw: fomoHits.join(', '),
            detail: { pressureScore, fomoKeywords: fomoHits },
          },
        });
      }
    }

    // ── Pass 2: 가짜 리뷰 탐지 ──────────────────────────────────────────
    if (payload.reviewTexts.length >= 2) {
      const clusters = analyzeReviews(payload.reviewTexts);
      for (const cluster of clusters) {
        detections.push({
          id: generateId(),
          guideline: 5,
          guidelineName: '거짓추천',
          severity: 'high',
          confidence: cluster.avgSimilarity >= 0.95 ? 'confirmed' : 'suspicious',
          module: 'nlp',
          description: `${cluster.reviews.length}개의 리뷰가 평균 ${Math.round(cluster.avgSimilarity * 100)}% 유사한 패턴을 보입니다.`,
          evidence: {
            type: 'text_analysis',
            raw: cluster.reviews[0] ?? '',
            detail: {
              clusterSize: cluster.reviews.length,
              avgSimilarity: cluster.avgSimilarity,
              sampleReviews: cluster.reviews.slice(0, 3),
            },
          },
        });
      }
    }

    return detections;
  }

  private detectConfirmshaming(ctaTexts: string[]): DarkPatternDetection | null {
    for (const text of ctaTexts) {
      for (const pat of CONFIRMSHAMING_PATTERNS) {
        if (pat.test(text)) {
          return {
            id: generateId(),
            guideline: 16,
            guidelineName: '감정적 언어사용',
            severity: 'high',
            confidence: 'confirmed',
            module: 'nlp',
            description: '거절 버튼에 사용자에게 죄책감을 유발하는 문구가 사용되었습니다.',
            evidence: {
              type: 'text_analysis',
              raw: text,
              detail: { pattern: 'confirmshaming', matchedText: text },
            },
          };
        }
      }
    }
    return null;
  }
}

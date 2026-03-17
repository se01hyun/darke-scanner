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
import { OnnxSession } from './onnx-session';
import { cosineSim } from './tokenizer';
import type { DarkPatternDetection, NLPTextsPayload, ReviewCluster, NLPAnalysisResult } from '../types';
import { generateId } from '../utils/id';
import { logger } from '../utils/debug-logger';

// ── 가이드라인 8: 속임수 질문 패턴 (이중부정·혼란 유도 동의/거절 문구) ────────
// 예: "수신을 원하지 않으시면 체크를 해제해 주세요", "마케팅에 동의하지 않음"
const TRICK_QUESTION_PATTERNS: RegExp[] = [
  /원하지\s*않/,
  /동의하지\s*않/,
  /수신\s*거부/,
  /체크\s*해제/,
  /해제해\s*주세요/,
  /거부합니다/,
  /안\s*받겠습니다/,
  /이용\s*안\s*함/,
  /선택\s*해제/,
];

// ── 가이드라인 1: 숨은 갱신 키워드 ──────────────────────────────────────────
const HIDDEN_RENEWAL_KEYWORDS = [
  '자동갱신', '자동 갱신', '자동연장', '자동 연장',
  '자동결제', '자동 결제', '자동청구', '자동 청구',
  '별도 해지', '해지하지 않으면', '유료전환', '유료 전환',
];
// 자동갱신이 특히 위험한 컨텍스트 단어 (이것과 함께 등장하면 confirmed)
const RENEWAL_RISK_CONTEXT = [
  '무료체험', '무료 체험', '첫 달', '프로모션', '이벤트 기간', '체험 종료 후',
];

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
  private readonly onnx    = new OnnxSession();
  private initialized = false;

  /** ONNX 모델이 로드됐을 때만 true. false면 키워드+규칙 기반 분석만 수행한다. */
  get modelReady(): boolean { return this.onnx.isReady; }

  async init(): Promise<void> {
    await this.matcher.init();
    this.initialized = true;

    // ONNX 모델 로드 시도.
    // models/koelectra-fomo.onnx 파일이 없거나 WASM이 막힌 경우 → keyword-only 폴백.
    try {
      const modelUrl = chrome.runtime.getURL('models/koelectra-fomo.onnx');
      await this.onnx.load(modelUrl);
      logger.log('NLP', 'ONNX 세션 초기화 완료');
    } catch (e) {
      logger.warn('NLP', `ONNX 로드 실패 — keyword-only 모드로 진행: ${String(e)}`);
    }
  }

  async analyze(payload: NLPTextsPayload): Promise<NLPAnalysisResult> {
    if (!this.initialized) await this.init();

    const mode = this.modelReady ? 'ONNX' : 'keyword-only';
    logger.group(`NLP 분석 — 모델=${mode}`);
    const detections: DarkPatternDetection[] = [];
    let reviewClusters: ReviewCluster[] = [];

    // ── 가이드라인 8: 속임수 질문 (CTA + 페이지 텍스트 전체) ─────────────
    const trickDetection = this.detectTrickQuestions(payload.pageTexts, payload.ctaTexts);
    if (trickDetection) {
      logger.log('NLP:속임수질문', `탐지 — "${trickDetection.evidence.raw.slice(0, 60)}"`);
      detections.push(trickDetection);
    }

    // ── 가이드라인 1: 숨은 갱신 (페이지 전체 텍스트) ─────────────────────
    const renewalDetection = this.detectHiddenRenewal(payload.pageTexts, payload.ctaTexts);
    if (renewalDetection) {
      logger.log('NLP:숨은갱신', `탐지 — conf=${renewalDetection.confidence}`);
      detections.push(renewalDetection);
    }

    // ── Pass 1: Confirmshaming (CTA 텍스트) ─────────────────────────────
    logger.log('NLP:Pass1', `CTA 텍스트 ${payload.ctaTexts.length}건 Confirmshaming 검사`);
    const confirmshamingDetection = this.detectConfirmshaming(payload.ctaTexts);
    if (confirmshamingDetection) {
      logger.log('NLP:Pass1', `Confirmshaming 탐지 — "${confirmshamingDetection.evidence.raw.slice(0, 60)}"`);
      detections.push(confirmshamingDetection);
    }

    // ── Pass 1: 키워드 사전 매칭 ─────────────────────────────────────────
    const allPageText = [...payload.pageTexts, ...payload.ctaTexts].join(' ');
    const fomoHits = this.matcher.match(allPageText);
    logger.log('NLP:Pass1', `FOMO 키워드 히트 ${fomoHits.length}건: ${fomoHits.join(', ') || '없음'}`);

    // 키워드 히트가 없으면 Pass 2 생략 (성능 최적화)
    if (fomoHits.length > 0) {
      // ── Pass 2: 심리적 압박 지수 계산 (ONNX 우선, 없으면 규칙 기반) ────
      let pressureScore: number;
      if (this.modelReady) {
        try {
          // ONNX 압박 분류: 페이지 텍스트 최대 128자 슬라이스로 추론
          pressureScore = await this.onnx.pressureScore(allPageText.slice(0, 512));
          logger.log('NLP:Pass2', `ONNX 압박 지수 ${pressureScore}점`);
        } catch {
          pressureScore = calcPressureScore(allPageText, fomoHits);
          logger.warn('NLP:Pass2', `ONNX 추론 실패 — 규칙 기반 폴백 ${pressureScore}점`);
        }
      } else {
        pressureScore = calcPressureScore(allPageText, fomoHits);
        logger.log('NLP:Pass2', `규칙 기반 압박 지수 ${pressureScore}점`);
      }

      logger.log('NLP:Pass2', `압박 지수 ${pressureScore}점 (suspicious≥${PRESSURE_SCORE_SUSPICIOUS} confirmed≥${PRESSURE_SCORE_CONFIRMED})`);

      if (pressureScore >= PRESSURE_SCORE_SUSPICIOUS) {
        detections.push({
          id: generateId(),
          guideline: 16,
          guidelineName: '감정적 언어사용',
          severity: pressureScore >= PRESSURE_SCORE_CONFIRMED ? 'high' : 'medium',
          confidence: pressureScore >= PRESSURE_SCORE_CONFIRMED ? 'confirmed' : 'suspicious',
          module: 'nlp',
          description: `페이지 텍스트에서 심리적 압박 지수 ${pressureScore}점이 탐지되었습니다. (FOMO 키워드: ${fomoHits.slice(0, 3).join(', ')}) [분석: ${mode}]`,
          evidence: {
            type: 'text_analysis',
            raw: fomoHits.join(', '),
            detail: { pressureScore, fomoKeywords: fomoHits, mode },
          },
        });
      }
    }

    logger.groupEnd();

    // ── Pass 2: 가짜 리뷰 탐지 (ONNX 시맨틱 유사도 우선, 없으면 TF-IDF) ─
    logger.log('NLP:리뷰', `${payload.reviewTexts.length}건 리뷰 유사도 분석 [${mode}]`);
    if (payload.reviewTexts.length >= 2) {
      const clusters = this.modelReady
        ? await this.semanticReviewClusters(payload.reviewTexts)
        : analyzeReviews(payload.reviewTexts);

      reviewClusters = clusters;
      logger.log('NLP:리뷰', `유사 클러스터 ${clusters.length}개 발견`);
      for (const cluster of clusters) {
        logger.log('NLP:리뷰', `클러스터 ${cluster.reviews.length}건, 평균 유사도 ${(cluster.avgSimilarity * 100).toFixed(1)}%`);
        detections.push({
          id: generateId(),
          guideline: 5,
          guidelineName: '거짓추천',
          severity: 'high',
          confidence: cluster.avgSimilarity >= 0.95 ? 'confirmed' : 'suspicious',
          module: 'nlp',
          description: `${cluster.reviews.length}개의 리뷰가 평균 ${Math.round(cluster.avgSimilarity * 100)}% 유사한 패턴을 보입니다. [분석: ${mode}]`,
          evidence: {
            type: 'text_analysis',
            raw: cluster.reviews[0] ?? '',
            detail: {
              clusterSize: cluster.reviews.length,
              avgSimilarity: cluster.avgSimilarity,
              sampleReviews: cluster.reviews.slice(0, 3),
              mode,
            },
          },
        });
      }
    }

    return { detections, reviewClusters };
  }

  /**
   * ONNX 임베딩 기반 시맨틱 리뷰 클러스터링.
   * TF-IDF와 달리 표현이 다른 복제 리뷰도 의미적 유사도로 탐지한다.
   */
  private async semanticReviewClusters(reviews: string[]): Promise<ReviewCluster[]> {
    const THRESHOLD = 0.85;
    let simMatrix: number[][];
    try {
      simMatrix = await this.onnx.semanticSimilarityMatrix(reviews);
    } catch {
      // ONNX 추론 실패 → TF-IDF 폴백
      return analyzeReviews(reviews);
    }

    const clusters: ReviewCluster[] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < reviews.length; i++) {
      if (assigned.has(i)) continue;

      const group: number[]  = [i];
      const sims:  number[]  = [];

      for (let j = i + 1; j < reviews.length; j++) {
        if (assigned.has(j)) continue;
        const sim = simMatrix[i][j];
        if (sim >= THRESHOLD) {
          group.push(j);
          sims.push(sim);
          assigned.add(j);
        }
      }

      if (group.length > 1) {
        assigned.add(i);
        const avg = sims.reduce((a, b) => a + b, 0) / sims.length;
        clusters.push({
          reviews:       group.map((idx) => reviews[idx]),
          avgSimilarity: Math.round(avg * 1000) / 1000,
          isSuspicious:  true,
        });
      }
    }

    return clusters;
  }

  // ── 가이드라인 8: 속임수 질문 (Trick Questions) ──────────────────────────────
  // 이중부정·혼란 유도 문구로 소비자를 원하지 않는 동의로 유도하는 패턴 탐지
  private detectTrickQuestions(
    pageTexts: string[],
    ctaTexts: string[],
  ): DarkPatternDetection | null {
    const allTexts = [...ctaTexts, ...pageTexts];
    for (const text of allTexts) {
      for (const pat of TRICK_QUESTION_PATTERNS) {
        if (pat.test(text)) {
          return {
            id: generateId(),
            guideline: 8,
            guidelineName: '속임수 질문',
            severity: 'high',
            confidence: 'confirmed',
            module: 'nlp',
            description: '이중부정 또는 혼란 유도 문구로 소비자를 원하지 않는 동의로 유도하는 표현이 감지되었습니다.',
            evidence: {
              type: 'text_analysis',
              raw: text.slice(0, 200),
              detail: { pattern: pat.source, matchedText: text.slice(0, 100) },
            },
          };
        }
      }
    }
    return null;
  }

  // ── 가이드라인 1: 숨은 갱신 (Hidden Renewal) ─────────────────────────────────
  // 자동갱신·자동결제 조건이 본문에 있지만 눈에 띄지 않게 처리된 경우 탐지
  private detectHiddenRenewal(
    pageTexts: string[],
    ctaTexts: string[],
  ): DarkPatternDetection | null {
    const allText = [...pageTexts, ...ctaTexts].join(' ');

    const matchedKeyword = HIDDEN_RENEWAL_KEYWORDS.find((kw) => allText.includes(kw));
    if (!matchedKeyword) return null;

    // 위험 컨텍스트(무료체험·첫달 등)와 함께 등장하면 더 심각한 다크 패턴
    const hasRiskContext = RENEWAL_RISK_CONTEXT.some((kw) => allText.includes(kw));

    return {
      id: generateId(),
      guideline: 1,
      guidelineName: '숨은 갱신',
      severity: hasRiskContext ? 'high' : 'medium',
      confidence: hasRiskContext ? 'confirmed' : 'suspicious',
      module: 'nlp',
      description: hasRiskContext
        ? `무료 체험·프로모션 기간 종료 후 자동 유료 전환되는 조건("${matchedKeyword}")이 감지되었습니다.`
        : `자동갱신·자동결제 조건("${matchedKeyword}")이 페이지에 포함되어 있습니다. 소비자에게 충분히 고지됐는지 확인이 필요합니다.`,
      evidence: {
        type: 'text_analysis',
        raw: matchedKeyword,
        detail: {
          matchedKeyword,
          hasRiskContext,
          riskContextMatched: RENEWAL_RISK_CONTEXT.filter((kw) => allText.includes(kw)),
        },
      },
    };
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

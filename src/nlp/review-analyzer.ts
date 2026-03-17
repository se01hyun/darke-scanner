// 가짜 리뷰 탐지 — TF-IDF 기반 코사인 유사도 분석
// ONNX 모델 없이 순수 JS로 동작하는 경량 구현

import type { ReviewCluster } from '../types';

// ONNX 시맨틱 유사도(0.85)와 달리, TF 코사인 유사도는 한국어 형태소 변형
// (만족했습니다/만족하였습니다 등)으로 인해 실제 유사 리뷰에서도 0.70~0.76 수준으로
// 측정된다. ONNX 모델 없는 폴백 시에는 0.65를 임계값으로 사용한다.
const SIMILARITY_THRESHOLD = 0.65;
const MIN_REVIEW_LENGTH = 10; // 너무 짧은 리뷰는 분석 제외

/** 텍스트를 토큰 배열로 분해 (공백/구두점 기준) */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\u3000\p{P}]+/u)
    .filter((t) => t.length > 1);
}

/** TF 벡터 반환 (term → 빈도/총단어수) */
function buildTfVector(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const len = Math.max(tokens.length, 1);
  for (const [k, v] of freq) {
    freq.set(k, v / len);
  }
  return freq;
}

/** 두 TF 벡터 간 코사인 유사도 (0~1) */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [k, va] of a) {
    dot += va * (b.get(k) ?? 0);
    normA += va * va;
  }
  for (const vb of b.values()) {
    normB += vb * vb;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 리뷰 텍스트 목록에서 의심 클러스터 반환.
 * 유사도 >= SIMILARITY_THRESHOLD인 쌍을 그룹화.
 */
export function analyzeReviews(reviews: string[]): ReviewCluster[] {
  const valid = reviews.filter((r) => r.length >= MIN_REVIEW_LENGTH);
  if (valid.length < 2) return [];

  const vectors = valid.map((r) => buildTfVector(tokenize(r)));
  const clusters: ReviewCluster[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < valid.length; i++) {
    if (assigned.has(i)) continue;

    const group: number[] = [i];
    const similarities: number[] = [];

    for (let j = i + 1; j < valid.length; j++) {
      if (assigned.has(j)) continue;
      const sim = cosineSimilarity(vectors[i], vectors[j]);
      if (sim >= SIMILARITY_THRESHOLD) {
        group.push(j);
        similarities.push(sim);
        assigned.add(j);
      }
    }

    if (group.length > 1) {
      assigned.add(i);
      const avgSimilarity =
        similarities.reduce((a, b) => a + b, 0) / similarities.length;

      clusters.push({
        reviews: group.map((idx) => valid[idx]),
        avgSimilarity: Math.round(avgSimilarity * 1000) / 1000,
        isSuspicious: true,
      });
    }
  }

  return clusters;
}
